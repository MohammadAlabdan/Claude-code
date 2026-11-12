// Cron (every 15 min): for branches whose summary_time is this Riyadh quarter-hour, store and push the day's summary.
import { aiAvailable, summaryText } from "../_shared/ai.ts";
import { requireCron } from "../_shared/auth.ts";
import { rpc } from "../_shared/db.ts";
import { json, serve } from "../_shared/http.ts";
import { type DayStats, quietWindows, riyadhParts, summaryTemplate } from "../_shared/logic.ts";
import { pushOwner } from "../_shared/push.ts";

interface Due { branch_id: string; business_id: string; owner_user_id: string | null; name: string }

export default serve(async (req) => {
  requireCron(req);
  const today = riyadhParts().date;
  const due = await rpc<Due[]>("summary_due", {});
  const done: string[] = [];
  for (const b of due) {
    try {
      const stats = await rpc<DayStats & Record<string, unknown>>("day_stats", { p_branch: b.branch_id, p_day: today });
      const arrivals = await rpc<number[][]>("arrivals_matrix", { p_branch: b.branch_id, p_days: 28 });
      const open = await rpc<boolean[][]>("open_matrix", { p_branch: b.branch_id });
      const quiet = quietWindows(arrivals, open, 1)[0] ?? null;
      let text = summaryTemplate(stats, quiet);
      // AI wording only on plans that include AI features; the template is the fallback.
      if (aiAvailable() && (await rpc<boolean>("has_feature", { p_branch: b.branch_id, p_feature: "menu_photo_ai" }))) {
        try {
          text = await summaryText(b.business_id, { ...stats, quiet_window: quiet, shop: b.name });
        } catch (e) {
          console.warn("AI summary failed, using template", e);
        }
      }
      await rpc("save_summary", { p_branch: b.branch_id, p_day: today, p_text: text, p_stats: { ...stats, quiet_window: quiet } });
      if (b.owner_user_id) await pushOwner(b.owner_user_id, `ملخص المساء · ${b.name}`, text);
      done.push(b.branch_id);
    } catch (e) {
      console.error("summary failed for", b.branch_id, e);
    }
  }
  return json({ ok: true, summarized: done.length });
});
