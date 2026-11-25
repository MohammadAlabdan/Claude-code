// /q/<token>: the quote as the customer sees it, laid out like a checkout. Accepting asks for a name, then leads to
// signup with the quote attached (/start?quote=…), where the shop gets the quoted plan.
import { h, icon, fill, store } from "../ui/dom.js";
import { errorText } from "../i18n.js";
import { openSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { Paper, sar, money, docDate } from "../billing/doc.js";

export async function render(ctx) {
  const { api, shell, params } = ctx;
  const token = params[0];
  shell.setTitle("عرض سعر");
  shell.app.classList.add("wide");
  ctx.onCleanup?.(() => shell.app.classList.remove("wide"));
  let data;
  try { data = await api.publicQuote(token); } catch (e) {
    fill(shell.content, h("div.empty", icon("file-off"), h("p", e.code === "quote_not_found" ? "العرض غير موجود أو أُلغي. تواصل مع من أرسله لك." : errorText(e)), h("a.btn", { href: "./about/" }, "تعرّف على جاي")));
    return;
  }
  const paint = () => {
    const q = data.quote, s = data.seller;
    const daysLeft = Math.ceil((new Date(q.valid_until + "T23:59:59+03:00") - Date.now()) / 864e5);
    const accepted = q.state === "accepted", expired = q.state === "expired";
    fill(shell.content, h("div.qpage", { "data-testid": "quote-page" },
      h("header.qp-hero",
        h("img.qp-logo", { src: "./assets/logo-full-dark.svg", alt: s.name }),
        h("div.qp-hello", h("span", `عرض سعر خاص · ${q.number}`), h("h1", `أهلاً ${q.contact_name || q.customer_name}`),
          h("p", `جهّزنا لـ«${q.customer_name}» عرضاً يخلّي الانتظار عندكم مريح ومنظّم، وزبائنكم يجون على دورهم.`)),
        h(`span.qp-valid${expired ? ".bad" : accepted ? ".ok" : ""}`, icon(accepted ? "circle-check" : expired ? "clock-x" : "clock"),
          accepted ? `قبلته بتاريخ ${docDate(q.accepted_at)}` : expired ? "انتهت صلاحية العرض" : `صالح حتى ${docDate(q.valid_until)} · باقي ${Math.max(0, daysLeft)} ${daysLeft === 1 ? "يوم" : "أيام"}`)),
      h("div.qp-grid",
        h("main.qp-main",
          q.plan_info ? h("section.qp-plan",
            h("span.qp-eyebrow", "الباقة المقترحة لكم"), h("h2", q.plan_info.name), h("p.muted", q.plan_info.tagline ?? ""),
            h("ul.qp-features", (q.plan_info.highlights ?? []).map((x) => h("li", icon("circle-check-filled"), h("span", x))))) : null,
          h("section.qp-items", h("h3", "تفاصيل العرض"),
            h("div.qp-lines", q.items.map((x) => h("div.qp-line", h("div", h("b", x.title), x.note ? h("small", x.note) : null),
              h("span.qp-qty", `× ${money(x.qty).replace(/\.00$/, "")}`), h("b.qp-amt", sar(x.amount)))))),
          q.notes ? h("section.qp-note", icon("message-2"), h("p", q.notes)) : null,
          h("section.qp-trust", [["device-mobile", "بدون أجهزة", "يشتغل على جوال الموظف"], ["gift", `تجربة ${data.trial_days} يوم`, "قبل أول دفعة"], ["refresh", "إلغاء متى ما حبيت", "بدون أسئلة"], ["shield-lock", "بياناتك محمية", "نسخ احتياطية يومية"]]
            .map(([ic, b, sm]) => h("div", icon(ic), h("b", b), h("small", sm))))),
        h("aside.qp-side",
          h("div.qp-checkout",
            h("h3", "ملخص العرض"),
            h("dl",
              h("div", h("dt", "المجموع"), h("dd", sar(q.subtotal))),
              Number(q.discount) > 0 ? h("div.save", h("dt", `خصم ${Number(q.discount_pct)}٪`), h("dd", `− ${sar(q.discount)}`)) : null,
              Number(q.vat) > 0 ? h("div", h("dt", `الضريبة ${Number(q.vat_rate)}٪`), h("dd", sar(q.vat))) : null),
            h("div.qp-total", h("span", "الإجمالي"), h("b", { "data-testid": "qp-total" }, money(q.total)), h("small", "ر.س")),
            !q.vat_rate || Number(q.vat_rate) === 0 ? h("p.muted.small", "غير خاضع لضريبة القيمة المضافة") : null,
            accepted ? [h("div.qp-done", { "data-testid": "quote-accepted" }, icon("confetti"), h("b", "تم قبول العرض"), h("span", "باقي خطوة: سجّل محلك ويشتغل خلال ١٠ دقائق")),
                        h("a.btn.btn-primary.btn-block.btn-xl", { href: `./start?quote=${token}`, "data-testid": "quote-signup" }, "سجّل محلك الآن")]
              : expired ? h("p.err", "انتهت صلاحية العرض. تواصل معنا ونجدده لك.")
              : h("button.btn.btn-primary.btn-block.btn-xl", { type: "button", "data-testid": "accept-quote", onclick: accept }, "أقبل العرض وابدأ"),
            h("button.btn.btn-ghost.btn-block", { type: "button", onclick: () => window.print() }, icon("printer"), "اطبع أو احفظ PDF"),
            s.phone || s.email ? h("p.muted.small.center", "عندك سؤال؟ ", [s.phone, s.email].filter(Boolean).map((x, i) => [i ? " · " : "", h("bdi", x)])) : null),
          s.iban ? h("div.qp-bank", h("span", "التحويل البنكي"), s.bank_name ? h("b", s.bank_name) : null, s.account_holder ? h("small", s.account_holder) : null, h("bdi", s.iban.replace(/(.{4})/g, "$1 ").trim())) : null)),
      !accepted && !expired ? h("div.qp-mbar.no-print", h("div", h("small", "الإجمالي"), h("b", sar(q.total))),
        h("button.btn.btn-primary", { type: "button", onclick: accept }, "أقبل العرض")) : null,
      h("div.print-only", Paper("quote", q, s))));
  };
  async function accept() {
    const name = h("input", { id: "accept-name", autocomplete: "name", placeholder: "اسمك الكامل" });
    const ok = h("input", { type: "checkbox", id: "accept-ok" });
    const err = h("p.err", { hidden: true });
    await openSheet({ title: "قبول العرض", body: [
      h("p.muted.small", `بالضغط على «أقبل» توافق على عرض السعر رقم ${data.quote.number} بإجمالي ${sar(data.quote.total)}. بعدها تسجّل محلك، وتظهر لك اتفاقية الاشتراك للموافقة.`),
      h("label.field", h("span", "الاسم"), name), h("label.check", ok, h("span", "قرأت العرض وأوافق عليه")), err],
      actions: [{ id: "accept-confirm", label: "أقبل العرض", primary: true, onClick: async (close) => {
        if (name.value.trim().length < 3) { err.hidden = false; err.textContent = "اكتب اسمك"; return; }
        if (!ok.checked) { err.hidden = false; err.textContent = "أكّد موافقتك على العرض"; return; }
        try { const r = await api.acceptQuote(token, name.value.trim()); data.quote = r.quote; store.set("dawri.quote", token); close(); toast("تم قبول العرض 🎉"); paint(); }
        catch (e) { err.hidden = false; err.textContent = e.code === "quote_expired" ? "انتهت صلاحية العرض" : errorText(e); }
      } }, { label: "إلغاء", ghost: true }] });
  }
  paint();
}
