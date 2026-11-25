// The owner's side: the agreement to accept after signup (and after each new version), and «اشتراكي وفواتيري».
import { h, icon, fill, card } from "../ui/dom.js";
import { errorText } from "../i18n.js";
import { openSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { renderBody, sar, docDate, statusPill } from "./doc.js";

/** Read the agreement and accept it with a typed name. Resolves true when accepted. */
export async function contractSheet(api, billing) {
  const draft = billing.draft;
  if (!draft) return false;
  const name = h("input", { id: "contract-name", autocomplete: "name", placeholder: "اسمك الكامل كما يظهر في الهوية" });
  const ok = h("input", { type: "checkbox", id: "contract-ok" });
  const err = h("p.err", { hidden: true });
  let accepted = false;
  await openSheet({ title: draft.title, body: [
    billing.contract ? h("p.banner.warn", icon("refresh"), h("span", "صدر إصدار جديد من الاتفاقية، راجعه ووافق عليه.")) : null,
    h("div.contract-read", { tabindex: "0", "aria-label": "نص الاتفاقية" }, renderBody(draft.body)),
    h("label.field", h("span", "الاسم (توقيعك الإلكتروني)"), name),
    h("label.check", ok, h("span", "قرأت الاتفاقية وأوافق عليها")), err],
    actions: [{ id: "contract-accept", label: "أوافق على الاتفاقية", primary: true, onClick: async (close) => {
      if (name.value.trim().length < 3) { err.hidden = false; err.textContent = "اكتب اسمك الكامل"; return; }
      if (!ok.checked) { err.hidden = false; err.textContent = "أكّد إنك قرأت الاتفاقية"; return; }
      try { await api.owner("contract_accept", { version: draft.version, name: name.value.trim() }); accepted = true; close(); toast("تمت الموافقة، شكراً لثقتك 🤝"); }
      catch (e) { err.hidden = false; err.textContent = e.code === "contract_changed" ? "تحدّثت الاتفاقية الحين، افتحها مرة ثانية" : errorText(e); }
    } }, { label: "لاحقاً", ghost: true }] });
  return accepted;
}

/** Banner on the owner's home while the agreement waits. */
export function contractBanner(api, billing, onDone) {
  if (!billing?.contract_pending || !billing.draft) return null;
  return h("section.card.contract-banner", { "data-testid": "contract-banner" },
    h("div.card-head", icon("file-certificate"), h("h3", billing.contract ? "اتفاقية محدّثة بانتظار موافقتك" : "خطوة أخيرة: اتفاقية الاشتراك")),
    h("p.muted.small", "اقرأها في دقيقتين، ووافق عليها باسمك. تحفظ حقك وحقنا، وتبقى نسخة منها عندك دائماً."),
    h("button.btn.btn-primary.btn-block", { type: "button", "data-testid": "open-contract", onclick: async () => { if (await contractSheet(api, billing)) onDone?.(); } }, icon("signature"), "اقرأ ووافق"));
}

/** «اشتراكي وفواتيري» in the owner's settings. */
export function billingCard(api, billing, onChange) {
  if (!billing) return null;
  const inv = billing.invoices ?? [];
  const s = billing.seller ?? {};
  const unpaid = inv.filter((i) => i.status === "unpaid");
  return card("اشتراكي وفواتيري", "receipt",
    h("div.list",
      h("div.list-item", icon("file-certificate"), h("div.grow", h("div.title", "اتفاقية الاشتراك"),
        h("div.muted.small", billing.contract && !billing.contract_pending ? `وافقت عليها ${billing.contract.accepted_name} · ${docDate(billing.contract.accepted_at)}` : "بانتظار موافقتك")),
        billing.contract_pending
          ? h("button.btn.btn-sm.btn-primary", { type: "button", onclick: async () => { if (await contractSheet(api, billing)) onChange?.(); } }, "اقرأ ووافق")
          : h("a.btn.btn-sm", { href: `./doc/contract/${billing.contract.id}`, "data-testid": "my-contract" }, "عرض"))),
    unpaid.length && s.iban ? h("div.pay-box", h("b", `عليك ${sar(unpaid.reduce((a, i) => a + Number(i.total), 0))}`),
      h("span.muted.small", `حوّل المبلغ إلى ${s.bank_name ?? "الحساب"}${s.account_holder ? ` (${s.account_holder})` : ""}`), h("bdi.iban", s.iban.replace(/(.{4})/g, "$1 ").trim())) : null,
    h("div.doc-list", inv.length ? inv.map((i) => h("a.doc-row", { href: `./doc/invoice/${i.id}`, "data-invoice": i.number },
      h("span.dr-main", h("b", i.number), h("small", i.period_start ? `${docDate(i.period_start)} – ${docDate(i.period_end)}` : docDate(i.issued_at))),
      h("span.dr-amt", sar(i.total)), statusPill(i.status), icon("chevron-left")))
      : [h("p.muted.small", "ما فيه فواتير بعد. أول فاتورة تظهر هنا بعد الاشتراك.")]));
}

export { fill };
