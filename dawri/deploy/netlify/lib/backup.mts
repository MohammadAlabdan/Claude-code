// Daily database backup into Netlify Blobs (private store "db-backups"): every table of the public schema plus the
// login table, as gzipped JSON, one file per day, the last 30 days kept. Secrets and short-lived rate limits are left out.
import { gzipSync } from "node:zlib";
import { getStore } from "@netlify/blobs";
import { query } from "../src/_shared/pg.ts";

export const KEEP_DAYS = 30;
const SKIP = new Set(["app_secrets", "rate_limits", "whatsapp_config"]);
export const backups = () => getStore({ name: "db-backups", consistency: "strong" });

export async function runBackup() {
  const started = Date.now();
  const tables = (await query(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`))
    .map((r) => String(r.table_name)).filter((t) => !SKIP.has(t));
  const data: Record<string, unknown> = {};
  let rows = 0;
  for (const t of tables) {
    const [{ j }] = await query(`select coalesce(json_agg(x), '[]'::json) as j from public."${t.replace(/"/g, "")}" x`);
    data[t] = j; rows += (j as unknown[]).length;
  }
  const [{ j: users }] = await query(
    `select coalesce(json_agg(json_build_object('id', id, 'email', email, 'encrypted_password', encrypted_password,
       'email_confirmed_at', email_confirmed_at, 'created_at', created_at)), '[]'::json) as j from auth.users`);
  data["auth.users"] = users;
  const body = gzipSync(JSON.stringify({ version: 1, created_at: new Date().toISOString(), tables: data }));
  const key = `${new Date().toISOString().slice(0, 10)}.json.gz`;
  const store = backups();
  await store.set(key, body, { metadata: { created_at: new Date().toISOString(), rows, tables: tables.length + 1, bytes: body.length } });
  // keep the last KEEP_DAYS days
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const { blobs } = await store.list();
  for (const b of blobs) if (b.key.slice(0, 10) < cutoff) await store.delete(b.key);
  return { key, rows, bytes: body.length, ms: Date.now() - started };
}

export async function listBackups() {
  const store = backups();
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs.sort((x, y) => (x.key < y.key ? 1 : -1))) {
    const m = await store.getMetadata(b.key);
    out.push({ key: b.key, ...(m?.metadata ?? {}) });
  }
  return out;
}
