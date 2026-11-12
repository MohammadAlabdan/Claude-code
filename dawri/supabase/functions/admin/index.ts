// Platform admin: list businesses, change plan and dates, activate/deactivate, read-only branch view.
import { requireUser } from "../_shared/auth.ts";
import { rpcOk } from "../_shared/db.ts";
import { HttpError, json, serve, uuid } from "../_shared/http.ts";

export default serve(async (req, body) => {
  const user = await requireUser(req);
  switch (body.action) {
    case "list":
      return json(await rpcOk("a_businesses", { p_user: user.id }));
    case "update_business":
      return json(await rpcOk("a_update_business", { p_user: user.id, p_business: uuid(body, "business_id"), p: body.changes ?? {} }));
    case "branch_dashboard":
      return json(await rpcOk("o_dashboard", { p_user: user.id, p_branch: uuid(body, "branch_id"), p_range: body.range ?? "7d" }));
    default:
      throw new HttpError("invalid_action");
  }
});
