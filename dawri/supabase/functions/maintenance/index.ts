// Cron (every 15 min): day-end cancellation, data retention cleanups, busy-alert re-arming.
import { requireCron } from "../_shared/auth.ts";
import { broadcast } from "../_shared/broadcast.ts";
import { rpc } from "../_shared/db.ts";
import { json, serve } from "../_shared/http.ts";

export default serve(async (req) => {
  requireCron(req);
  const r = await rpc<{ broadcast: string[] } & Record<string, unknown>>("maintenance_run", {});
  await broadcast(r.broadcast);
  return json({ ok: true, ...r });
});
