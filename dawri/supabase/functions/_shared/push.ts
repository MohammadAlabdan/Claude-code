import webpush from "web-push";
import { adminClient } from "./db.ts";
import { customerPush, ownerBusyAlert, quietPush } from "./i18n.ts";

let configured: boolean | null = null;

function configure(): boolean {
  if (configured !== null) return configured;
  const pub = Deno.env.get("VAPID_PUBLIC_KEY");
  const priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) {
    console.warn("VAPID keys missing: push notifications are disabled");
    return (configured = false);
  }
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@dawri.app", pub, priv);
  return (configured = true);
}

interface Sub { id: string; endpoint: string; p256dh: string; auth: string }

/** Sends one payload to each subscription; deletes subscriptions the push service reports gone (404/410). */
async function sendAll(subs: Sub[], payload: Record<string, unknown>) {
  if (!configure() || !subs.length) return;
  const gone: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload), { TTL: 600, urgency: "high" });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(s.id);
      else console.warn("push failed", status ?? e);
    }
  }));
  if (gone.filter(Boolean).length) await adminClient().from("push_subscriptions").delete().in("id", gone.filter(Boolean));
}

export interface Notify {
  ticket_id?: string;
  owner_branch_id?: string;
  kind: string;
  stage?: string;
  count?: number;
  // kind "quiet": the watch row is already deleted, so it carries its own subscription
  endpoint?: string;
  p256dh?: string;
  auth?: string;
  lang?: "ar" | "en";
  shop?: string;
  public_id?: string;
}

/** Delivers the "notify" list returned by a SQL action. */
export async function deliver(notify: Notify[] | undefined) {
  if (!notify?.length) return;
  const db = adminClient();
  const ticketIds = notify.filter((n) => n.ticket_id).map((n) => n.ticket_id!);
  if (ticketIds.length) {
    const [{ data: tickets }, { data: subs }] = await Promise.all([
      db.from("tickets").select("id, number, lang, receipt_code, branches(name, public_id)").in("id", ticketIds),
      db.from("push_subscriptions").select("id, endpoint, p256dh, auth, ticket_id").in("ticket_id", ticketIds),
    ]);
    await Promise.all(notify.filter((n) => n.ticket_id).map((n) => {
      const t = tickets?.find((x) => x.id === n.ticket_id) as
        | { number: number; lang: "ar" | "en"; receipt_code: string | null; branches: { name: string; public_id: string } | null }
        | undefined;
      if (!t) return;
      const msg = customerPush(n.kind, t.lang, { number: t.number, stage: n.stage, receipt_code: t.receipt_code ?? undefined, shop: t.branches?.name });
      return sendAll((subs ?? []).filter((s) => s.ticket_id === n.ticket_id),
        { ...msg, kind: n.kind, tag: `ticket-${n.ticket_id}`, url: `/s/${t.branches?.public_id ?? ""}`, vibrate: n.kind === "called" || n.kind === "ready" || n.stage === "ready" });
    }));
  }
  await Promise.all(notify.filter((n) => n.kind === "quiet" && n.endpoint).map((n) =>
    sendAll([{ id: "", endpoint: n.endpoint!, p256dh: n.p256dh!, auth: n.auth! }],
      { ...quietPush(n.lang ?? "ar", n.shop ?? "دوري", n.count ?? 0), kind: "quiet", tag: `quiet-${n.public_id}`, url: `/s/${n.public_id ?? ""}`, vibrate: true })));
  for (const n of notify.filter((x) => x.owner_branch_id)) {
    const { data: owner } = await db.from("branches").select("businesses(owner_user_id)").eq("id", n.owner_branch_id!).single();
    const ownerId = (owner as { businesses?: { owner_user_id?: string } } | null)?.businesses?.owner_user_id;
    if (!ownerId) continue;
    const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("owner_user_id", ownerId);
    await sendAll(subs ?? [], { ...ownerBusyAlert(n.count ?? 0), kind: n.kind, url: "/owner" });
  }
}

/** Push a plain message to every device of an owner (evening summary). */
export async function pushOwner(ownerId: string, title: string, body: string, url = "/owner") {
  const { data: subs } = await adminClient().from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("owner_user_id", ownerId);
  await sendAll(subs ?? [], { title, body, kind: "summary", url });
}
