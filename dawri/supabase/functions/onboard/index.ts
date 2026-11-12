// Self-setup wizard: business + first branch + services + first staff device in one transaction, 14-day full trial.
import { requireUser } from "../_shared/auth.ts";
import { env, rpcOk } from "../_shared/db.ts";
import { json, serve } from "../_shared/http.ts";

export default serve(async (req, body) => {
  const user = await requireUser(req);
  const r = await rpcOk<Record<string, unknown>>("onboard", { p_user: user.id, p: body });
  const site = env("SITE_URL", "");
  return json({
    ok: true,
    business_id: r.business_id, slug: r.slug, branch_id: r.branch_id, public_id: r.public_id, trial_until: r.trial_until,
    shop_url: `${site}/s/${r.public_id}`,
    pairing_url: `${site}/staff/pair#${r.pairing_token}`,
  });
});
