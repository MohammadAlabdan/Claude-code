// Platform admin /admin: an insights dashboard (KPIs, revenue, trends, customers, risk, marketing tips, reports)
// plus the shops table with plan / dates / active controls and a read-only branch view.
import { h, icon, card, skeleton, fill, store } from "../ui/dom.js";
import { num, date, errorText, hourLabel, WEEKDAYS } from "../i18n.js";
import { openSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { requireSession } from "./auth.js";
import { BarChart } from "../ui/charts.js";

const PLAN_AR = { basic: "الأساسية", growth: "النمو", full: "المتكاملة", seasonal: "المواسم" };
const CAT_AR = { cafe: "مقاهي", restaurant: "مطاعم", bakery: "مخابز", barber: "حلاقين", salon: "مشاغل وصالونات", clinic: "عيادات", lab: "مختبرات",
  carwash: "مغاسل سيارات", phone_repair: "صيانة جوالات", other: "أخرى" };
const REASON_AR = { long_wait: "طول الانتظار", quality: "جودة الخدمة", treatment: "التعامل", price: "السعر", other: "أخرى" };
const TABS = [["overview", "نظرة عامة", "layout-dashboard"], ["shops", "المحلات", "building-store"], ["customers", "العملاء", "users"], ["tips", "نصائح وتقارير", "bulb"]];
const sar = (n) => `${num(Math.round(n ?? 0).toLocaleString("en-US"))} ر.س`;
const pct = (n) => (n == null ? "—" : `${num(n)}٪`);

export async function render(ctx) {
  const { api, shell } = ctx;
  await requireSession(ctx, { title: "لوحة الإدارة", lead: "للمسؤول عن منصة دوري فقط.", redirect: "/admin" });
  shell.setTitle("لوحة المنصة");
  // a dashboard needs room: widen the app frame on this screen only
  shell.app.classList.add("wide");
  ctx.onCleanup?.(() => shell.app.classList.remove("wide"));
  fill(shell.content, ...skeleton(3));

  let tab = store.get("dawri.admin.tab") ?? "overview";
  let days = store.get("dawri.admin.days") ?? 30;
  let list, ins, includeDemo = store.get("dawri.admin.demo");
  let query = "", filter = "all";

  async function load() {
    const [l, first] = await Promise.all([api.admin("list"), api.admin("insights", { days, include_demo: includeDemo === true })]);
    list = l.businesses;
    ins = first;
    // nothing real yet: show the demo shops instead of an empty board
    if (includeDemo == null && ins.kpi.businesses === 0 && ins.kpi.demo > 0) {
      includeDemo = true;
      ins = await api.admin("insights", { days, include_demo: true });
    }
  }
  try { await load(); } catch (e) {
    fill(shell.content, h("div.empty", icon("shield-off"), h("p", errorText(e)), h("button.btn", { type: "button", onclick: async () => { await api.auth.signOut(); ctx.rerender(); } }, "دخول بحساب آخر")));
    return;
  }
  const reload = async () => { fill(body, ...skeleton(2)); try { await load(); } catch (e) { toast(errorText(e), { error: true }); } draw(); };

  const root = h("div.adm");
  const body = h("div.stack", { style: { gap: "16px" } });
  fill(shell.content, root);

  function toolbar() {
    return h("div.adm-bar",
      h("div.seg", { role: "tablist", "aria-label": "أقسام اللوحة" }, TABS.map(([k, label, ic]) => h("button", { type: "button", role: "tab", "aria-selected": String(tab === k), "aria-pressed": String(tab === k), "data-tab": k,
        onclick: () => { tab = k; store.set("dawri.admin.tab", k); draw(); } }, icon(ic), h("span", label)))),
      h("div.adm-filters",
        h("label.adm-select", h("span.sr", "الفترة"), h("select", { "aria-label": "الفترة", onchange: (e) => { days = +e.target.value; store.set("dawri.admin.days", days); reload(); } },
          [[7, "آخر ٧ أيام"], [30, "آخر ٣٠ يوم"], [90, "آخر ٩٠ يوم"]].map(([v, l]) => h("option", { value: v, selected: v === days }, l)))),
        h("label.check.small", h("input", { type: "checkbox", checked: includeDemo === true, "data-testid": "admin-demo", onchange: (e) => { includeDemo = e.target.checked; store.set("dawri.admin.demo", includeDemo); reload(); } }),
          h("span", "تضمين المحلات التجريبية"))));
  }

  function draw() {
    fill(root, toolbar(), body);
    const k = ins.kpi;
    const banner = k.includes_demo && k.demo ? h("div.banner", icon("flask"), h("span", `الأرقام تشمل ${num(k.demo)} محلات تجريبية. ألغِ «تضمين المحلات التجريبية» لترى المشتركين الحقيقيين فقط.`)) : null;
    if (tab === "overview") fill(body, banner, ...overview());
    else if (tab === "shops") fill(body, ...shops());
    else if (tab === "customers") fill(body, banner, ...customers());
    else fill(body, banner, ...tipsAndReports());
  }

  // ---------- pieces ----------
  const delta = (cur, prev) => {
    if (!prev) return null;
    const d = Math.round((100 * (cur - prev)) / prev);
    return h(`span.kpi-d.${d >= 0 ? "up" : "down"}`, { "aria-label": `${d >= 0 ? "زيادة" : "نقص"} ${Math.abs(d)}٪ عن الفترة السابقة` }, d >= 0 ? "▲ " : "▼ ", `${num(Math.abs(d))}٪`);
  };
  const kpi = (label, value, { sub, d, ic, tone } = {}) => h(`div.kpi${tone ? "." + tone : ""}`,
    h("div.kpi-top", h("span.kpi-l", label), ic ? icon(ic) : null), h("b.kpi-v", value), h("div.kpi-s", d ?? null, sub ? h("span", sub) : null));

  /** Horizontal bars, one hue; label on the right, value on the left; hover shows exact numbers. */
  const hbars = (rows, { value, label, fmt = num, note } = {}) => {
    const max = Math.max(1, ...rows.map(value));
    return h("div.hbars", rows.length ? rows.map((r) => h("div.hb", { title: `${label(r)}: ${fmt(value(r))}${note ? " · " + note(r) : ""}` },
      h("span.hb-l", label(r)), h("span.hb-t", h("i", { style: { width: `${Math.max(2, (100 * value(r)) / max)}%` } })), h("span.hb-v", fmt(value(r)))))
      : h("p.muted.small", "لا توجد بيانات في هذه الفترة"));
  };

  /** Daily trend: one series, 2px line, hover a day to read its numbers. */
  function trend(daily) {
    const NS = "http://www.w3.org/2000/svg", w = 960, H = 220, padL = 34, padB = 24;
    const el = (t, a = {}, ...kids) => { const e = document.createElementNS(NS, t); for (const [k2, v] of Object.entries(a)) e.setAttribute(k2, v); kids.forEach((c) => e.append(c)); return e; };
    const vals = daily.map((d) => d.tickets), max = Math.max(1, ...vals);
    const x = (i) => padL + (daily.length === 1 ? 0 : (i * (w - padL - 8)) / (daily.length - 1)), y = (v) => H - padB - (v / max) * (H - padB - 12);
    const svg = el("svg", { viewBox: `0 0 ${w} ${H}`, class: "chart adm-trend", role: "img", "aria-label": `التذاكر اليومية: أعلى يوم ${max}` });
    [0, 0.5, 1].forEach((f) => { svg.append(el("line", { class: "grid", x1: padL, x2: w, y1: y(max * f), y2: y(max * f) })); svg.append(el("text", { x: 0, y: y(max * f) + 4 }, document.createTextNode(num(Math.round(max * f))))); });
    const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    svg.append(el("path", { class: "area", d: `${d}L${x(vals.length - 1)},${H - padB}L${x(0)},${H - padB}Z` }), el("path", { class: "line", d }));
    const step = Math.max(1, Math.ceil(daily.length / 6));
    daily.forEach((p, i) => {
      if (i % step === 0 || i === daily.length - 1) svg.append(el("text", { x: x(i), y: H - 4, "text-anchor": "middle" }, document.createTextNode(date(p.day).replace(/\s\d{4}$/, ""))));
      const hit = el("rect", { class: "hit", x: x(i) - (w / daily.length) / 2, y: 0, width: w / daily.length, height: H - padB });
      hit.append(el("title", {}, document.createTextNode(`${date(p.day)}: ${p.tickets} تذكرة · خُدم ${p.served}`)));
      svg.append(hit);
    });
    svg.append(el("circle", { class: "dot", cx: x(vals.length - 1), cy: y(vals.at(-1) ?? 0), r: 4 }));
    return svg;
  }

  function overview() {
    const k = ins.kpi, peakHour = ins.hourly.indexOf(Math.max(...ins.hourly));
    return [
      h("div.adm-kpis",
        kpi("الدخل الشهري المتكرر", sar(k.mrr_sar), { ic: "cash", tone: "hero", sub: k.mrr_potential_sar ? `+ ${sar(k.mrr_potential_sar)} محتمل من التجارب` : "من الاشتراكات المدفوعة" }),
        kpi("المحلات النشطة", num(k.active), { ic: "building-store", sub: `${num(k.paying)} مدفوع · ${num(k.trials)} تجربة` }),
        kpi("التذاكر", num(k.tickets), { ic: "ticket", d: delta(k.tickets, k.tickets_prev), sub: `${num(k.tickets_today)} اليوم` }),
        kpi("متوسط الانتظار", k.avg_wait_min != null ? `${num(k.avg_wait_min)} د` : "—", { ic: "clock", sub: `من نداء الزبون عن بعد` }),
        kpi("رضا الزبائن", pct(k.satisfaction_pct), { ic: "mood-smile", sub: `${num(ins.feedback?.positive ?? 0)} تقييم إيجابي` }),
        kpi("زبائن طلعوا قبل دورهم", pct(k.left_pct), { ic: "door-exit", tone: k.left_pct > 8 ? "warn" : null, sub: "من حجوزات الطابور عن بعد" }),
        kpi("تجارب تنتهي خلال ٧ أيام", num(k.trials_ending_7d), { ic: "hourglass", tone: k.trials_ending_7d ? "warn" : null, sub: "فرصة تحويل لمدفوع" }),
        kpi("محلات جديدة", num(k.new_businesses), { ic: "sparkles", sub: `خلال الفترة · ${num(k.branches)} فرع` })),
      card("التذاكر اليومية على المنصة", "chart-line", trend(ins.daily), h("p.muted.small", `خُدم ${num(k.served)} زبون من ${num(k.tickets)} تذكرة. مرّر على أي يوم لتفاصيله.`)),
      h("div.adm-2",
        card("ساعات الذروة", "clock-hour-8", BarChart(ins.hourly, { labels: ins.hourly.map((_, i) => num(i)), every: 3, height: 110, title: "التذاكر حسب الساعة" }),
          h("p.small", icon("flame"), ` أعلى ساعة: ${hourLabel(peakHour)}`)),
        card("أيام الأسبوع", "calendar-week", BarChart(ins.weekday, { labels: WEEKDAYS.ar.map((d) => d.replace(/^ال/, "")), every: 1, height: 110, title: "التذاكر حسب اليوم" }),
          h("p.small", icon("calendar-star"), ` أنشط يوم: ${WEEKDAYS.ar[ins.weekday.indexOf(Math.max(...ins.weekday))]}`))),
      h("div.adm-2",
        card("الباقات والدخل", "receipt", hbars(ins.plans, { label: (r) => `${PLAN_AR[r.plan] ?? r.plan} (${num(r.count)})`, value: (r) => r.mrr, fmt: sar })),
        card("القطاعات الأنشط", "category", hbars(ins.categories, { label: (r) => `${CAT_AR[r.category] ?? r.category} (${num(r.businesses)})`, value: (r) => r.tickets, note: () => "تذكرة" }))),
      card("أنشط المحلات", "trophy", h("div.list", ins.top.length ? ins.top.map((r, i) => h("div.list-item",
        h("span.rank", num(i + 1)), h("div.grow", h("div.title", r.name, r.is_demo ? h("span.badge", { style: { marginInlineStart: "6px" } }, "تجريبي") : null), h("div.muted.small", `${CAT_AR[r.category] ?? r.category} · ${PLAN_AR[r.plan] ?? r.plan}`)),
        h("div.center", h("b.num", num(r.tickets)), r.growth_pct != null ? h(`div.kpi-d.${r.growth_pct >= 0 ? "up" : "down"}`, r.growth_pct >= 0 ? "▲ " : "▼ ", `${num(Math.abs(r.growth_pct))}٪`) : null)))
        : [h("p.muted", "لا توجد تذاكر في هذه الفترة")])),
    ];
  }

  function customers() {
    const k = ins.kpi, e = ins.engagement, f = ins.feedback ?? { positive: 0, negative: 0, reasons: [] };
    return [
      h("div.adm-kpis",
        kpi("زبائن معروفون", num(k.customers_known), { ic: "address-book", sub: "أعطوا رقمهم بموافقتهم" }),
        kpi("زبائن راجعون", pct(k.returning_pct), { ic: "repeat", sub: "زاروا مرتين أو أكثر", tone: (k.returning_pct ?? 0) < 25 ? "warn" : null }),
        kpi("فعّلوا التنبيه", pct(k.push_pct), { ic: "bell-ringing", sub: "من الزبائن عن بعد" }),
        kpi("حجزوا من جوالهم", pct(k.remote_pct), { ic: "device-mobile", sub: "والباقي أضافهم الموظف" }),
        kpi("غياب بعد النداء", pct(k.no_show_pct), { ic: "user-x", tone: (k.no_show_pct ?? 0) > 10 ? "warn" : null, sub: "من الزبائن اللي انتادوا" }),
        kpi("طلبات «أبيها»", num(e.upsell_interests), { ic: "hand-finger", sub: "خدمات إضافية طُلبت وهم ينتظرون" }),
        kpi("تحدّيات بدأت", num(e.quests_started), { ic: "flag-3", sub: `${num(e.quests_completed)} اكتملت · ${num(e.quests_redeemed)} استُلمت` }),
        kpi("عروض استُخدمت", num(e.offer_redemptions), { ic: "discount", sub: `${num(e.quiet_watches)} ينتظرون «نبّهني لما تهدأ»` })),
      h("div.adm-2",
        card("رحلة الزبون", "route", hbars([
          { l: "أخذوا رقم", v: k.tickets }, { l: "خُدموا", v: k.served },
          { l: "بدأوا تحدّياً", v: e.quests_started }, { l: "طلبوا «أبيها»", v: e.upsell_interests }, { l: "استخدموا عرضاً", v: e.offer_redemptions }],
          { label: (r) => r.l, value: (r) => r.v })),
        card("أسباب عدم الرضا", "mood-sad", f.negative ? hbars(f.reasons, { label: (r) => REASON_AR[r.reason] ?? r.reason, value: (r) => r.count }) : h("p.muted", "ما فيه تقييمات سلبية في هذه الفترة 👏"),
          h("p.muted.small", `${num(f.positive)} إيجابي · ${num(f.negative)} سلبي`))),
      h("div.banner", icon("shield-check"), h("span", "الخصوصية: لا نعرض أرقام جوالات الزبائن هنا. التحليل مجمّع فقط، ورقم الجوال يُحفظ لمن وافق، وتمسحه الصيانة الدورية.")),
    ];
  }

  // ---------- marketing tips from the numbers ----------
  function tips() {
    const k = ins.kpi, e = ins.engagement, out = [];
    const add = (level, ic, title, text, action) => out.push({ level, ic, title, text, action });
    const peakHour = ins.hourly.indexOf(Math.max(...ins.hourly));
    const topCat = ins.categories[0];
    if (k.trials_ending_7d) add(1, "hourglass", `${num(k.trials_ending_7d)} تجارب تنتهي خلال أسبوع`, "اتصل بأصحابها اليوم: اعرض خصم أول شهر أو شهرين بسعر واحد للدفع السنوي. المحل اللي استخدم النظام أكثر من ٢٠ تذكرة احتمال اشتراكه أعلى.", "shops");
    if (ins.at_risk.length) add(1, "alert-triangle", `${num(ins.at_risk.length)} محلات انخفض استخدامها`, "غالباً الموظف رجع للطريقة القديمة. زيارة أو مكالمة تدريب ١٠ دقائق، وتذكير بطباعة الملصق عند الباب، تنقذ الاشتراك.", "shops");
    if (topCat && topCat.tickets) add(2, "target-arrow", `ركّز حملتك على ${CAT_AR[topCat.category] ?? topCat.category}`, `هو القطاع الأنشط (${num(topCat.tickets)} تذكرة). استخدم قصص نجاحه في إعلاناتك واستهدف محلات نفس القطاع في الأحياء القريبة.`);
    if (ins.hourly[peakHour]) add(2, "speakerphone", `انشر إعلاناتك قبل ${hourLabel(peakHour)}`, "هذا وقت الزحمة الأعلى، وأصحاب المحلات يحسّون بالمشكلة فيه أكثر شي. إعلان قبله بساعة أو ساعتين يوصل في اللحظة الصح.");
    if ((k.returning_pct ?? 100) < 30) add(2, "repeat", "نسبة الزبائن الراجعين منخفضة", `${pct(k.returning_pct)} فقط زاروا أكثر من مرة. شجّع المحلات على تفعيل «تحدّياتي» (ثلاث زيارات والرابعة علينا)، فهي تجيب زيارات متكررة يمكن قياسها.`);
    if ((k.push_pct ?? 100) < 50) add(3, "bell-ringing", "زبائن كثير ما فعّلوا التنبيه", "اقترح على المحلات جملة يقولها الموظف: «فعّل التنبيه ونبلّغك قبل دورك». التنبيه يقلل الغياب ويرفع الرضا.");
    if ((k.no_show_pct ?? 0) > 8) add(2, "user-x", "الغياب بعد النداء مرتفع", "تأكد أن المحلات تستخدم «ارجع الآن» وزر «ما حضر» بدل الإلغاء، حتى ما يضيع دور الزبون من أول مرة.");
    const basic = ins.plans.find((p) => p.plan === "basic");
    if (basic && basic.count >= 1) add(2, "trending-up", `${num(basic.count)} محل على الباقة الأساسية`, `اعرض عليهم ترقية «النمو»: «أبيها» وحده جاب ${num(e.upsell_interests)} طلب إضافي على المنصة في هذه الفترة. ابدأ بالمحلات الأنشط.`);
    const reason = ins.feedback?.reasons?.[0];
    if (reason) add(3, "mood-sad", `أكثر سبب للتقييم السلبي: ${REASON_AR[reason.reason] ?? reason.reason}`, reason.reason === "long_wait"
      ? "انصح المحلات بتفعيل «تحدّي العصر الهادئ» لتوزيع الزحمة، وإضافة موظف وقت الذروة."
      : "شارك المحلات المعنية بالملاحظة في ملخص المساء، واقترح عرضاً لتعويض الزبائن غير الراضين.");
    if (!e.quests_started) add(3, "flag-3", "التحدّيات غير مستخدمة", "أنشئ للمحلات تحدّياً جاهزاً من الاقتراحات الذكية في لوحتهم. هي أسرع طريق لإثبات قيمة النظام.");
    if (!out.length) add(3, "circle-check", "كل شي يمشي تمام", "استمر في متابعة المؤشرات أسبوعياً، وركّز على جلب محلات جديدة.");
    return out.sort((a, b) => a.level - b.level);
  }

  function tipsAndReports() {
    const LV = { 1: ["عاجل", "danger"], 2: ["مهم", "warn"], 3: ["فرصة", ""] };
    return [
      card("نصائح تسويقية من أرقامك", "bulb", h("div.tips", { "data-testid": "admin-tips" }, tips().map((t) => h(`article.tip.lv${t.level}`,
        h("div.tip-h", icon(t.ic), h("b", t.title), h(`span.badge${LV[t.level][1] ? "." + LV[t.level][1] : ""}`, LV[t.level][0])),
        h("p", t.text), t.action ? h("button.btn.btn-sm", { type: "button", onclick: () => { tab = t.action; draw(); } }, "افتح القائمة") : null)))),
      card("التقارير", "file-analytics",
        h("p.muted.small", "صدّر الأرقام لملف Excel، أو اطبع تقريراً شهرياً لشركائك."),
        h("div.grid2",
          h("button.btn", { type: "button", "data-testid": "export-shops", onclick: exportShops }, icon("table-export"), "المحلات (Excel)"),
          h("button.btn", { type: "button", onclick: exportDaily }, icon("chart-histogram"), "الأرقام اليومية (Excel)"),
          h("button.btn", { type: "button", onclick: exportTips }, icon("bulb"), "النصائح (نص)"),
          h("button.btn", { type: "button", onclick: () => window.print() }, icon("printer"), "اطبع التقرير"))),
    ];
  }

  // ---------- shops ----------
  function riskOf(b) {
    if (ins.at_risk.some((r) => r.id === b.id)) return "risk";
    if (b.trial_until && Date.parse(b.trial_until) > Date.now()) return "trial";
    if (!b.is_active) return "off";
    return b.effective_plan ? "paid" : "off";
  }
  function shops() {
    const FILTERS = [["all", "الكل"], ["paid", "مدفوع"], ["trial", "تجربة"], ["risk", "معرّض للانسحاب"], ["off", "موقوف"]];
    const rows = list.filter((b) => (includeDemo || !b.is_demo) && (filter === "all" || riskOf(b) === filter)
      && (!query || `${b.name} ${b.owner_email ?? ""}`.toLowerCase().includes(query.toLowerCase())));
    const tableBody = h("tbody");
    const paint = () => fill(tableBody, ...rows.map((b) => h("tr",
      h("td", h("div.title", b.name), h("div.muted.small", b.owner_email ?? "")),
      h("td", PLAN_AR[b.plan], riskOf(b) === "trial" ? h("div.badge.warn", "تجربة") : riskOf(b) === "risk" ? h("div.badge.danger", "انخفض الاستخدام") : null),
      h("td.num", b.plan_until ? date(b.plan_until) : b.trial_until ? date(b.trial_until) : "—"),
      h("td", b.is_active ? h("span.badge", "نشط") : h("span.badge.danger", "موقوف")),
      h("td.num", num(b.usage.tickets_30d)),
      h("td", h("button.btn.btn-sm", { type: "button", onclick: () => edit(b) }, "إدارة")))));
    paint();
    const lists = [];
    if (ins.trials_ending.length) lists.push(card("تجارب على وشك الانتهاء", "hourglass", h("div.list", ins.trials_ending.map((t) => h("div.list-item",
      h("div.grow", h("div.title", t.name), h("div.muted.small", `${t.owner_email ?? ""} · ${num(t.tickets)} تذكرة`)),
      h(`span.badge${t.days_left <= 2 ? ".danger" : ".warn"}`, t.days_left ? `باقي ${num(t.days_left)} يوم` : "تنتهي اليوم"),
      t.engaged ? h("span.badge", "مستخدم بقوة") : null)))));
    if (ins.at_risk.length) lists.push(card("معرّضون للانسحاب", "alert-triangle", h("div.list", ins.at_risk.map((r) => h("div.list-item",
      h("div.grow", h("div.title", r.name), h("div.muted.small", r.owner_email ?? "")),
      h("span.badge.danger", r.reason === "idle" ? "ما استخدم النظام ٧ أيام" : `${num(r.last7)} تذكرة بدل ${num(r.prev7)}`))))));
    return [
      lists.length ? h("div.adm-2", ...lists) : null,
      card(`المحلات (${num(rows.length)})`, "building-store",
        h("div.row", { style: { gap: "8px", flexWrap: "wrap" } },
          h("label.field", { style: { flex: "1 1 220px", margin: 0 } }, h("span.sr", "بحث"), h("input", { type: "search", placeholder: "ابحث بالاسم أو البريد", value: query, "data-testid": "admin-search",
            oninput: (e) => { query = e.target.value; const pos = e.target.selectionStart; draw(); const inp = document.querySelector("[data-testid=admin-search]"); inp?.focus(); inp?.setSelectionRange(pos, pos); } })),
          h("button.btn.btn-sm", { type: "button", onclick: exportShops }, icon("table-export"), "Excel")),
        h("div.chips", FILTERS.map(([k2, l]) => h("button.chip", { type: "button", "aria-pressed": String(filter === k2), onclick: () => { filter = k2; draw(); } }, l))),
        h("div.table-wrap", h("table.simple", { "data-testid": "admin-table" },
          h("thead", h("tr", ["المحل", "الباقة", "ينتهي", "الحالة", "تذاكر ٣٠ يوم", ""].map((x) => h("th", x)))), tableBody))),
    ];
  }

  async function edit(b) {
    const plan = h("select", Object.entries(PLAN_AR).map(([k2, v]) => h("option", { value: k2, selected: k2 === b.plan }, v)));
    const until = h("input", { type: "date", value: b.plan_until?.slice(0, 10) ?? "" });
    const trial = h("input", { type: "date", value: b.trial_until?.slice(0, 10) ?? "" });
    const active = h("input", { type: "checkbox", checked: b.is_active });
    await openSheet({ title: b.name, body: [
      h("label.field", h("span", "الباقة"), plan), h("label.field", h("span", "الاشتراك حتى"), until), h("label.field", h("span", "التجربة حتى"), trial),
      h("label.check", active, h("span", "الحساب نشط")),
      h("div.list", b.branches.map((br) => h("div.list-item", h("span.grow", br.name), h("a.btn.btn-sm", { href: `./s/${br.public_id}`, target: "_blank", rel: "noopener" }, "الصفحة"),
        h("button.btn.btn-sm", { type: "button", onclick: () => view(br) }, "الأرقام"))))],
      actions: [{ label: "احفظ", primary: true, onClick: async (close) => {
        try {
          await api.admin("update_business", { business_id: b.id, changes: { plan: plan.value, plan_until: until.value ? `${until.value}T23:59:59+03:00` : null, trial_until: trial.value ? `${trial.value}T23:59:59+03:00` : null, is_active: active.checked } });
          close(); toast("تم الحفظ"); await reload();
        } catch (e) { toast(errorText(e), { error: true }); }
      } }, { label: "إغلاق", ghost: true }] });
  }
  async function view(br) {
    const d = await api.admin("branch_dashboard", { branch_id: br.id, range: "7d" });
    openSheet({ title: `${br.name} · ٧ أيام`, body: [h("div.grid2",
      ...[["خدمت", d.served], ["انضموا", d.joined], ["متوسط الانتظار", d.avg_wait_min != null ? `${num(d.avg_wait_min)} د` : "—"], ["راضون", d.satisfaction_pct != null ? `${num(d.satisfaction_pct)}٪` : "—"]]
        .map(([l, v]) => h("div.stat", h("span.label", l), h("span.value", typeof v === "number" ? num(v) : v))))], actions: [{ label: "إغلاق", primary: true }] });
  }

  // ---------- exports (CSV with BOM so Excel shows Arabic correctly) ----------
  function download(name, rows) {
    const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: name });
    document.body.append(a); a.click(); a.remove();
    toast("نزل الملف");
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  function exportShops() {
    download(`dawri-shops-${stamp()}.csv`, [["المحل", "البريد", "القطاع", "الباقة", "الحالة", "الاشتراك حتى", "التجربة حتى", "تذاكر 30 يوم", "أجهزة", "الفروع", "تجريبي"],
      ...list.map((b) => [b.name, b.owner_email, CAT_AR[b.category] ?? b.category, PLAN_AR[b.plan], b.is_active ? "نشط" : "موقوف", b.plan_until?.slice(0, 10), b.trial_until?.slice(0, 10),
        b.usage.tickets_30d, b.usage.devices, b.branches.map((x) => x.name).join(" | "), b.is_demo ? "نعم" : "لا"])]);
  }
  function exportDaily() {
    download(`dawri-daily-${stamp()}.csv`, [["اليوم", "التذاكر", "خُدم"], ...ins.daily.map((d) => [d.day, d.tickets, d.served])]);
  }
  async function exportTips() {
    const text = tips().map((t, i) => `${i + 1}. ${t.title}\n${t.text}`).join("\n\n");
    try { await navigator.clipboard.writeText(text); toast("نسخنا النصائح، الصقها في واتساب أو بريد"); } catch { download(`dawri-tips-${stamp()}.txt`, [[text]]); }
  }

  draw();
}
