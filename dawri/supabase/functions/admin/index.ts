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
    case "whatsapp":
      return json(await rpcOk("a_whatsapp", { p_user: user.id }));
    case "whatsapp_save": {
      const w = (body.whatsapp ?? {}) as Record<string, unknown>;
      const s = (k: string, max: number) => (typeof w[k] === "string" ? (w[k] as string).trim().slice(0, max) : "");
      return json(await rpcOk("a_whatsapp_save", { p_user: user.id, p: {
        display_number: s("display_number", 20), phone_number_id: s("phone_number_id", 30),
        access_token: s("access_token", 1000), app_secret: s("app_secret", 200),
        ...(typeof w.enabled === "boolean" ? { enabled: w.enabled } : {}) } }));
    }
    // ---------- sales documents ----------
    case "billing":
      return json(await rpcOk("a_billing", { p_user: user.id }));
    case "billing_settings_save":
      return json(await rpcOk("a_billing_settings_save", { p_user: user.id, p: body.settings ?? {} }));
    case "product_save":
      return json(await rpcOk("a_product_save", { p_user: user.id, p: body.product ?? {} }));
    case "quote_save":
      return json(await rpcOk("a_quote_save", { p_user: user.id, p: body.quote ?? {} }));
    case "quote_status":
      return json(await rpcOk("a_quote_status", { p_user: user.id, p_quote: uuid(body, "quote_id"), p_action: String(body.status ?? "") }));
    case "invoice_create":
      return json(await rpcOk("a_invoice_create", { p_user: user.id, p: body.invoice ?? {} }));
    case "invoice_update":
      return json(await rpcOk("a_invoice_update", { p_user: user.id, p_invoice: uuid(body, "invoice_id"), p: body.changes ?? {} }));
    case "invoice":
      return json(await rpcOk("a_invoice", { p_user: user.id, p_invoice: uuid(body, "invoice_id") }));
    case "contract_template_save":
      return json(await rpcOk("a_contract_template_save", { p_user: user.id, p_title: String(body.title ?? "").slice(0, 120), p_body: String(body.body ?? "").slice(0, 30000) }));
    case "contract":
      return json(await rpcOk("a_contract", { p_user: user.id, p_contract: uuid(body, "contract_id") }));
    case "branch_dashboard":
      return json(await rpcOk("o_dashboard", { p_user: user.id, p_branch: uuid(body, "branch_id"), p_range: body.range ?? "7d" }));
    default:
      throw new HttpError("invalid_action");
  }
});
