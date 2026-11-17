// Platform admin only. GET /api/backup → list; GET /api/backup/<key> → download; POST /api/backup → back up now.
import "../../lib/deno.mts";
import type { Config } from "@netlify/functions";
import { query, verifyToken } from "../../src/_shared/pg.ts";
import { ensureSecrets } from "../../lib/secrets.mts";
import { backups, listBackups, runBackup } from "../../lib/backup.mts";

export default async (req: Request) => {
  await ensureSecrets();
  const url = new URL(req.url);
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const user = token ? await verifyToken(token) : null;
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [{ a }] = await query("select public.is_admin($1::uuid) as a", [user.id]);
  if (!a) return Response.json({ error: "forbidden" }, { status: 403 });

  if (req.method === "POST") return Response.json(await runBackup());
  const key = url.pathname.replace(/^\/api\/backup\/?/, "");
  if (!key) return Response.json({ backups: await listBackups() });
  if (!/^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(key)) return Response.json({ error: "not_found" }, { status: 404 });
  const data = await backups().get(key, { type: "arrayBuffer" });
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  return new Response(data, { headers: { "content-type": "application/gzip", "content-disposition": `attachment; filename="jay-backup-${key}"`, "cache-control": "no-store" } });
};
export const config: Config = { path: ["/api/backup", "/api/backup/*"] };
