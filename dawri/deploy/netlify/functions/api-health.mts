// GET /api/health: for an uptime monitor. 200 when the database answers, 503 otherwise.
// Also says how old the last backup is (stale after 36 hours). Nothing private in the answer.
import "../../lib/deno.mts";
import type { Config } from "@netlify/functions";
import { query } from "../../src/_shared/pg.ts";
import { backups } from "../../lib/backup.mts";

export default async () => {
  const t0 = Date.now();
  let db = false;
  try { await query("select 1"); db = true; } catch { /* reported below */ }
  const dbMs = Date.now() - t0;
  let last: string | null = null;
  try { const { blobs } = await backups().list(); last = blobs.map((b) => b.key.slice(0, 10)).sort().pop() ?? null; } catch { /* no store yet */ }
  const ageH = last ? Math.round((Date.now() - Date.parse(`${last}T00:37:00Z`)) / 36e5) : null;
  return Response.json({ ok: db, db, db_ms: dbMs, last_backup: last, backup_stale: ageH == null || ageH > 36, time: new Date().toISOString() },
    { status: db ? 200 : 503, headers: { "cache-control": "no-store" } });
};
export const config: Config = { path: "/api/health" };
