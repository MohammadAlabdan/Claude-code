// Public settings the app needs at startup on Netlify (push public key, whether WhatsApp alerts are on; nothing secret).
import "../../lib/deno.mts";
import type { Config } from "@netlify/functions";
import { ensureSecrets } from "../../lib/secrets.mts";
import { query } from "../../src/_shared/pg.ts";

export default async () => {
  await ensureSecrets();
  let whatsapp = false;
  try { [{ whatsapp }] = await query("select public.whatsapp_ready() as whatsapp"); } catch { /* before the migration */ }
  return Response.json({ vapid_public_key: process.env.VAPID_PUBLIC_KEY ?? "", whatsapp: whatsapp === true },
    { headers: { "cache-control": "public, max-age=60" } });
};

export const config: Config = { path: "/api/config" };
