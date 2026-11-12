// Public settings the app needs at startup on Netlify (only the push public key; nothing secret).
import "../../lib/deno.mts";
import type { Config } from "@netlify/functions";
import { ensureSecrets } from "../../lib/secrets.mts";

export default async () => {
  await ensureSecrets();
  return Response.json({ vapid_public_key: process.env.VAPID_PUBLIC_KEY ?? "" }, { headers: { "cache-control": "public, max-age=300" } });
};

export const config: Config = { path: "/api/config" };
