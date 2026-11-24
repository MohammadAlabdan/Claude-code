// WhatsApp webhook for Meta. GET: the one-time subscription check (hub.verify_token must match the token shown in
// the admin dashboard). POST: incoming messages, accepted only with a valid X-Hub-Signature-256 from the app secret.
import "../../lib/deno.mts";
import type { Config } from "@netlify/functions";
import { ensureSecrets } from "../../lib/secrets.mts";
import { handleWebhook, waConfig, waSignatureOk } from "../../src/_shared/whatsapp.ts";

export default async (req: Request) => {
  await ensureSecrets();
  const cfg = await waConfig(true);
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === cfg.verify_token;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();
  if (!cfg.app_secret || !(await waSignatureOk(cfg.app_secret, raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("bad signature", { status: 401 });
  }
  try { await handleWebhook(JSON.parse(raw)); } catch (e) { console.error("whatsapp webhook", e); }
  // always 200 once the signature is good, so Meta does not retry the same message
  return new Response("ok", { status: 200 });
};
export const config: Config = { path: "/api/whatsapp" };
