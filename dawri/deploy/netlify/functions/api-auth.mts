// Owner accounts on Netlify: email + password (bcrypt via pgcrypto in auth.users) and a signed 14-day token.
// POST /api/auth  {action: "signin" | "signup", email, password}  →  {access_token, expires_at, user}
// POST /api/auth  {action: "user"} with Authorization: Bearer <token>  →  {user}
import "../../lib/deno.mts";
import type { Config, Context } from "@netlify/functions";
import { query, signToken, verifyToken } from "../../src/_shared/pg.ts";
import { ensureSecrets } from "../../lib/secrets.mts";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (error: string, message_ar: string, status = 400) => json({ error, message_ar }, status);

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return fail("invalid_action", "طلب غير صحيح", 405);
  await ensureSecrets();
  const body = await req.json().catch(() => ({})) as { action?: string; email?: string; password?: string };

  if (body.action === "user") {
    const h = req.headers.get("authorization") ?? "";
    const u = h.startsWith("Bearer ") ? await verifyToken(h.slice(7)) : null;
    return u ? json({ user: u }) : fail("unauthorized", "انتهت الجلسة، سجّل دخولك مرة ثانية", 401);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return fail("invalid_input", "اكتب بريداً صحيحاً");
  if (password.length < 8 || password.length > 200) return fail("invalid_input", "كلمة المرور ٨ أحرف على الأقل");

  // brute-force guard per IP and per email (hourly buckets, same table as the queue limits)
  const ip = context.ip ?? "unknown";
  const [{ ok }] = await query("select public.hit_rate_limit($1, 30) and public.hit_rate_limit($2, 15) as ok", [`auth-ip:${ip}`, `auth-email:${email}`]);
  if (!ok) return fail("rate_limited", "محاولات كثيرة، جرّب بعد ساعة", 429);

  if (body.action === "signup") {
    const rows = await query(
      `insert into auth.users (email, encrypted_password, email_confirmed_at)
       values ($1, extensions.crypt($2, extensions.gen_salt('bf')), now())
       on conflict (email) do nothing returning id, email`, [email, password]);
    if (!rows.length) return fail("email_taken", "هذا البريد مسجّل، جرّب تسجيل الدخول");
    const user = { id: String(rows[0].id), email };
    return json({ ...(await signToken(user)), user });
  }

  if (body.action === "signin") {
    const rows = await query(
      `select id, email from auth.users where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)`, [email, password]);
    if (!rows.length) return fail("unauthorized", "البريد أو كلمة المرور غير صحيحة", 401);
    const user = { id: String(rows[0].id), email };
    return json({ ...(await signToken(user)), user });
  }

  return fail("invalid_action", "طلب غير صحيح");
};

export const config: Config = { path: "/api/auth" };
