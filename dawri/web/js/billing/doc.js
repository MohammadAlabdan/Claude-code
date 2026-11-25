// Sales documents: one paper design for quotes, invoices and the agreement, the same totals arithmetic as
// billing_compute() in SQL, and the ZATCA simplified-invoice QR (TLV, base64) once the seller is VAT-registered.
import { h, icon } from "../ui/dom.js";
import { QR } from "../ui/qr.js";

export const money = (n) => Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const sar = (n) => `${money(n)} ر.س`;
export const docDate = (d) => (d ? new Date(d).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { year: "numeric", month: "long", day: "numeric" }) : "—");
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/** Same rules as billing_compute(): line amounts, discount on the subtotal, VAT only when registered. */
export function compute(items, discountPct = 0, vat = { registered: false, rate: 15 }) {
  const lines = (items ?? []).filter((x) => String(x.title ?? "").trim()).map((x) => {
    const qty = Math.max(0, Number(x.qty) || 0), unit = Math.max(0, Number(x.unit_price) || 0);
    return { ...x, qty, unit_price: r2(unit), amount: r2(qty * unit) };
  });
  const subtotal = r2(lines.reduce((a, x) => a + x.amount, 0));
  const pct = Math.min(100, Math.max(0, Number(discountPct) || 0));
  const discount = r2(subtotal * pct / 100);
  const vatRate = vat.registered ? Number(vat.rate) || 0 : 0;
  const vatAmount = r2((subtotal - discount) * vatRate / 100);
  return { items: lines, subtotal, discount_pct: pct, discount, vat_rate: vatRate, vat: vatAmount, total: r2(subtotal - discount + vatAmount) };
}

/** ZATCA phase-1 QR payload: seller, VAT number, time, total, VAT — each as tag/length/value, then base64. */
export function zatcaTlv(seller, vatNumber, issuedAt, total, vat) {
  const enc = new TextEncoder();
  const parts = [seller, vatNumber, new Date(issuedAt).toISOString(), Number(total).toFixed(2), Number(vat).toFixed(2)].map((v, i) => {
    const b = enc.encode(String(v));
    return [i + 1, b.length, ...b];
  }).flat();
  let bin = ""; for (const b of parts) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Agreement text: "## heading", "- item" and **bold**, rendered without innerHTML. */
export function renderBody(text) {
  const out = []; let list = null;
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) => (p.startsWith("**") ? h("b", p.slice(2, -2)) : p));
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    if (line.startsWith("## ")) { list = null; out.push(h("h3", inline(line.slice(3)))); continue; }
    if (line.startsWith("- ")) { if (!list) { list = h("ul"); out.push(list); } list.append(h("li", inline(line.slice(2)))); continue; }
    list = null; out.push(h("p", inline(line)));
  }
  return out;
}

const STATUS = {
  draft: ["مسودة", "muted"], sent: ["أُرسل", "info"], viewed: ["شاهده العميل", "info"], accepted: ["مقبول", "ok"],
  expired: ["منتهي", "warn"], cancelled: ["ملغى", "bad"], unpaid: ["غير مدفوعة", "warn"], paid: ["مدفوعة", "ok"], void: ["ملغاة", "bad"],
};
export const statusPill = (s) => { const [label, tone] = STATUS[s] ?? [s, "muted"]; return h(`span.pill.${tone}`, { "data-status": s }, label); };

function party(title, rows) {
  return h("div.p-party", h("span.p-label", title), ...rows.filter(([, v]) => v).map(([k, v], i) => (i === 0 ? h("b", v) : h("span", k ? `${k}: ` : "", h("bdi", v)))));
}

/**
 * The paper. kind: quote | invoice. d: the document row; seller: billing_seller(); extras: {preview, status}
 */
export function Paper(kind, d, seller, { preview = false } = {}) {
  const isQuote = kind === "quote";
  const tax = !isQuote && d.is_tax_invoice;
  const title = isQuote ? "عرض سعر" : tax ? "فاتورة ضريبية مبسطة" : "فاتورة";
  const buyer = isQuote ? { name: d.customer_name, contact: d.contact_name, phone: d.phone, email: d.email } : (d.buyer ?? {});
  const state = d.state ?? d.status;
  const logo = h("img.p-logo", { src: "./assets/logo-full.svg", alt: seller?.name ?? "جاي" });
  const meta = isQuote
    ? [["رقم العرض", d.number], ["التاريخ", docDate(d.created_at)], ["صالح حتى", docDate(d.valid_until)]]
    : [["رقم الفاتورة", d.number], ["تاريخ الإصدار", docDate(d.issued_at)], d.period_start ? ["الفترة", `${docDate(d.period_start)} – ${docDate(d.period_end)}`] : null,
       d.status === "paid" ? ["تاريخ الدفع", docDate(d.paid_at)] : ["تاريخ الاستحقاق", docDate(d.due_date)]].filter(Boolean);
  const items = d.items ?? [];
  const qr = tax && seller?.vat_number ? QR(zatcaTlv(seller.legal_name || seller.name, seller.vat_number, d.issued_at, d.total, d.vat), { label: "رمز الفاتورة الضريبية" }) : null;

  return h(`article.paper.${kind}`, { "data-testid": `paper-${kind}`, "aria-label": `${title} ${d.number ?? ""}` },
    preview && !d.number ? h("div.p-ribbon", "معاينة") : null,
    state === "void" ? h("div.p-stamp.bad", "ملغاة") : state === "paid" ? h("div.p-stamp.ok", "مدفوعة") : null,
    h("header.p-head",
      h("div.p-brand", logo, h("div.p-seller",
        h("b", seller?.legal_name || seller?.name || "جاي"),
        seller?.id ? h("span", `${seller.id_label}: `, h("bdi", seller.id)) : null,
        tax && seller?.vat_number ? h("span", "الرقم الضريبي: ", h("bdi", seller.vat_number)) : null,
        [seller?.city, seller?.address].filter(Boolean).length ? h("span", [seller.city, seller.address].filter(Boolean).join(" · ")) : null)),
      h("div.p-title", h("h1", title), h("dl", meta.map(([k, v]) => h("div", h("dt", k), h("dd", h("bdi", v ?? "—"))))))),
    h("section.p-parties",
      party(isQuote ? "مقدّم إلى" : "العميل", [["", buyer.name], ["المسؤول", buyer.contact], ["الجوال", buyer.phone], ["البريد", buyer.email], ["الرقم الضريبي", buyer.vat_number]]),
      isQuote && d.plan_info ? h("div.p-plan", h("span.p-label", "الباقة المقترحة"), h("b", d.plan_info.name), h("span", d.plan_info.tagline ?? ""),
        (d.plan_info.highlights ?? []).length ? h("ul", d.plan_info.highlights.slice(0, 5).map((x) => h("li", x))) : null) : null),
    h("div.p-table-wrap", h("table.p-table",
      h("thead", h("tr", h("th", "#"), h("th", "البيان"), h("th.n", "الكمية"), h("th.n", "سعر الوحدة"), h("th.n", "المبلغ"))),
      h("tbody", items.map((x, i) => h("tr", h("td.idx", String(i + 1)), h("td", h("b", x.title), x.note ? h("small", x.note) : null),
        h("td.n", money(x.qty).replace(/\.00$/, "")), h("td.n", money(x.unit_price)), h("td.n", money(x.amount ?? x.qty * x.unit_price))))))),
    h("section.p-sum",
      h("div.p-notes",
        d.notes ? h("p", h("span.p-label", "ملاحظات"), d.notes) : null,
        seller?.iban ? h("div.p-bank", h("span.p-label", "بيانات التحويل"),
          seller.bank_name ? h("span", seller.bank_name) : null, seller.account_holder ? h("span", seller.account_holder) : null,
          h("bdi.iban", seller.iban.replace(/(.{4})/g, "$1 ").trim())) : null,
        isQuote && seller?.payment_terms ? h("p.small", seller.payment_terms) : null),
      h("dl.p-totals",
        h("div", h("dt", "المجموع"), h("dd", money(d.subtotal))),
        Number(d.discount) > 0 ? h("div", h("dt", `الخصم (${Number(d.discount_pct)}٪)`), h("dd", `− ${money(d.discount)}`)) : null,
        Number(d.vat_rate) > 0 ? h("div", h("dt", `ضريبة القيمة المضافة (${Number(d.vat_rate)}٪)`), h("dd", money(d.vat))) : null,
        h("div.grand", h("dt", isQuote ? "الإجمالي" : "الإجمالي المستحق"), h("dd", h("b", money(d.total)), h("small", " ر.س"))),
        !tax ? h("p.p-vatnote", "غير خاضع لضريبة القيمة المضافة") : null)),
    h("footer.p-foot",
      qr ? h("div.p-qr", qr) : null,
      h("div", h("p", isQuote ? "دورك جاي.. وأنت مرتاح." : seller?.invoice_note ?? ""),
        h("p.small", [seller?.phone, seller?.email].filter(Boolean).map((x, i) => [i ? " · " : "", h("bdi", x)])),
        d.status === "void" && d.void_reason ? h("p.small.bad", `سبب الإلغاء: ${d.void_reason}`) : null,
        d.status === "paid" && d.pay_method ? h("p.small", `طريقة الدفع: ${{ bank: "تحويل بنكي", cash: "نقداً", card: "بطاقة", other: "أخرى" }[d.pay_method]}${d.pay_reference ? ` · المرجع: ${d.pay_reference}` : ""}`) : null)));
}

/** The signed agreement as a paper. */
export function ContractPaper(c, seller) {
  return h("article.paper.contract", { "data-testid": "paper-contract" },
    h("header.p-head",
      h("div.p-brand", h("img.p-logo", { src: "./assets/logo-full.svg", alt: "جاي" })),
      h("div.p-title", h("h1", c.title), h("dl",
        h("div", h("dt", "الإصدار"), h("dd", String(c.version))),
        c.accepted_at ? h("div", h("dt", "تاريخ الموافقة"), h("dd", docDate(c.accepted_at))) : null))),
    h("div.p-body", renderBody(c.body)),
    c.accepted_at ? h("footer.p-sign",
      h("div", h("span.p-label", "وافق عليها إلكترونياً"), h("b", c.accepted_name), h("span", c.business_name ?? ""), h("span", new Date(c.accepted_at).toLocaleString("ar-SA-u-ca-gregory-nu-latn"))),
      h("div", h("span.p-label", "بصمة النص (SHA-256)"), h("bdi.hash", c.body_sha256 ?? ""))) : null);
}

/** Printable page frame: toolbar (print, back) + the paper. */
export function DocFrame(paper, { back = "./", extra = null } = {}) {
  return h("div.doc-frame",
    h("div.doc-tools.no-print",
      h("a.btn.btn-ghost.btn-sm", { href: back }, icon("arrow-right"), "رجوع"),
      extra,
      h("button.btn.btn-primary.btn-sm", { type: "button", "data-testid": "print-doc", onclick: () => window.print() }, icon("printer"), "اطبع أو احفظ PDF")),
    paper);
}
