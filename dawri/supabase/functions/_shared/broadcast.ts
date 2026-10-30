import { env } from "./db.ts";

/**
 * Realtime Broadcast on channel "branch:{public_id}" with no personal data.
 * Clients refetch public_branch / public_ticket / staff state when they hear it.
 */
export async function broadcast(publicIds: string | string[] | null | undefined) {
  const ids = (Array.isArray(publicIds) ? publicIds : [publicIds]).filter((x): x is string => !!x);
  if (!ids.length) return;
  const at = new Date().toISOString();
  try {
    const res = await fetch(`${env("SUPABASE_URL")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
        Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        messages: ids.map((id) => ({ topic: `branch:${id}`, event: "queue_changed", payload: { type: "queue_changed", at }, private: false })),
      }),
    });
    if (!res.ok) console.warn("broadcast failed", res.status, await res.text());
  } catch (e) {
    console.warn("broadcast error", e);
  }
}
