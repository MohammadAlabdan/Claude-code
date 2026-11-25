// Demo mode copy of the sales-documents SQL (20261125000100_billing.sql), on the in-browser demo database.
import { compute } from "./doc.js";

const TEMPLATE = `تُبرم هذه الاتفاقية بتاريخ {{date}} بين:
- **مقدّم الخدمة:** {{seller_name}} ({{seller_id_label}}: {{seller_id}}).
- **المشترك:** {{business_name}}، ويمثّله صاحب الحساب {{owner_email}}.

## ١. الخدمة
يقدّم «جاي» نظام طوابير رقمياً يشمل صفحة المحل، وتذاكر الزبائن، وشاشة الموظفين، ولوحة المالك، والتنبيهات، بحسب مزايا الباقة المختارة.

## ٢. الباقة والسعر
- الباقة: **{{plan_name}}**.
- السعر: **{{plan_price}} ريال شهرياً**{{vat_note}}.
- تبدأ تجربة مجانية مدتها {{trial_days}} يوماً، ولا يُطلب أي دفع خلالها.

## ٣. الدفع والتجديد
- {{payment_terms}}
- يتجدد الاشتراك بنفس المدة ما لم يطلب المشترك الإيقاف قبل نهايتها.

## ٤. البيانات والخصوصية
- بيانات المحل وزبائنه ملك للمشترك، ويعالجها «جاي» لتشغيل الخدمة فقط.

## ٥. الإلغاء
يحق للمشترك الإلغاء في أي وقت، ويستمر الاشتراك حتى نهاية المدة المدفوعة.

## ٦. أحكام عامة
- تخضع هذه الاتفاقية لأنظمة المملكة العربية السعودية، وتُعدّ الموافقة الإلكترونية توقيعاً ملزماً.`;

export function seedBilling() {
  return {
    settings: { seller_name: "جاي", seller_legal_name: null, seller_id_label: "رقم وثيقة العمل الحر", seller_id: null, vat_registered: false, vat_number: null, vat_rate: 15,
      bank_name: null, account_holder: null, iban: null, phone: null, email: null, city: "الرياض", address: null, quote_valid_days: 7, quote_prefix: "Q", invoice_prefix: "JAY",
      annual_free_months: 2, trial_days: 14, payment_terms: "الدفع بالتحويل البنكي خلال ٣ أيام من قبول العرض، ويبدأ الاشتراك من تاريخ الدفع.",
      invoice_note: "شكراً لثقتك في «جاي». دورك جاي.. وأنت مرتاح." },
    products: [
      { code: "basic", kind: "plan", name: "الأساسية", tagline: "لمحل يبي ينهي فوضى الطابور", price: 199, unit: "month", highlights: ["صفحة المحل الحيّة و«نبّهني لما تهدأ»", "لوحة الكراسي واختيار الموظف", "«كم تبعد؟» و«وصلت» وتنبيه الواتساب", "شاشة الموظف بخمس لغات", "ملخص المساء وحاسبة الزبائن الضائعين"], is_featured: false, is_active: true, sort: 1 },
      { code: "growth", kind: "plan", name: "النمو", tagline: "لمحل يبي يكسب من وقت الانتظار", price: 399, unit: "month", highlights: ["كل ما في الأساسية", "«وأنت تنتظر» والمفاجأة المختومة", "تحدّيات الزيارات والمكافآت", "«أبيها» لإضافة خدمات", "العروض حسب الوقت ونقاط الولاء"], is_featured: true, is_active: true, sort: 2 },
      { code: "full", kind: "plan", name: "المتكاملة", tagline: "لمحل يبي مساعد ذكي يفكّر معه", price: 699, unit: "month", highlights: ["كل ما في النمو", "تحدّيات ذكية لأوقات الهدوء", "مساعد يجاوب أسئلة الزبائن", "تقرير الذروة والغايبون", "صفحة المحل الكاملة"], is_featured: false, is_active: true, sort: 3 },
      { code: "seasonal", kind: "plan", name: "المواسم", tagline: "لرمضان والأعياد وأيام الذروة فقط", price: 199, unit: "month", highlights: ["مزايا الأساسية للفترة اللي تحتاجها", "تشغيل وإيقاف حسب الموسم"], is_featured: false, is_active: true, sort: 4 },
      { code: "setup", kind: "addon", name: "التركيب والتدريب", tagline: "زيارة، وملصقات مطبوعة، وتدريب الموظفين", price: 399, unit: "once", highlights: [], is_featured: false, is_active: true, sort: 10 },
      { code: "stickers", kind: "addon", name: "ملصقات QR إضافية", tagline: "طقم ملصق باب وبطاقة مرآة وستيكر زجاج", price: 79, unit: "once", highlights: [], is_featured: false, is_active: true, sort: 11 }],
    templates: [{ version: 1, title: "اتفاقية اشتراك في منصة «جاي»", body: TEMPLATE, created_at: new Date().toISOString() }],
    quotes: [], invoices: [], contracts: [], counters: {},
  };
}

export function billingApi({ getDb, commit, fail, uid, iso, users, businesses, updateBusiness }) {
  const B = () => (getDb().billing ??= seedBilling());
  const vat = () => ({ registered: B().settings.vat_registered, rate: B().settings.vat_rate });
  const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const next = (kind, prefix) => { const y = new Date().getFullYear(), k = `${kind}-${y}`; B().counters[k] = (B().counters[k] ?? 0) + 1; return `${prefix}-${y}-${String(B().counters[k]).padStart(4, "0")}`; };
  const product = (c) => B().products.find((p) => p.code === c);
  const seller = () => { const s = B().settings; return { name: s.seller_name, legal_name: s.seller_legal_name, id_label: s.seller_id_label, id: s.seller_id, vat_registered: s.vat_registered,
    vat_number: s.vat_number, bank_name: s.bank_name, account_holder: s.account_holder, iban: s.iban, phone: s.phone, email: s.email, city: s.city, address: s.address,
    payment_terms: s.payment_terms, invoice_note: s.invoice_note }; };
  const calc = (items, pct) => {
    if (!Array.isArray(items) || !items.length || items.length > 30) fail("invalid_input", { field: "items" });
    for (const x of items) { const t = String(x.title ?? "").trim(); if (t.length < 2 || !(Number(x.qty) > 0) || Number(x.unit_price) < 0) fail("invalid_input", { field: "items" }); }
    return compute(items.map((x) => ({ title: String(x.title).trim(), note: x.note || null, code: x.code || null, qty: Number(x.qty), unit_price: Number(x.unit_price) })), pct, vat());
  };
  const view = (q) => { const p = product(q.plan);
    const state = ["accepted", "cancelled"].includes(q.status) ? q.status : q.valid_until < today() ? "expired" : q.status;
    return { ...q, state, plan_info: p ? { code: p.code, name: p.name, tagline: p.tagline, price: p.price, highlights: p.highlights } : null,
      business_name: businesses().find((b) => b.id === q.business_id)?.name ?? null }; };
  const ownerBiz = (user) => businesses().filter((b) => b.owner === user.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
  const render = (biz, version) => {
    const s = B().settings, t = version ? B().templates.find((x) => x.version === version) : B().templates.at(-1), p = product(biz.plan);
    const vals = { "{{date}}": today(), "{{seller_name}}": s.seller_legal_name || s.seller_name, "{{seller_id_label}}": s.seller_id_label, "{{seller_id}}": s.seller_id || "—",
      "{{business_name}}": biz.name, "{{owner_email}}": users().find((u) => u.id === biz.owner)?.email ?? "—", "{{plan_name}}": p?.name ?? biz.plan,
      "{{plan_price}}": Number(p?.price ?? 0).toFixed(2), "{{vat_note}}": s.vat_registered ? " غير شامل ضريبة القيمة المضافة" : " (غير خاضع لضريبة القيمة المضافة)",
      "{{annual_free_months}}": String(s.annual_free_months), "{{trial_days}}": String(s.trial_days), "{{payment_terms}}": s.payment_terms };
    return { version: t.version, title: t.title, body: Object.entries(vals).reduce((b, [k, v]) => b.replaceAll(k, v), t.body) };
  };
  const all = () => ({
    settings: { ...B().settings }, products: [...B().products].sort((a, b) => a.sort - b.sort), template: B().templates.at(-1),
    quotes: B().quotes.map(view).reverse(), invoices: [...B().invoices].reverse().map((i) => ({ ...i, business_name: businesses().find((b) => b.id === i.business_id)?.name ?? null })),
    contracts: [...B().contracts].reverse().map((c) => ({ id: c.id, business_id: c.business_id, business_name: businesses().find((b) => b.id === c.business_id)?.name, version: c.version, accepted_name: c.accepted_name, accepted_at: c.accepted_at })),
    businesses: businesses().filter((b) => !b.is_demo || true).map((b) => ({ id: b.id, name: b.name, plan: b.plan })),
  });
  const billing = (user) => {
    const b = ownerBiz(user); if (!b) fail("not_found");
    const c = B().contracts.filter((x) => x.business_id === b.id).sort((x, y) => y.version - x.version)[0], cur = B().templates.at(-1).version;
    return { business_id: b.id, contract_pending: !c || c.version < cur, contract: c ? { id: c.id, version: c.version, title: c.title, accepted_name: c.accepted_name, accepted_at: c.accepted_at } : null,
      draft: !c || c.version < cur ? render(b) : null,
      invoices: B().invoices.filter((i) => i.business_id === b.id).reverse().map(({ id, number, status, issued_at, total, period_start, period_end, due_date }) => ({ id, number, status, issued_at, total, period_start, period_end, due_date })),
      seller: seller() };
  };

  return {
    admin(action, body) {
      const s = B().settings;
      switch (action) {
        case "billing": return all();
        case "billing_settings_save": {
          const p = body.settings ?? {}, iban = String(p.iban ?? "").replace(/\s/g, "").toUpperCase();
          if (iban && !/^SA\d{22}$/.test(iban)) fail("invalid_input", { field: "iban" });
          if (p.vat_number && !/^3\d{13}3$/.test(p.vat_number)) fail("invalid_input", { field: "vat_number" });
          if (p.vat_registered && !p.vat_number) fail("invalid_input", { field: "vat_number" });
          const keep = (k) => (p[k] == null || p[k] === "" ? s[k] : p[k]), opt = (k) => (p[k] == null || String(p[k]).trim() === "" ? null : String(p[k]).trim());
          Object.assign(s, { seller_name: keep("seller_name"), seller_legal_name: opt("seller_legal_name"), seller_id_label: keep("seller_id_label"), seller_id: opt("seller_id"),
            vat_registered: !!p.vat_registered, vat_number: opt("vat_number"), vat_rate: Number(keep("vat_rate")), bank_name: opt("bank_name"), account_holder: opt("account_holder"),
            iban: iban || null, phone: opt("phone"), email: opt("email"), city: opt("city"), address: opt("address"), quote_valid_days: Number(keep("quote_valid_days")),
            quote_prefix: String(keep("quote_prefix")).toUpperCase(), invoice_prefix: String(keep("invoice_prefix")).toUpperCase(), annual_free_months: Number(keep("annual_free_months")),
            trial_days: Number(keep("trial_days")), payment_terms: keep("payment_terms"), invoice_note: keep("invoice_note") });
          commit(null); return all();
        }
        case "product_save": {
          const p = body.product ?? {}, code = String(p.code ?? "").trim().toLowerCase();
          if (!/^[a-z][a-z0-9_]{1,30}$/.test(code)) fail("invalid_input", { field: "code" });
          if (String(p.name ?? "").trim().length < 2 || !(Number(p.price) >= 0)) fail("invalid_input");
          let row = product(code);
          if (!row) { row = { code, kind: p.kind === "plan" ? "plan" : "addon" }; B().products.push(row); }
          Object.assign(row, { name: p.name.trim(), tagline: p.tagline || null, price: Number(p.price), unit: p.unit === "month" ? "month" : "once", highlights: p.highlights ?? [],
            is_featured: !!p.is_featured, is_active: p.is_active !== false, sort: Number(p.sort ?? 50) });
          if (row.is_featured) B().products.forEach((x) => { if (x !== row && x.kind === "plan") x.is_featured = false; });
          commit(null); return all();
        }
        case "quote_save": {
          const p = body.quote ?? {};
          if (String(p.customer_name ?? "").trim().length < 2) fail("invalid_input", { field: "customer_name" });
          const c = calc(p.items, p.discount_pct);
          const fields = { customer_name: p.customer_name.trim(), contact_name: p.contact_name || null, phone: p.phone || null, email: p.email || null, category: p.category || null,
            plan: p.plan || null, cycle: p.cycle === "year" ? "year" : "month", months: Number(p.months ?? 1), ...c, notes: p.notes || null,
            valid_until: new Date(Date.now() + 3 * 3600e3 + (Number(p.valid_days ?? s.quote_valid_days)) * 864e5).toISOString().slice(0, 10), updated_at: iso() };
          let q = p.id ? B().quotes.find((x) => x.id === p.id) : null;
          if (p.id && (!q || !["draft", "sent", "viewed"].includes(q.status))) fail("not_editable");
          if (q) Object.assign(q, fields);
          else { q = { id: uid(), number: next("quote", s.quote_prefix), token: uid().replace(/-/g, "").slice(0, 32) + "0000", status: "draft", created_at: iso(), viewed_at: null, accepted_at: null, accepted_name: null, business_id: null, ...fields }; B().quotes.push(q); }
          commit(null); return { quote: view(q) };
        }
        case "quote_status": {
          const i = B().quotes.findIndex((x) => x.id === body.quote_id), q = B().quotes[i]; if (!q) fail("not_editable");
          if (body.status === "delete") { if (!["draft", "cancelled"].includes(q.status)) fail("not_editable"); B().quotes.splice(i, 1); commit(null); return { ok: true }; }
          if (q.status === "accepted") fail("not_editable");
          if (body.status === "send" && q.status === "draft") q.status = "sent";
          else if (body.status === "cancel") q.status = "cancelled";
          else if (body.status === "reopen" && q.status === "cancelled") q.status = "draft";
          commit(null); return { quote: view(q) };
        }
        case "invoice_create": {
          const p = body.invoice ?? {}, q = B().quotes.find((x) => x.id === p.quote_id), biz = businesses().find((b) => b.id === (p.business_id || q?.business_id));
          if (!biz && !q) fail("invalid_input", { field: "business_id" });
          const c = calc(p.items ?? q.items, p.discount_pct ?? q?.discount_pct), owner = users().find((u) => u.id === biz?.owner);
          const months = p.activate_months ? Number(p.activate_months) : null, start = p.period_start || today();
          const end = months ? (() => { const e = new Date(start); e.setMonth(e.getMonth() + months); e.setDate(e.getDate() - 1); return e.toISOString().slice(0, 10); })() : null;
          const inv = { id: uid(), number: next("invoice", s.invoice_prefix), business_id: biz?.id ?? null, quote_id: q?.id ?? null, status: p.paid ? "paid" : "unpaid", issued_at: iso(),
            due_date: p.due_date || new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), period_start: months ? start : null, period_end: end, seller: seller(),
            buyer: { name: biz?.name ?? q.customer_name, contact: q?.contact_name ?? owner?.email ?? null, phone: q?.phone ?? null, email: q?.email ?? owner?.email ?? null, vat_number: p.buyer_vat_number || null },
            ...c, is_tax_invoice: s.vat_registered, paid_at: p.paid ? (p.paid_at || iso()) : null, pay_method: p.paid ? (p.pay_method || "bank") : null, pay_reference: p.pay_reference || null,
            void_reason: null, voided_at: null, notes: p.notes || null, created_at: iso() };
          B().invoices.push(inv);
          if (biz && months && p.paid) updateBusiness(biz.id, { status: "active", start, duration: months, unit: "month", plan: p.plan || q?.plan || biz.plan });
          commit("*"); return { invoice: inv };
        }
        case "invoice_update": {
          const inv = B().invoices.find((x) => x.id === body.invoice_id), ch = body.changes ?? {};
          if (!inv) fail("not_editable");
          if (ch.action === "pay") { if (inv.status !== "unpaid") fail("not_editable"); Object.assign(inv, { status: "paid", paid_at: ch.paid_at || iso(), pay_method: ch.pay_method || "bank", pay_reference: ch.pay_reference || null }); }
          else if (ch.action === "void") { if (inv.status === "void") fail("not_editable"); if (String(ch.reason ?? "").trim().length < 3) fail("invalid_input", { field: "reason" }); Object.assign(inv, { status: "void", void_reason: ch.reason.trim(), voided_at: iso() }); }
          else fail("invalid_action");
          commit(null); return { invoice: inv };
        }
        case "invoice": { const inv = B().invoices.find((x) => x.id === body.invoice_id); if (!inv) fail("not_found"); return { invoice: inv }; }
        case "contract_template_save": {
          const t = B().templates.at(-1);
          if (String(body.title ?? "").trim().length < 3 || String(body.body ?? "").trim().length < 50) fail("invalid_input");
          if (t.title !== body.title.trim() || t.body !== body.body.trim()) B().templates.push({ version: t.version + 1, title: body.title.trim(), body: body.body.trim(), created_at: iso() });
          commit(null); return all();
        }
        case "contract": { const c = B().contracts.find((x) => x.id === body.contract_id); if (!c) fail("not_found");
          return { contract: { ...c, business_name: businesses().find((b) => b.id === c.business_id)?.name }, seller: seller() }; }
        default: return undefined;
      }
    },
    owner(user, action, body) {
      switch (action) {
        case "billing": return billing(user);
        case "contract_accept": {
          const b = ownerBiz(user); if (!b) fail("not_found");
          if (body.version !== B().templates.at(-1).version) fail("contract_changed");
          if (String(body.name ?? "").trim().length < 3) fail("invalid_input", { field: "name" });
          if (!B().contracts.some((c) => c.business_id === b.id && c.version === body.version)) {
            const r = render(b, body.version);
            B().contracts.push({ id: uid(), business_id: b.id, version: r.version, title: r.title, body: r.body, body_sha256: "demo", accepted_by: user.id, accepted_name: body.name.trim(), accepted_at: iso() });
          }
          commit(null); return billing(user);
        }
        case "contract": { const c = B().contracts.find((x) => x.id === body.contract_id && businesses().find((b) => b.id === x.business_id)?.owner === user.id); if (!c) fail("not_found");
          return { contract: { ...c, business_name: businesses().find((b) => b.id === c.business_id)?.name }, seller: seller() }; }
        case "invoice": { const inv = B().invoices.find((x) => x.id === body.invoice_id && businesses().find((b) => b.id === x.business_id)?.owner === user.id); if (!inv) fail("not_found"); return { invoice: inv }; }
        case "quote_link": {
          const b = ownerBiz(user); if (!b) fail("not_found");
          const q = B().quotes.find((x) => x.token === body.token && ["sent", "viewed", "accepted"].includes(x.status) && !x.business_id); if (!q) fail("quote_not_found");
          Object.assign(q, { business_id: b.id, status: "accepted", accepted_at: q.accepted_at ?? iso() });
          if (q.plan && product(q.plan)?.kind === "plan") b.plan = q.plan;
          commit("*"); return { ok: true, plan: q.plan };
        }
        default: return undefined;
      }
    },
    publicQuote(token) {
      const q = B().quotes.find((x) => x.token === token && ["sent", "viewed", "accepted"].includes(x.status)); if (!q) fail("quote_not_found");
      if (q.status === "sent") { q.status = "viewed"; q.viewed_at = iso(); commit(null); }
      const { id, business_id, ...rest } = view(q);
      return { quote: rest, seller: seller(), trial_days: B().settings.trial_days };
    },
    acceptQuote(token, name) {
      const q = B().quotes.find((x) => x.token === token && ["sent", "viewed", "accepted"].includes(x.status)); if (!q) fail("quote_not_found");
      if (String(name ?? "").trim().length < 3) fail("invalid_input", { field: "name" });
      if (q.status !== "accepted") { if (q.valid_until < today()) fail("quote_expired"); Object.assign(q, { status: "accepted", accepted_at: iso(), accepted_name: name.trim() }); commit(null); }
      const { id, business_id, ...rest } = view(q);
      return { ok: true, quote: rest };
    },
  };
}
