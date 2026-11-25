// «المبيعات» in the platform dashboard: quotes → agreement → invoices, the product catalog and every document setting.
// Editors open in a two-pane studio: the form on one side, the live document on the other.
import { h, icon, fill, store } from "../ui/dom.js";
import { errorText } from "../i18n.js";
import { openSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { Paper, ContractPaper, compute, sar, money, docDate, statusPill } from "../billing/doc.js";

const CATS = { barber: "حلاق", salon: "مشغل نسائي", cafe: "مقهى", restaurant: "مطعم", bakery: "مخبز", clinic: "عيادة", lab: "مختبر",
  carwash: "مغسلة سيارات", phone_repair: "صيانة جوالات", other: "أخرى" };
const SECTIONS = [["quotes", "عروض الأسعار", "file-dollar"], ["invoices", "الفواتير", "receipt"], ["products", "الباقات والمنتجات", "package"],
  ["contract", "الاتفاقية", "file-certificate"], ["settings", "بيانات المنشأة", "building-bank"]];
const PLACEHOLDERS = [["{{business_name}}", "اسم المحل"], ["{{owner_email}}", "بريد المالك"], ["{{plan_name}}", "الباقة"], ["{{plan_price}}", "سعر الباقة"],
  ["{{seller_name}}", "اسم المنشأة"], ["{{seller_id}}", "رقم الوثيقة"], ["{{trial_days}}", "أيام التجربة"], ["{{annual_free_months}}", "أشهر مجانية"],
  ["{{payment_terms}}", "شروط الدفع"], ["{{date}}", "التاريخ"]];
const METHODS = { bank: "تحويل بنكي", cash: "نقداً", card: "بطاقة", other: "أخرى" };

const field = (label, input, hint) => h("label.field", h("span", label), input, hint ? h("small.muted", hint) : null);
const inp = (id, attrs = {}) => h("input", { id, autocomplete: "off", ...attrs });
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const shareUrl = (q) => `${new URL(".", document.baseURI).href}q/${q.token}`;

/** Full-screen two-pane editor. Returns {close}. */
function studio({ title, form, preview, actions, testid }) {
  let mode = "form";
  const prev = h("div.st-preview", { "aria-label": "المعاينة" });
  const paint = () => fill(prev, preview());
  const tabs = h("div.seg.st-tabs", { role: "tablist" }, [["form", "البيانات"], ["preview", "المعاينة"]].map(([k, l]) =>
    h("button", { type: "button", "aria-pressed": String(k === mode), onclick: (e) => { mode = k; root.dataset.mode = k; e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); if (k === "preview") paint(); } }, l)));
  const close = () => { root.remove(); document.removeEventListener("keydown", onKey); document.body.classList.remove("studio-open"); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const root = h("div.studio", { role: "dialog", "aria-modal": "true", "aria-label": title, "data-mode": mode, "data-testid": testid },
    h("header.st-head", h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: close, "aria-label": "إغلاق" }, icon("x")), h("h2", title), tabs,
      h("div.st-actions", actions.map((a) => h(`button.btn.btn-sm${a.primary ? ".btn-primary" : ""}`, { type: "button", "data-action": a.id, onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; try { await a.onClick({ close, paint }); } finally { b.disabled = false; } } }, a.icon ? icon(a.icon) : null, a.label)))),
    h("div.st-body", h("div.st-form", form), prev));
  document.body.append(root); document.body.classList.add("studio-open"); document.addEventListener("keydown", onKey);
  paint();
  return { close, paint };
}

export function salesView({ api, reload }) {
  let section = store.get("dawri.sales.section") ?? "quotes";
  let d = null;
  const root = h("div.sales", h("p.muted", "جارٍ التحميل…"));
  const vat = () => ({ registered: d.settings.vat_registered, rate: d.settings.vat_rate });
  const seller = () => ({ name: d.settings.seller_name, legal_name: d.settings.seller_legal_name, id_label: d.settings.seller_id_label, id: d.settings.seller_id,
    vat_registered: d.settings.vat_registered, vat_number: d.settings.vat_number, bank_name: d.settings.bank_name, account_holder: d.settings.account_holder,
    iban: d.settings.iban, phone: d.settings.phone, email: d.settings.email, city: d.settings.city, address: d.settings.address,
    payment_terms: d.settings.payment_terms, invoice_note: d.settings.invoice_note });
  const product = (code) => d.products.find((p) => p.code === code);

  async function load() { d = await api.admin("billing"); draw(); }
  const run = async (fn, ok) => { try { const r = await fn(); if (r && r.settings) d = r; else await load(); if (ok) toast(ok); draw(); return r; } catch (x) { toast(errorText(x), { error: true }); throw x; } };

  function draw() {
    const open = d.quotes.filter((q) => ["sent", "viewed"].includes(q.state));
    const month = new Date().toISOString().slice(0, 7);
    const paidMonth = d.invoices.filter((i) => i.status === "paid" && String(i.paid_at ?? "").slice(0, 7) === month);
    const unpaid = d.invoices.filter((i) => i.status === "unpaid");
    const decided = d.quotes.filter((q) => ["accepted", "cancelled", "expired"].includes(q.state));
    const rate = decided.length ? Math.round(100 * d.quotes.filter((q) => q.state === "accepted").length / decided.length) : null;
    fill(root,
      h("div.sales-kpis",
        tile("file-dollar", "عروض مفتوحة", String(open.length), sar(open.reduce((a, q) => a + Number(q.total), 0))),
        tile("circle-check", "نسبة القبول", rate == null ? "—" : `${rate}٪`, `${d.quotes.filter((q) => q.state === "accepted").length} عرض مقبول`),
        tile("cash", "محصّل هذا الشهر", sar(paidMonth.reduce((a, i) => a + Number(i.total), 0)), `${paidMonth.length} فاتورة`),
        tile("clock-dollar", "مستحق غير مدفوع", sar(unpaid.reduce((a, i) => a + Number(i.total), 0)), `${unpaid.length} فاتورة`, unpaid.length ? "warn" : null)),
      h("nav.sales-nav", { role: "tablist", "aria-label": "أقسام المبيعات" }, SECTIONS.map(([k, l, ic]) =>
        h("button", { type: "button", role: "tab", "aria-selected": String(section === k), "data-sales": k, onclick: () => { section = k; store.set("dawri.sales.section", k); draw(); } }, icon(ic), h("span", l)))),
      h("div.sales-body", { "data-section": section },
        section === "quotes" ? quotesSection() : section === "invoices" ? invoicesSection() : section === "products" ? productsSection()
          : section === "contract" ? contractSection() : settingsSection()));
  }
  const tile = (ic, label, value, sub, tone) => h(`div.s-tile${tone ? "." + tone : ""}`, icon(ic), h("span", label), h("b", value), h("small", sub));

  // ===================== quotes =====================
  function quotesSection() {
    let q = "", filter = "all";
    const list = h("div.doc-list");
    const paint = () => fill(list, ...rows());
    const rows = () => {
      const r = d.quotes.filter((x) => (filter === "all" || x.state === filter) && (!q || `${x.customer_name} ${x.number}`.includes(q)));
      if (!r.length) return [h("div.empty-doc", icon("file-dollar"), h("b", d.quotes.length ? "ما فيه عروض بهذا البحث" : "أول عرض سعر يبدأ من هنا"), h("span", "اختر الباقة والإضافات، والنظام يحسب كل شي ويجهّز رابط العرض للعميل."))];
      return r.map((x) => h("button.doc-row", { type: "button", "data-quote": x.number, onclick: () => quoteMenu(x) },
        h("span.dr-main", h("b", x.customer_name), h("small", `${x.number} · ${docDate(x.created_at)}${x.plan_info ? ` · ${x.plan_info.name}` : ""}`)),
        h("span.dr-amt", sar(x.total)), statusPill(x.state), icon("chevron-left")));
    };
    paint();
    return [
      h("div.sales-bar",
        h("button.btn.btn-primary", { type: "button", "data-testid": "new-quote", onclick: () => quoteEditor() }, icon("plus"), "عرض سعر جديد"),
        h("input.search", { type: "search", placeholder: "ابحث باسم العميل أو رقم العرض", "aria-label": "بحث", oninput: (e) => { q = e.target.value.trim(); paint(); } }),
        h("div.chips", [["all", "الكل"], ["draft", "مسودة"], ["viewed", "شاهده"], ["accepted", "مقبول"], ["expired", "منتهي"]].map(([k, l]) =>
          h("button.chip", { type: "button", "aria-pressed": String(filter === k), onclick: (e) => { filter = k; e.currentTarget.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget))); paint(); } }, l)))),
      list];
  }

  function quoteMenu(x) {
    const editable = ["draft", "sent", "viewed", "expired"].includes(x.state) && x.status !== "accepted";
    const acts = [];
    if (editable) acts.push({ id: "q-edit", label: "فتح وتعديل", primary: true, onClick: (c) => { c(); quoteEditor(x); } });
    if (x.status !== "draft" && x.status !== "cancelled") acts.push({ id: "q-share", label: "مشاركة الرابط مع العميل", onClick: (c) => { c(); shareSheet(x); } });
    if (x.status === "draft") acts.push({ id: "q-send", label: "اعتمد العرض وجهّز الرابط", primary: !editable, onClick: async (c) => { c(); const r = await run(() => api.admin("quote_status", { quote_id: x.id, status: "send" })); shareSheet(r.quote); } });
    if (x.status === "accepted") acts.push({ id: "q-invoice", label: "أصدر فاتورة من العرض", primary: true, onClick: (c) => { c(); invoiceEditor({ quote: x }); } });
    if (!["accepted", "cancelled"].includes(x.status)) acts.push({ id: "q-cancel", label: "إلغاء العرض", danger: true, onClick: async (c) => { c(); await run(() => api.admin("quote_status", { quote_id: x.id, status: "cancel" }), "أُلغي العرض"); } });
    if (["draft", "cancelled"].includes(x.status)) acts.push({ id: "q-delete", label: "حذف نهائي", danger: true, onClick: async (c) => { c(); await run(() => api.admin("quote_status", { quote_id: x.id, status: "delete" }), "حُذف العرض"); } });
    openSheet({ title: `${x.number} · ${x.customer_name}`, body: [h("div.sheet-doc", Paper("quote", x, seller()))], actions: [...acts, { label: "إغلاق", ghost: true }] });
  }

  function shareSheet(x) {
    const url = shareUrl(x);
    const msg = `السلام عليكم ${x.contact_name ?? ""}\nهذا عرض السعر الخاص بـ«${x.customer_name}» من جاي:\n${url}\nالعرض صالح حتى ${docDate(x.valid_until)}.`;
    openSheet({ title: "رابط العرض جاهز", body: [
      h("p.muted.small", "العميل يفتح الرابط، يشوف العرض بتصميم واضح، ويضغط «أقبل العرض» ثم يسجّل محله مباشرة."),
      h("div.copy-row", h("code", { "data-testid": "quote-link" }, url), h("button.btn.btn-sm", { type: "button", onclick: async () => { try { await navigator.clipboard.writeText(url); toast("نُسخ الرابط"); } catch { toast("انسخه يدوياً", { error: true }); } } }, icon("copy"), "نسخ")),
      h("a.btn.btn-block.btn-wa", { href: `https://wa.me/${(x.phone ?? "").replace(/\D/g, "").replace(/^05/, "9665")}?text=${encodeURIComponent(msg)}`, target: "_blank", rel: "noopener" }, icon("brand-whatsapp"), "أرسله على واتساب"),
      h("a.btn.btn-block", { href: url, target: "_blank", rel: "noopener" }, icon("external-link"), "افتح صفحة العرض")],
      actions: [{ label: "تم", primary: true }] });
  }

  function quoteEditor(src = null) {
    const s = d.settings, plans = d.products.filter((p) => p.kind === "plan" && p.is_active), addons = d.products.filter((p) => p.kind === "addon" && p.is_active);
    const st = {
      customer_name: src?.customer_name ?? "", contact_name: src?.contact_name ?? "", phone: src?.phone ?? "", email: src?.email ?? "", category: src?.category ?? "barber",
      plan: src?.plan ?? (plans.find((p) => p.is_featured) ?? plans[0])?.code ?? null, cycle: src?.cycle ?? "month", months: src?.months ?? 1,
      addons: new Set((src?.items ?? []).map((x) => x.code).filter((c) => c && product(c)?.kind === "addon")),
      items: (src?.items ?? []).map((x) => ({ ...x })), discount_pct: Number(src?.discount_pct ?? 0), valid_days: s.quote_valid_days, notes: src?.notes ?? "",
    };
    const regen = () => {
      const custom = st.items.filter((x) => !x.code);
      const auto = [];
      const p = product(st.plan);
      if (p) {
        if (st.cycle === "year") auto.push({ code: p.code, title: `باقة ${p.name} · اشتراك سنوي`, note: s.annual_free_months ? `12 شهراً، منها ${s.annual_free_months} مجاناً` : "12 شهراً", qty: 1, unit_price: Number(p.price) * (12 - s.annual_free_months) });
        else auto.push({ code: p.code, title: `باقة ${p.name} · اشتراك شهري`, qty: st.months, unit_price: Number(p.price) });
      }
      for (const c of st.addons) { const a = product(c); if (a) auto.push({ code: a.code, title: a.name, note: a.tagline ?? "", qty: 1, unit_price: Number(a.price) }); }
      st.items = [...auto, ...custom];
    };
    if (!src) regen();
    const draft = () => ({ ...compute(st.items, st.discount_pct, vat()), customer_name: st.customer_name || "اسم العميل", contact_name: st.contact_name, phone: st.phone, email: st.email,
      number: src?.number, created_at: src?.created_at ?? new Date().toISOString(), valid_until: new Date(Date.now() + st.valid_days * 864e5).toISOString(), notes: st.notes,
      plan_info: product(st.plan) ? { name: product(st.plan).name, tagline: product(st.plan).tagline, highlights: product(st.plan).highlights } : null, state: src?.state ?? "draft" });

    const totals = h("div.st-totals");
    const lines = h("div.lines");
    let ed;
    const refresh = () => { const c = compute(st.items, st.discount_pct, vat());
      fill(totals, h("div", h("span", "المجموع"), h("b", sar(c.subtotal))), c.discount ? h("div", h("span", `الخصم ${c.discount_pct}٪`), h("b", `− ${sar(c.discount)}`)) : null,
        c.vat ? h("div", h("span", `الضريبة ${c.vat_rate}٪`), h("b", sar(c.vat))) : null, h("div.grand", h("span", "الإجمالي"), h("b", { "data-testid": "quote-total" }, sar(c.total))));
      ed?.paint(); };
    const paintLines = () => { fill(lines, ...st.items.map((x, i) => h("div.line", { "data-line": i },
      h("input", { value: x.title, "aria-label": "البيان", placeholder: "البيان", oninput: (e) => { x.title = e.target.value; refresh(); } }),
      h("input.n", { type: "number", min: "0", step: "1", value: String(x.qty), "aria-label": "الكمية", oninput: (e) => { x.qty = +e.target.value; refresh(); } }),
      h("input.n", { type: "number", min: "0", step: "0.01", value: String(x.unit_price), "aria-label": "سعر الوحدة", oninput: (e) => { x.unit_price = +e.target.value; refresh(); } }),
      h("button.icon-btn", { type: "button", "aria-label": "حذف السطر", onclick: () => { if (x.code) { if (product(x.code)?.kind === "addon") st.addons.delete(x.code); if (x.code === st.plan) st.plan = null; } st.items.splice(i, 1); paintAll(); } }, icon("trash")))),
      h("button.btn.btn-ghost.btn-sm.add-line", { type: "button", onclick: () => { st.items.push({ title: "", qty: 1, unit_price: 0 }); paintLines(); lines.querySelector(".line:last-of-type input")?.focus(); } }, icon("plus"), "سطر مخصص")); refresh(); };

    const planCards = h("div.pick-cards");
    const addonCards = h("div.pick-cards.small");
    const cycleSeg = h("div.seg.cycle");
    const monthsRow = h("div.months-row");
    const paintAll = () => {
      fill(planCards, ...plans.map((p) => h(`button.pick${st.plan === p.code ? ".on" : ""}${p.is_featured ? ".featured" : ""}`, { type: "button", "data-plan": p.code, onclick: () => { st.plan = st.plan === p.code ? null : p.code; regen(); paintAll(); } },
        p.is_featured ? h("span.pick-flag", "الأكثر طلباً") : null, h("b", p.name), h("span.pick-price", money(p.price).replace(/\.00$/, ""), h("small", " ر.س / شهر")), h("small", p.tagline ?? ""))));
      fill(addonCards, ...addons.map((a) => h(`button.pick${st.addons.has(a.code) ? ".on" : ""}`, { type: "button", "data-addon": a.code, onclick: () => { st.addons.has(a.code) ? st.addons.delete(a.code) : st.addons.add(a.code); regen(); paintAll(); } },
        h("b", a.name), h("span.pick-price", money(a.price).replace(/\.00$/, ""), h("small", a.unit === "once" ? " ر.س مرة واحدة" : " ر.س / شهر")))));
      fill(cycleSeg, ...[["month", "شهري"], ["year", `سنوي · وفّر ${d.settings.annual_free_months} أشهر`]].map(([k, l]) =>
        h("button", { type: "button", "aria-pressed": String(st.cycle === k), "data-cycle": k, onclick: () => { st.cycle = k; regen(); paintAll(); } }, l)));
      fill(monthsRow, st.cycle === "month" ? [h("span", "عدد الأشهر"), h("div.stepper",
        h("button", { type: "button", "aria-label": "أقل", onclick: () => { st.months = Math.max(1, st.months - 1); regen(); paintAll(); } }, "−"),
        h("b", { "data-testid": "months" }, String(st.months)),
        h("button", { type: "button", "aria-label": "أكثر", onclick: () => { st.months = Math.min(24, st.months + 1); regen(); paintAll(); } }, "+"))] : null);
      paintLines();
    };
    const t = (k, label, attrs = {}) => field(label, inp(`q-${k}`, { value: st[k] ?? "", oninput: (e) => { st[k] = e.target.value; refresh(); }, ...attrs }));
    const form = h("div.st-sections",
      h("section", h("h3", h("span.step", "١"), "العميل"),
        h("div.grid2", t("customer_name", "اسم المحل *", { placeholder: "مثال: حلاق النخبة", "data-testid": "q-customer" }), t("contact_name", "اسم المسؤول")),
        h("div.grid2", t("phone", "الجوال", { type: "tel", dir: "ltr", placeholder: "05xxxxxxxx" }), t("email", "البريد", { type: "email", dir: "ltr" })),
        field("النشاط", h("select", { id: "q-category", onchange: (e) => { st.category = e.target.value; } }, Object.entries(CATS).map(([k, v]) => h("option", { value: k, selected: k === st.category }, v))))),
      h("section", h("h3", h("span.step", "٢"), "الباقة والمدة"), planCards, cycleSeg, monthsRow),
      h("section", h("h3", h("span.step", "٣"), "إضافات"), addonCards),
      h("section", h("h3", h("span.step", "٤"), "البنود والسعر"), h("div.line.head", h("span", "البيان"), h("span", "الكمية"), h("span", "السعر"), h("span")), lines,
        h("div.grid2",
          field("خصم ٪", inp("q-discount", { type: "number", min: "0", max: "100", value: String(st.discount_pct), oninput: (e) => { st.discount_pct = +e.target.value; refresh(); } })),
          field("صلاحية العرض (يوم)", inp("q-valid", { type: "number", min: "1", max: "90", value: String(st.valid_days), oninput: (e) => { st.valid_days = Math.max(1, +e.target.value || 1); refresh(); } }))),
        totals),
      h("section", h("h3", h("span.step", "٥"), "ملاحظات للعميل"), h("textarea", { id: "q-notes", rows: 3, maxlength: 600, placeholder: "مثال: السعر يشمل زيارة التركيب في الرياض", oninput: (e) => { st.notes = e.target.value; refresh(); } }, st.notes)));
    paintAll();

    const save = async (send) => {
      if (st.customer_name.trim().length < 2) { toast("اكتب اسم المحل", { error: true }); document.getElementById("q-customer")?.focus(); throw new Error("x"); }
      if (!compute(st.items, 0).items.length) { toast("أضف بنداً واحداً على الأقل", { error: true }); throw new Error("x"); }
      const body = { id: src?.id, customer_name: st.customer_name, contact_name: st.contact_name, phone: st.phone, email: st.email, category: st.category,
        plan: st.plan, cycle: st.cycle, months: st.cycle === "year" ? 12 : st.months, items: compute(st.items, 0).items.map(({ title, note, code, qty, unit_price }) => ({ title, note, code, qty, unit_price })),
        discount_pct: st.discount_pct, valid_days: st.valid_days, notes: st.notes };
      let r = await run(() => api.admin("quote_save", { quote: body }));
      if (send) r = await run(() => api.admin("quote_status", { quote_id: r.quote.id, status: "send" }));
      return r.quote;
    };
    ed = studio({ title: src ? `تعديل ${src.number}` : "عرض سعر جديد", testid: "quote-studio", form, preview: () => h("div.paper-fit", Paper("quote", draft(), seller(), { preview: true })),
      actions: [{ id: "q-save", label: "حفظ كمسودة", onClick: async ({ close }) => { await save(false); close(); toast("حُفظ العرض"); } },
        { id: "q-save-send", label: "حفظ وتجهيز الرابط", primary: true, icon: "send", onClick: async ({ close }) => { const q = await save(true); close(); shareSheet(q); } }] });
  }

  // ===================== invoices =====================
  function invoicesSection() {
    let filter = "all";
    const list = h("div.doc-list");
    const paint = () => { const r = d.invoices.filter((x) => filter === "all" || x.status === filter);
      fill(list, ...(r.length ? r.map((x) => h("button.doc-row", { type: "button", "data-invoice": x.number, onclick: () => invoiceMenu(x) },
        h("span.dr-main", h("b", x.buyer?.name ?? x.business_name ?? "—"), h("small", `${x.number} · ${docDate(x.issued_at)}`)), h("span.dr-amt", sar(x.total)), statusPill(x.status), icon("chevron-left")))
        : [h("div.empty-doc", icon("receipt"), h("b", "ما فيه فواتير بعد"), h("span", "أصدر فاتورة لعميل، أو من عرض سعر مقبول. ولما تسجّل الدفع مع المدة يتفعّل اشتراكه تلقائياً."))])); };
    paint();
    return [h("div.sales-bar",
      h("button.btn.btn-primary", { type: "button", "data-testid": "new-invoice", onclick: () => invoiceEditor({}) }, icon("plus"), "فاتورة جديدة"),
      h("div.chips", [["all", "الكل"], ["unpaid", "غير مدفوعة"], ["paid", "مدفوعة"], ["void", "ملغاة"]].map(([k, l]) =>
        h("button.chip", { type: "button", "aria-pressed": String(filter === k), onclick: (e) => { filter = k; e.currentTarget.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget))); paint(); } }, l)))), list];
  }

  function invoiceMenu(x) {
    const acts = [{ id: "i-open", label: "افتح للطباعة أو PDF", primary: true, onClick: (c) => { c(); window.open(`./doc/invoice/${x.id}`, "_blank", "noopener"); } }];
    if (x.status === "unpaid") acts.push({ id: "i-pay", label: "سجّل الدفع", onClick: (c) => { c(); paySheet(x); } });
    if (x.status !== "void") acts.push({ id: "i-void", label: "إلغاء الفاتورة", danger: true, onClick: (c) => { c(); voidSheet(x); } });
    openSheet({ title: `${x.number} · ${x.buyer?.name ?? ""}`, body: [h("div.sheet-doc", Paper("invoice", x, x.seller))], actions: [...acts, { label: "إغلاق", ghost: true }] });
  }
  function paySheet(x) {
    const m = h("select", { id: "pay-method" }, Object.entries(METHODS).map(([k, v]) => h("option", { value: k }, v)));
    const ref = inp("pay-ref", { placeholder: "رقم الحوالة أو المرجع (اختياري)", dir: "ltr" });
    const dt = inp("pay-date", { type: "date", value: today() });
    openSheet({ title: `تسجيل دفع ${x.number}`, body: [h("p.big-amt", sar(x.total)), field("طريقة الدفع", m), field("المرجع", ref), field("تاريخ الدفع", dt)],
      actions: [{ id: "pay-save", label: "تأكيد الدفع", primary: true, onClick: async (c) => { await run(() => api.admin("invoice_update", { invoice_id: x.id, changes: { action: "pay", pay_method: m.value, pay_reference: ref.value, paid_at: dt.value } }), "سُجّل الدفع"); c(); } },
        { label: "إلغاء", ghost: true }] });
  }
  function voidSheet(x) {
    const reason = h("textarea", { id: "void-reason", rows: 2, maxlength: 200, placeholder: "مثال: خطأ في المبلغ، وصدرت فاتورة بديلة" });
    openSheet({ title: `إلغاء ${x.number}`, body: [h("p.muted.small", "الفاتورة ما تنحذف ولا تتعدّل. تبقى برقمها ومكتوب عليها «ملغاة» مع السبب، وتقدر تصدر فاتورة جديدة بدلها."), field("سبب الإلغاء", reason)],
      actions: [{ id: "void-save", label: "ألغِ الفاتورة", danger: true, onClick: async (c) => { if (reason.value.trim().length < 3) { toast("اكتب السبب", { error: true }); return; } await run(() => api.admin("invoice_update", { invoice_id: x.id, changes: { action: "void", reason: reason.value } }), "أُلغيت الفاتورة"); c(); } },
        { label: "تراجع", ghost: true }] });
  }

  function invoiceEditor({ quote = null }) {
    const s = d.settings;
    const st = { business_id: quote?.business_id ?? d.businesses[0]?.id ?? "", items: quote ? quote.items.map((x) => ({ ...x })) : [], discount_pct: Number(quote?.discount_pct ?? 0),
      activate: true, months: quote ? (quote.cycle === "year" ? 12 : quote.months) : 1, period_start: today(), paid: true, pay_method: "bank", pay_reference: "", notes: "", buyer_vat: "", plan: quote?.plan ?? null };
    const fromPlan = () => { const b = d.businesses.find((x) => x.id === st.business_id); const p = product(b?.plan);
      st.plan = b?.plan ?? null; st.items = p ? [{ code: p.code, title: `باقة ${p.name} · اشتراك شهري`, qty: st.months, unit_price: Number(p.price) }] : [{ title: "", qty: 1, unit_price: 0 }]; };
    if (!quote) fromPlan();
    const buyer = () => { const b = d.businesses.find((x) => x.id === st.business_id); return { name: quote?.customer_name ?? b?.name ?? "العميل", contact: quote?.contact_name, phone: quote?.phone, email: quote?.email, vat_number: st.buyer_vat }; };
    const end = () => { const e = new Date(st.period_start); e.setMonth(e.getMonth() + Number(st.months)); e.setDate(e.getDate() - 1); return e.toISOString().slice(0, 10); };
    const draft = () => ({ ...compute(st.items, st.discount_pct, vat()), buyer: buyer(), issued_at: new Date().toISOString(), status: st.paid ? "paid" : "unpaid", paid_at: new Date().toISOString(),
      pay_method: st.pay_method, pay_reference: st.pay_reference, due_date: new Date(Date.now() + 3 * 864e5).toISOString(), period_start: st.activate ? st.period_start : null, period_end: st.activate ? end() : null,
      is_tax_invoice: s.vat_registered, notes: st.notes });
    const lines = h("div.lines"); let ed;
    const paintLines = () => { fill(lines, ...st.items.map((x, i) => h("div.line",
      h("input", { value: x.title, "aria-label": "البيان", oninput: (e) => { x.title = e.target.value; ed?.paint(); } }),
      h("input.n", { type: "number", min: "0", value: String(x.qty), "aria-label": "الكمية", oninput: (e) => { x.qty = +e.target.value; ed?.paint(); } }),
      h("input.n", { type: "number", min: "0", step: "0.01", value: String(x.unit_price), "aria-label": "السعر", oninput: (e) => { x.unit_price = +e.target.value; ed?.paint(); } }),
      h("button.icon-btn", { type: "button", "aria-label": "حذف", onclick: () => { st.items.splice(i, 1); paintLines(); ed?.paint(); } }, icon("trash")))),
      h("button.btn.btn-ghost.btn-sm.add-line", { type: "button", onclick: () => { st.items.push({ title: "", qty: 1, unit_price: 0 }); paintLines(); } }, icon("plus"), "سطر")); };
    paintLines();
    const payBox = h("div.grid2",
      field("طريقة الدفع", h("select", { id: "inv-method", onchange: (e) => { st.pay_method = e.target.value; ed?.paint(); } }, Object.entries(METHODS).map(([k, v]) => h("option", { value: k }, v)))),
      field("المرجع", inp("inv-ref", { dir: "ltr", oninput: (e) => { st.pay_reference = e.target.value; ed?.paint(); } })));
    const form = h("div.st-sections",
      h("section", h("h3", h("span.step", "١"), "العميل"),
        quote ? h("p.muted", `من العرض ${quote.number} · ${quote.customer_name}`) : field("المحل", h("select", { id: "inv-business", onchange: (e) => { st.business_id = e.target.value; fromPlan(); paintLines(); ed?.paint(); } },
          d.businesses.length ? d.businesses.map((b) => h("option", { value: b.id, selected: b.id === st.business_id }, b.name)) : h("option", { value: "" }, "ما فيه محلات بعد"))),
        field("الرقم الضريبي للعميل (إن وجد)", inp("inv-buyer-vat", { dir: "ltr", oninput: (e) => { st.buyer_vat = e.target.value; ed?.paint(); } }))),
      h("section", h("h3", h("span.step", "٢"), "البنود"), h("div.line.head", h("span", "البيان"), h("span", "الكمية"), h("span", "السعر"), h("span")), lines,
        field("خصم ٪", inp("inv-discount", { type: "number", min: "0", max: "100", value: String(st.discount_pct), oninput: (e) => { st.discount_pct = +e.target.value; ed?.paint(); } }))),
      h("section", h("h3", h("span.step", "٣"), "المدة والتفعيل"),
        h("label.check", h("input", { type: "checkbox", id: "inv-activate", checked: st.activate, onchange: (e) => { st.activate = e.target.checked; ed?.paint(); } }), h("span", "فعّل اشتراك المحل لهذه المدة عند الدفع")),
        h("div.grid2", field("من تاريخ", inp("inv-start", { type: "date", value: st.period_start, oninput: (e) => { st.period_start = e.target.value; ed?.paint(); } })),
          field("عدد الأشهر", inp("inv-months", { type: "number", min: "1", max: "36", value: String(st.months), oninput: (e) => { st.months = Math.max(1, +e.target.value || 1); ed?.paint(); } })))),
      h("section", h("h3", h("span.step", "٤"), "الدفع"),
        h("label.check", h("input", { type: "checkbox", id: "inv-paid", checked: st.paid, onchange: (e) => { st.paid = e.target.checked; payBox.hidden = !st.paid; ed?.paint(); } }), h("span", "استلمت المبلغ")), payBox,
        field("ملاحظات على الفاتورة", h("textarea", { id: "inv-notes", rows: 2, maxlength: 600, oninput: (e) => { st.notes = e.target.value; ed?.paint(); } }))));
    ed = studio({ title: "فاتورة جديدة", testid: "invoice-studio", form, preview: () => h("div.paper-fit", Paper("invoice", draft(), seller(), { preview: true })),
      actions: [{ id: "inv-issue", label: "أصدر الفاتورة", primary: true, icon: "receipt", onClick: async ({ close }) => {
        if (!quote && !st.business_id) { toast("اختر المحل", { error: true }); return; }
        if (!compute(st.items, 0).items.length) { toast("أضف بنداً", { error: true }); return; }
        const r = await run(() => api.admin("invoice_create", { invoice: { quote_id: quote?.id, business_id: quote ? undefined : st.business_id, plan: st.plan,
          items: compute(st.items, 0).items.map(({ title, note, code, qty, unit_price }) => ({ title, note, code, qty, unit_price })), discount_pct: st.discount_pct,
          paid: st.paid, pay_method: st.pay_method, pay_reference: st.pay_reference, period_start: st.period_start, activate_months: st.activate ? st.months : null,
          notes: st.notes, buyer_vat_number: st.buyer_vat } }), "صدرت الفاتورة");
        close(); section = "invoices"; store.set("dawri.sales.section", "invoices"); draw(); reload?.();
        if (r?.invoice) window.open(`./doc/invoice/${r.invoice.id}`, "_blank", "noopener");
      } }] });
  }

  // ===================== products =====================
  function productsSection() {
    const card = (p) => h(`article.prod${p.is_featured ? ".featured" : ""}${p.is_active ? "" : ".off"}`, { "data-product": p.code },
      p.is_featured ? h("span.pick-flag", "الأكثر طلباً") : null, !p.is_active ? h("span.pill.muted", "موقوف") : null,
      h("h4", p.name), h("p.muted.small", p.tagline ?? ""),
      h("div.prod-price", h("b", money(p.price).replace(/\.00$/, "")), h("span", p.unit === "month" ? " ر.س / شهر" : " ر.س مرة واحدة")),
      (p.highlights ?? []).length ? h("ul", p.highlights.map((x) => h("li", x))) : null,
      h("button.btn.btn-sm.btn-block", { type: "button", onclick: () => productSheet(p) }, icon("edit"), "تعديل"));
    return [
      h("div.sales-bar", h("button.btn.btn-primary", { type: "button", "data-testid": "new-product", onclick: () => productSheet(null) }, icon("plus"), "منتج جديد"),
        h("p.muted.small", "الأسعار هنا هي اللي تظهر في عروض الأسعار والاتفاقية، وتُحسب منها أرقام الدخل في لوحتك.")),
      h("h3.sales-h", "الباقات الشهرية"), h("div.prod-grid", d.products.filter((p) => p.kind === "plan").map(card)),
      h("h3.sales-h", "الإضافات"), h("div.prod-grid", d.products.filter((p) => p.kind === "addon").map(card))];
  }
  function productSheet(p) {
    const isNew = !p;
    const code = inp("p-code", { value: p?.code ?? "", dir: "ltr", readOnly: !isNew, placeholder: "مثال: printing" });
    const kind = h("select", { id: "p-kind", disabled: !isNew }, [["plan", "باقة شهرية"], ["addon", "إضافة"]].map(([k, v]) => h("option", { value: k, selected: (p?.kind ?? "addon") === k }, v)));
    const name = inp("p-name", { value: p?.name ?? "" }), tagline = inp("p-tagline", { value: p?.tagline ?? "" });
    const price = inp("p-price", { type: "number", min: "0", step: "0.01", value: String(p?.price ?? "") });
    const unit = h("select", { id: "p-unit" }, [["month", "شهرياً"], ["once", "مرة واحدة"]].map(([k, v]) => h("option", { value: k, selected: (p?.unit ?? "once") === k }, v)));
    const hl = h("textarea", { id: "p-highlights", rows: 5, placeholder: "ميزة في كل سطر" }, (p?.highlights ?? []).join("\n"));
    const featured = h("input", { type: "checkbox", id: "p-featured", checked: !!p?.is_featured }), active = h("input", { type: "checkbox", id: "p-active", checked: p?.is_active ?? true });
    const sort = inp("p-sort", { type: "number", value: String(p?.sort ?? 50) });
    openSheet({ title: isNew ? "منتج جديد" : `تعديل «${p.name}»`, body: [
      h("div.grid2", field("الرمز (بالإنجليزي)", code), field("النوع", kind)), field("الاسم", name), field("الوصف المختصر", tagline),
      h("div.grid2", field("السعر (ر.س)", price), field("طريقة الدفع", unit)), field("المزايا", hl, "تظهر في عرض السعر تحت الباقة"),
      h("div.grid2", h("label.check", featured, h("span", "الأكثر طلباً")), h("label.check", active, h("span", "متاح للبيع"))), field("الترتيب", sort)],
      actions: [{ id: "p-save", label: "احفظ", primary: true, onClick: async (c) => {
        await run(() => api.admin("product_save", { product: { code: code.value, kind: kind.value, name: name.value, tagline: tagline.value, price: +price.value, unit: unit.value,
          highlights: hl.value.split("\n").map((x) => x.trim()).filter(Boolean), is_featured: featured.checked, is_active: active.checked, sort: +sort.value } }), "حُفظ المنتج");
        c(); } }, { label: "إلغاء", ghost: true }] });
  }

  // ===================== agreement =====================
  function contractSection() {
    const st = { title: d.template.title, body: d.template.body };
    const sample = () => {
      const p = d.products.find((x) => x.is_featured) ?? d.products[0], s = d.settings;
      const vals = { "{{business_name}}": "حلاق النخبة", "{{owner_email}}": "owner@example.com", "{{plan_name}}": p?.name ?? "", "{{plan_price}}": money(p?.price ?? 0),
        "{{seller_name}}": s.seller_legal_name || s.seller_name, "{{seller_id_label}}": s.seller_id_label, "{{seller_id}}": s.seller_id || "—", "{{trial_days}}": String(s.trial_days),
        "{{annual_free_months}}": String(s.annual_free_months), "{{payment_terms}}": s.payment_terms, "{{date}}": today(),
        "{{vat_note}}": s.vat_registered ? " غير شامل ضريبة القيمة المضافة" : " (غير خاضع لضريبة القيمة المضافة)" };
      return Object.entries(vals).reduce((b, [k, v]) => b.replaceAll(k, v), st.body);
    };
    const body = h("textarea.contract-src", { id: "c-body", rows: 22, spellcheck: false, oninput: (e) => { st.body = e.target.value; ed.paint(); } }, st.body);
    let ed;
    const open = () => {
      const form = h("div.st-sections",
        h("section", h("h3", "عنوان الاتفاقية"), inp("c-title", { value: st.title, oninput: (e) => { st.title = e.target.value; ed.paint(); } })),
        h("section", h("h3", "النص"), h("p.muted.small", "«## » عنوان قسم، و«- » بند، و**نص** للخط العريض. اضغط أي حقل لإضافته مكان المؤشر:"),
          h("div.ph-chips", PLACEHOLDERS.map(([k, l]) => h("button.chip", { type: "button", title: k, onclick: () => { const a = body.selectionStart ?? body.value.length; body.setRangeText(k, a, body.selectionEnd ?? a, "end"); st.body = body.value; body.focus(); ed.paint(); } }, l))), body));
      ed = studio({ title: `الاتفاقية · الإصدار ${d.template.version}`, testid: "contract-studio", form,
        preview: () => h("div.paper-fit", ContractPaper({ title: st.title, body: sample(), version: d.template.version + (st.body !== d.template.body || st.title !== d.template.title ? 1 : 0) }, seller())),
        actions: [{ id: "c-save", label: "احفظ كإصدار جديد", primary: true, icon: "device-floppy", onClick: async ({ close }) => {
          if (st.body === d.template.body && st.title === d.template.title) { toast("ما فيه تغيير"); return; }
          await run(() => api.admin("contract_template_save", { title: st.title, body: st.body }), "حُفظ الإصدار الجديد، وبيُطلب من المشتركين الموافقة عليه"); close(); } }] });
    };
    return [
      h("div.contract-card",
        h("div", h("span.pill.info", `الإصدار ${d.template.version}`), h("h3", d.template.title), h("p.muted.small", `آخر تعديل ${docDate(d.template.created_at)}. تظهر للمالك بعد التسجيل، ويوافق عليها باسمه قبل ما يبدأ.`)),
        h("button.btn.btn-primary", { type: "button", "data-testid": "edit-contract", onclick: open }, icon("edit"), "تعديل النص")),
      h("p.muted.small", "أي تعديل يصير إصداراً جديداً، والموافقات القديمة تبقى محفوظة بنصها كما وقّع عليه صاحبها. هذه مسودة واضحة، ويُفضّل يراجعها محامٍ مرة وحدة."),
      h("h3.sales-h", `الموافقات (${d.contracts.length})`),
      h("div.doc-list", d.contracts.length ? d.contracts.map((c) => h("a.doc-row", { href: `./doc/contract/${c.id}`, target: "_blank", rel: "noopener" },
        h("span.dr-main", h("b", c.business_name), h("small", `${c.accepted_name} · ${docDate(c.accepted_at)}`)), h("span.pill.ok", `إصدار ${c.version}`), icon("chevron-left")))
        : [h("div.empty-doc", icon("file-certificate"), h("b", "ما فيه موافقات بعد"), h("span", "أول ما يسجّل محل ويوافق، تظهر موافقته هنا."))])];
  }

  // ===================== settings =====================
  function settingsSection() {
    const s = { ...d.settings };
    const f = (k, label, attrs = {}, hint) => field(label, inp(`s-${k}`, { value: s[k] ?? "", oninput: (e) => { s[k] = e.target.value; }, ...attrs }), hint);
    const vatBox = h("div.grid2", f("vat_number", "الرقم الضريبي", { dir: "ltr", placeholder: "3xxxxxxxxxxxxx3" }), f("vat_rate", "نسبة الضريبة ٪", { type: "number", min: "0", max: "50" }));
    vatBox.hidden = !s.vat_registered;
    const ta = (k, label) => field(label, h("textarea", { id: `s-${k}`, rows: 3, oninput: (e) => { s[k] = e.target.value; } }, s[k] ?? ""));
    return [h("form.settings-grid", { onsubmit: async (e) => { e.preventDefault();
        try { d = await api.admin("billing_settings_save", { settings: { ...s, vat_rate: +s.vat_rate, quote_valid_days: +s.quote_valid_days, trial_days: +s.trial_days, annual_free_months: +s.annual_free_months } }); toast("حُفظت البيانات"); draw(); }
        catch (x) { toast(x.extra?.field === "iban" ? "الآيبان لازم يبدأ بـ SA وبعده ٢٢ رقم" : x.extra?.field === "vat_number" ? "الرقم الضريبي ١٥ رقم يبدأ وينتهي بـ ٣" : errorText(x), { error: true }); } } },
      h("section.set-card", h("h3", icon("building"), "هوية المنشأة"), f("seller_name", "الاسم التجاري"), f("seller_legal_name", "الاسم الرسمي", {}, "كما في الوثيقة، يظهر على الفواتير والاتفاقية"),
        h("div.grid2", f("seller_id_label", "نوع الوثيقة"), f("seller_id", "رقم الوثيقة", { dir: "ltr" })), h("div.grid2", f("city", "المدينة"), f("address", "العنوان"))),
      h("section.set-card", h("h3", icon("phone"), "التواصل"), h("div.grid2", f("phone", "الجوال", { dir: "ltr", type: "tel" }), f("email", "البريد", { dir: "ltr", type: "email" }))),
      h("section.set-card", h("h3", icon("building-bank"), "الحساب البنكي"), h("div.grid2", f("bank_name", "البنك"), f("account_holder", "اسم صاحب الحساب")), f("iban", "الآيبان", { dir: "ltr", placeholder: "SA00 0000 0000 0000 0000 0000" }, "يظهر في عروض الأسعار والفواتير لتحويل المبلغ")),
      h("section.set-card", h("h3", icon("receipt-tax"), "الضريبة"),
        h("label.check", h("input", { type: "checkbox", id: "s-vat_registered", checked: s.vat_registered, onchange: (e) => { s.vat_registered = e.target.checked; vatBox.hidden = !e.target.checked; } }), h("span", "مسجّل في ضريبة القيمة المضافة")),
        vatBox, h("p.muted.small", "وأنت غير مسجّل: الفواتير بدون ضريبة ومكتوب عليها ذلك. لما تسجّل: تصير «فاتورة ضريبية مبسطة» مع رمز QR تلقائياً. تأكد من محاسب قبل التفعيل.")),
      h("section.set-card", h("h3", icon("adjustments"), "الأرقام والمدد"),
        h("div.grid2", f("quote_prefix", "بادئة رقم العرض", { dir: "ltr" }), f("invoice_prefix", "بادئة رقم الفاتورة", { dir: "ltr" })),
        h("div.grid3", f("quote_valid_days", "صلاحية العرض (يوم)", { type: "number", min: "1", max: "90" }), f("trial_days", "التجربة المجانية (يوم)", { type: "number", min: "0", max: "90" }),
          f("annual_free_months", "أشهر مجانية في السنوي", { type: "number", min: "0", max: "6" }))),
      h("section.set-card.wide", h("h3", icon("notes"), "النصوص"), ta("payment_terms", "شروط الدفع (في العرض والاتفاقية)"), ta("invoice_note", "عبارة أسفل الفاتورة")),
      h("div.set-save", h("button.btn.btn-primary", { type: "submit", "data-testid": "save-billing-settings" }, icon("device-floppy"), "احفظ البيانات")))];
  }

  load().catch((x) => fill(root, h("p.err", errorText(x))));
  return root;
}
