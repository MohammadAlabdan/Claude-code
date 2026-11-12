// Shop page photos in Netlify Blobs (store "branch-photos"), keyed "<branch_id>/<time>-<rand>.<ext>".
// POST /api/photo?branch_id=…  (owner token, raw image body, ≤3 MB, jpeg/png/webp) → {path}
// GET  /api/photo/<branch_id>/<file>  → the image
import "../../lib/deno.mts";
import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { PgClient, verifyToken } from "../../src/_shared/pg.ts";
import { ensureSecrets } from "../../lib/secrets.mts";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const store = () => getStore({ name: "branch-photos", consistency: "strong" });

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const key = url.pathname.replace(/^\/api\/photo\//, "");
    if (!/^[0-9a-f-]{36}\/[\w.-]+$/.test(key)) return new Response("not found", { status: 404 });
    const res = await store().getWithMetadata(key, { type: "arrayBuffer" });
    if (!res) return new Response("not found", { status: 404 });
    return new Response(res.data, { headers: { "content-type": String(res.metadata.type ?? "image/jpeg"), "cache-control": "public, max-age=86400" } });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  await ensureSecrets();
  const h = req.headers.get("authorization") ?? "";
  const user = h.startsWith("Bearer ") ? await verifyToken(h.slice(7)) : null;
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const branchId = url.searchParams.get("branch_id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(branchId)) return Response.json({ error: "invalid_input" }, { status: 400 });
  const { data: can } = await new PgClient().rpc("can_manage_branch", { p_user: user.id, p_branch: branchId });
  if (can !== true) return Response.json({ error: "forbidden" }, { status: 403 });
  const type = (req.headers.get("content-type") ?? "").split(";")[0];
  if (!TYPES[type]) return Response.json({ error: "invalid_input", message_ar: "الصورة لازم تكون JPG أو PNG أو WebP" }, { status: 400 });
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 3 * 1024 * 1024) return Response.json({ error: "image_too_large", message_ar: "الصورة أكبر من ٣ ميغا" }, { status: 413 });
  const key = `${branchId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${TYPES[type]}`;
  await store().set(key, buf, { metadata: { type } });
  return Response.json({ path: key });
};

export const config: Config = { path: ["/api/photo", "/api/photo/*"] };
