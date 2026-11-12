// Secrets on Netlify without anyone handling them: created inside the database (table app_secrets, no grants to
// anon/authenticated) by a migration or on first use, then loaded into process.env for the shared code.
// Environment variables, when set in the Netlify UI, still win.
import webpush from "web-push";
import { query } from "../src/_shared/pg.ts";

let loaded: Promise<void> | null = null;

async function load() {
  const rows = await query("select name, value from public.app_secrets");
  const s = Object.fromEntries(rows.map((r) => [String(r.name), String(r.value)]));
  if (!s.vapid_public || !s.vapid_private) {
    const k = webpush.generateVAPIDKeys();
    await query(`insert into public.app_secrets(name, value) values ('vapid_public', $1), ('vapid_private', $2)
                 on conflict (name) do nothing`, [k.publicKey, k.privateKey]);
    const again = await query("select name, value from public.app_secrets where name in ('vapid_public','vapid_private')");
    for (const r of again) s[String(r.name)] = String(r.value);
  }
  process.env.DAWRI_JWT_SECRET ||= s.jwt_secret;
  process.env.CRON_SECRET ||= s.cron_secret;
  process.env.VAPID_PUBLIC_KEY ||= s.vapid_public;
  process.env.VAPID_PRIVATE_KEY ||= s.vapid_private;
}

/** Call before handling a request; cached per function instance, retried after a failure. */
export function ensureSecrets(): Promise<void> {
  loaded ??= load().catch((e) => { loaded = null; throw e; });
  return loaded;
}
