// /doc/invoice/<id> and /doc/contract/<id>: a printable document for its owner or the platform admin.
import { h, icon, fill } from "../ui/dom.js";
import { errorText } from "../i18n.js";
import { requireSession } from "./auth.js";
import { Paper, ContractPaper, DocFrame } from "../billing/doc.js";

export async function render(ctx) {
  const { api, shell, params } = ctx;
  const [kind, id] = params;
  await requireSession(ctx, { redirect: `/doc/${kind}/${id}` });
  shell.setTitle(kind === "invoice" ? "فاتورة" : "الاتفاقية");
  shell.app.classList.add("wide");
  ctx.onCleanup?.(() => shell.app.classList.remove("wide"));
  const action = kind === "invoice" ? ["invoice", { invoice_id: id }] : ["contract", { contract_id: id }];
  let r, admin = false;
  try { r = await api.owner(...action); } catch {
    try { r = await api.admin(...action); admin = true; } catch (e) { fill(shell.content, h("div.empty", icon("file-off"), h("p", errorText(e)))); return; }
  }
  const back = admin ? "./admin" : "./owner/settings";
  fill(shell.content, kind === "invoice"
    ? DocFrame(Paper("invoice", r.invoice, r.invoice.seller), { back })
    : DocFrame(ContractPaper(r.contract, r.seller), { back }));
}
