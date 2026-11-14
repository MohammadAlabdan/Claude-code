// Platform admin: list businesses, change plan and dates, activate/deactivate, read-only branch view.
import { requireUser } from "../_shared/auth.ts";
import { rpcOk } from "../_shared/db.ts";
import { HttpError, int, json, serve, uuid } from "../_shared/http.ts";

export default serve(async (req, body) => {
  const user = await requireUser(req);
  switch (body.action) {
    case "list":
      return json(await rpcOk("a_businesses", { p_user: user.id }));
    case "insights":
      return json(await rpcOk("a_insights", { p_user: user.id, p_days: int(body, "days", 7, 180, 30), p_demo: body.include_demo === true }));
    case "update_business":
      return json(await rpcOk("a_update_business", { p_user: user.id, p_business: uuid(body, "business_id"), p: body.changes ?? {} }));
    case "create_business":
      return json(await rpcOk("a_create_business", { p_user: user.id, p: body.business ?? {} }));
    case "delete_business":
      return json(await rpcOk("a_delete_business", { p_user: user.id, p_business: uuid(body, "business_id"), p_delete_owner: body.delete_owner === true }));
    case "branch_dashboard":
      return json(await rpcOk("o_dashboard", { p_user: user.id, p_branch: uuid(body, "branch_id"), p_range: body.range ?? "7d" }));
    default:
      throw new HttpError("invalid_action");
  }
});
