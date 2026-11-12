import { adminClient, env, rpc } from "./db.ts";
import { HttpError } from "./http.ts";

export interface Device {
  device_id: string;
  branch_id: string;
  public_id: string;
  branch_name: string;
  label: string;
  language: "ar" | "en" | "ur" | "bn" | "fil";
  provider_id: string | null;
}

/** Staff device from the x-device-token header (only its SHA-256 is stored). */
export async function requireDevice(req: Request): Promise<Device> {
  const token = req.headers.get("x-device-token");
  if (!token) throw new HttpError("device_unpaired");
  const device = await rpc<Device | null>("staff_auth", { p_token: token });
  if (!device) throw new HttpError("device_unpaired");
  return device;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null;
}

/** Signed-in owner from the Supabase Auth JWT. */
export async function requireUser(req: Request): Promise<{ id: string; email?: string; jwt: string }> {
  const jwt = bearer(req);
  if (!jwt) throw new HttpError("unauthorized");
  const { data, error } = await adminClient().auth.getUser(jwt);
  if (error || !data.user) throw new HttpError("unauthorized");
  return { id: data.user.id, email: data.user.email, jwt };
}

/** Optional user: anonymous callers get null instead of an error. */
export async function optionalUser(req: Request) {
  try {
    return await requireUser(req);
  } catch {
    return null;
  }
}

/** Scheduled calls (pg_cron via pg_net) authenticate with the service role key. */
export function requireCron(req: Request) {
  const token = bearer(req);
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (token && ((cronSecret && token === cronSecret) || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))) return;
  throw new HttpError("unauthorized");
}

/** Hash of IP + user agent, used only for join rate limiting. */
export async function fingerprint(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
  const ua = req.headers.get("user-agent") ?? "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${ua}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
