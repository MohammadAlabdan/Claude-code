// WhatsApp Cloud API (Meta, direct, no reseller). Customer-initiated: we only reply inside the 24-hour window the
// customer opened by sending their ticket code, so messages are plain texts (no templates to approve).
// Keys come from public.whatsapp_config (entered by the platform admin), read with the service role.
import { rpc } from "./db.ts";
import { toArabicDigits } from "./logic.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface WaConfig {
  ready: boolean; enabled: boolean; phone_number_id: string | null; access_token: string | null;
  app_secret: string | null; verify_token: string; display_number: string | null;
}
export interface WaTicket {
  ticket_id: string; number: number; lang: "ar" | "en"; status: string; shop: string; public_id: string;
  branch_id: string; position: number | null; estimate_min: number | null; wa_id?: string;
}

let cached: { at: number; cfg: WaConfig } | null = null;
export async function waConfig(fresh = false): Promise<WaConfig> {
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.cfg;
  const cfg = await rpc<WaConfig>("wa_config", {});
  cached = { at: Date.now(), cfg };
  return cfg;
}

const n = (x: number | null | undefined, lang: "ar" | "en") => (lang === "ar" ? toArabicDigits(x ?? 0) : String(x ?? 0));
const siteUrl = () => (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");

/** Texts. Arabic is the default; English for tickets taken in English. */
export function waText(kind: string, t: WaTicket | null, lang: "ar" | "en" = t?.lang ?? "ar"): string {
  const ar = lang !== "en";
  const where = t ? (ar ? `${t.shop} · رقم ${n(t.number, lang)}` : `${t.shop} · number ${t.number}`) : "";
  const page = t && siteUrl() ? `\n${siteUrl()}/s/${t.public_id}` : "";
  const wait = (x: WaTicket) => (x.position == null ? ""
    : ar ? (x.position === 0 ? "أنت التالي" : `قدّامك ${n(x.position, lang)}، تقريباً ${n(x.estimate_min, lang)} دقيقة`)
      : (x.position === 0 ? "You are next" : `${x.position} ahead of you, about ${x.estimate_min} min`));
  switch (kind) {
    case "linked":
      return ar
        ? `تم ✅ ربطنا تذكرتك\n${where}\n${wait(t!)}\n\nبنرسل لك هنا قبل دورك بدورين، ولما يوصل دورك.\nتبي تعرف وين وصل الطابور؟ اكتب أي رسالة.\nلإيقاف التنبيهات اكتب: إيقاف`
        : `Done ✅ your ticket is linked\n${where}\n${wait(t!)}\n\nWe'll message you here two turns before yours, and when it's your turn.\nSend any message to see the line. To stop, send: stop`;
    case "return_now":
      return ar ? `جاي دورك! ارجع الحين، باقي قبلك دوران 🚶\n${where}${page}` : `Your turn is coming! Head back now, two turns before you 🚶\n${where}${page}`;
    case "called":
      return ar ? `وصل دورك، تفضّل 🙌\n${where}` : `It's your turn, come in 🙌\n${where}`;
    case "ready":
    case "stage_ready":
      return ar ? `طلبك جاهز ✅\n${where}` : `Your order is ready ✅\n${where}`;
    case "status":
      return t ? `${where}\n${wait(t) || (ar ? "حان دورك أو قريب جداً" : "It's your turn or very close")}` : "";
    case "no_ticket":
      return ar ? "ما عندك تذكرة فعّالة مربوطة بهذا الرقم.\nخذ رقمك من صفحة المحل ثم اضغط «نبّهني على واتساب»." : "No active ticket is linked to this number. Take a number on the shop page, then tap «Alert me on WhatsApp».";
    case "unknown_code":
      return ar ? "ما لقينا التذكرة 🤔 يمكن انتهت.\nافتح صفحة تذكرتك واضغط «نبّهني على واتساب» مرة ثانية." : "We couldn't find that ticket, it may have ended. Open your ticket page and tap «Alert me on WhatsApp» again.";
    case "stopped":
      return ar ? "تم إيقاف التنبيهات ومسحنا رقمك من تذكرتك. نتمنى لك يوم حلو 🌿" : "Alerts stopped and your number was removed from the ticket. Have a nice day 🌿";
    default:
      return "";
  }
}

/** Sends one text. Returns null on success, or a short error. */
export async function waSend(cfg: WaConfig, to: string, body: string): Promise<string | null> {
  if (!cfg.ready || !cfg.phone_number_id || !cfg.access_token || !body) return "not_configured";
  try {
    const res = await fetch(`${GRAPH}/${cfg.phone_number_id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.access_token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body, preview_url: false } }),
    });
    if (res.ok) return null;
    const j = await res.json().catch(() => ({})) as { error?: { code?: number; message?: string } };
    return `${res.status} ${j.error?.code ?? ""} ${(j.error?.message ?? "").slice(0, 160)}`.trim();
  } catch (e) {
    return `network ${String((e as Error)?.message ?? e).slice(0, 120)}`;
  }
}

async function logSend(branch: string | null, kind: string, err: string | null) {
  try { await rpc("wa_log", { p_branch: branch, p_kind: kind, p_ok: !err, p_error: err }); } catch { /* logging never breaks delivery */ }
}

/** Called next to web push for the same events: messages linked tickets whose window is open. */
export async function deliverWhatsApp(items: { ticket_id: string; kind: string; stage?: string }[]) {
  const wanted = items.filter((i) => ["return_now", "called", "ready"].includes(i.kind) || (i.kind === "stage" && i.stage === "ready"));
  if (!wanted.length) return;
  let cfg: WaConfig;
  try { cfg = await waConfig(); } catch { return; }
  if (!cfg.ready) return;
  const targets = await rpc<WaTicket[]>("wa_targets", { p_tickets: wanted.map((i) => i.ticket_id) });
  await Promise.all(targets.map(async (t) => {
    const item = wanted.find((i) => i.ticket_id === t.ticket_id)!;
    const kind = item.kind === "stage" ? "stage_ready" : item.kind;
    const err = await waSend(cfg, t.wa_id!, waText(kind, t));
    await logSend(t.branch_id, kind, err);
  }));
}

/** HMAC-SHA256 of the raw body with the app secret, compared in constant time. */
export async function waSignatureOk(secret: string, raw: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7).toLowerCase();
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** Handles one webhook delivery (already signature-checked): links codes, answers status questions. */
export async function handleWebhook(payload: unknown) {
  const cfg = await waConfig(true);
  if (!cfg.ready) return;
  type Msg = { from?: string; type?: string; text?: { body?: string }; button?: { text?: string } };
  const entries = (payload as { entry?: { changes?: { value?: { messages?: Msg[] } }[] }[] })?.entry ?? [];
  for (const e of entries) for (const ch of e.changes ?? []) for (const m of ch.value?.messages ?? []) {
    if (!m.from) continue;
    const text = m.text?.body ?? m.button?.text ?? "";
    const r = await rpc<{ kind: string; ticket?: WaTicket; tickets?: WaTicket[] }>("wa_inbound", { p_wa_id: m.from, p_text: text });
    let reply = "", branch: string | null = null;
    if (r.kind === "linked" && r.ticket) { reply = waText("linked", r.ticket); branch = r.ticket.branch_id; }
    else if (r.kind === "status") reply = r.tickets?.length ? r.tickets.map((t) => waText("status", t)).join("\n\n") : waText("no_ticket", null);
    else reply = waText(r.kind, null);
    const err = await waSend(cfg, m.from, reply);
    await logSend(branch, r.kind, err);
  }
}
