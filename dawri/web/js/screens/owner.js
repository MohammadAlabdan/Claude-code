// Owner app /owner/{home|queue|offers|pulse|settings}. Arabic only. Locked features show a lock card, never a broken button.
import { h, icon, card, store, skeleton, empty, fill } from "../ui/dom.js";
import { num, time, date, errorText, WEEKDAYS, hourLabel } from "../i18n.js";
import { BusyPill, LockedCard } from "../ui/components.js";
import { openSheet, confirmSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { BarChart, LineChart, Heatmap } from "../ui/charts.js";
import { QR } from "../ui/qr.js";
import { subscribePush } from "../ui/push.js";
import { setTheme, currentTheme } from "../app.js";
import { requireSession } from "./auth.js";
import { QuestCard } from "../ui/quest.js";

const TABS = [
  { key: "home", href: "./owner", icon: "home", label: "الرئيسية" },
  { key: "queue", href: "./owner/queue", icon: "users-group", label: "الطابور" },
  { key: "offers", href: "./owner/offers", icon: "discount", label: "العروض" },
  { key: "pulse", href: "./owner/pulse", icon: "activity-heartbeat", label: "نبضي" },
  { key: "settings", href: "./owner/settings", icon: "settings", label: "الإعدادات" },
];
const PLAN_AR = { basic: "الأساسية", growth: "النمو", full: "المتكاملة", seasonal: "وضع المواسم" };
const MODE_AR = { remote: "احجز دورك من برّا", receipt: "ادفع وانتظر", dropoff: "سلّم وارجع" };
const REASON_AR = { long_wait: "الانتظار طويل", quality: "الجودة", treatment: "التعامل", price: "السعر", other: "شي ثاني" };
const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const QKIND = { visits: "زيارات", quiet: "الوقت الهادئ", comeback: "اشتقنا لك (للغايبين)", provider: "جرّب مقدّم خدمة", friend: "مع خويك (شخصين)" };
const LANGS = { ar: "العربية", en: "English", ur: "اردو", bn: "বাংলা", fil: "Filipino" };
const FEATURE_AR = {
  queue: "الطابور الرقمي", fadeet: "فضيت؟", return_now: "ارجع الآن", card: "بطاقتي", evening_summary: "ملخص المساء", late_button: "تأخرت شوي",
  family_ticket: "تذكرة العائلة", priority: "أولوية بلمسة", lost_customers: "حاسبة الزبائن الضائعين", staff_language: "شاشة الموظف بلغته",
  menu: "قائمتي", menu_photo_ai: "صوّر قائمتك", timed_offers: "العروض حسب الوقت", loyalty: "مرّيت علينا", feedback: "التقييم بالأسباب",
  preferred_provider: "حالقي المفضّل", best_time: "أفضل وقت تجي", busy_alert: "إنذار الزحمة", full_page: "صفحتي الكاملة", news: "وش الجديد؟",
  qa_assistant: "مساعد الأسئلة", quiet_coupon: "كوبون الهدوء", peak_report: "تقرير الذروة", absent_customers: "الغايبون",
  quests: "تحدّياتي", upsell: "أبيها (طلب إضافة وقت الانتظار)", smart_quests: "التحديات الذكية",
};
const MIN_PLAN = (f) => (["queue", "fadeet", "return_now", "card", "evening_summary", "late_button", "family_ticket", "priority", "lost_customers", "staff_language"].includes(f) ? "basic"
  : ["menu", "menu_photo_ai", "timed_offers", "loyalty", "feedback", "preferred_provider", "best_time", "busy_alert", "quests", "upsell"].includes(f) ? "growth" : "full");

const field = (label, input, hint) => h("label.field", h("span", label), input, hint ? h("span.muted.small", { style: { fontWeight: 400 } }, hint) : null);
const locked = (feature, title = FEATURE_AR[feature]) => LockedCard(title, MIN_PLAN(feature));

export async function render(ctx) {
  const { api, shell, params, nav } = ctx;
  const tab = params[0] || "home";
  await requireSession(ctx);
  shell.setTitle("…");
  fill(shell.content, ...skeleton(3));

  let ov;
  try { ov = await api.owner("overview"); } catch (e) {
    if (e.code === "unauthorized") { await api.auth.signOut(); return ctx.rerender(); }
    fill(shell.content, empty(errorText(e), "alert-triangle", h("button.btn", { type: "button", onclick: ctx.rerender }, "حاول مرة ثانية")));
    return;
  }
  if (!ov.businesses.length) {
    shell.setTitle("أهلاً");
    fill(shell.content, h("section.card.center", { style: { justifyItems: "center" } }, h("img.hero-logo", { src: "./assets/logo.svg", alt: "" }), h("h2", "ما عندك محل مسجّل"),
      h("p.muted", "ركّب دوري لمحلك في ١٠ دقائق."), h("a.btn.btn-primary", { href: "./start" }, "ابدأ التهيئة")),
      ov.is_admin ? h("a.btn.btn-block", { href: "./admin" }, icon("shield"), "لوحة الإدارة") : null,
      h("button.btn.btn-ghost.btn-block", { type: "button", onclick: async () => { await api.auth.signOut(); ctx.rerender(); } }, "تسجيل خروج"));
    return;
  }

  const branches = ov.businesses.flatMap((b) => b.branches.map((br) => ({ ...br, business: b })));
  let br = branches.find((x) => x.id === store.get("dawri.owner.branch")) ?? branches[0];
  const bz = br.business;
  const f = br.features;
  const has = (x) => f.includes(x);
  shell.setTitle(bz.name);
  shell.setTabs(TABS, tab);
  shell.setActions(h("a.icon-btn", { href: `./s/${br.public_id}`, target: "_blank", rel: "noopener", "aria-label": "صفحة المحل" }, icon("external-link")));

  const refreshOverview = async () => { ov = await api.owner("overview"); br = ov.businesses.flatMap((b) => b.branches.map((x) => ({ ...x, business: b }))).find((x) => x.id === br.id) ?? br; };
  const draw = { home, queue, offers, pulse, settings }[tab] ?? home;
  const root = h("div.stack", { style: { gap: "16px" } });
  fill(shell.content, root);
  await draw();
  const unsub = api.subscribe(br.public_id, () => (tab === "queue" || tab === "home") && draw().catch(() => {}));
  ctx.onCleanup(unsub);

  function planBadge() {
    const trial = bz.trial_days_left > 0;
    return h("div.row.between",
      h("div.row", h("span.badge", `باقة ${PLAN_AR[bz.effective_plan ?? bz.plan] ?? "موقوفة"}`), trial ? h("span.badge.warn", `تجربة مجانية: باقي ${num(bz.trial_days_left)} يوم`) : null),
      branches.length > 1 ? h("span.muted.small", br.name) : null);
  }

  // ---------------- الرئيسية ----------------
  async function home() {
    const d = await api.owner("dashboard", { branch_id: br.id, range: "today" });
    const q = await api.owner("queue", { branch_id: br.id });
    fill(root, 
      planBadge(),
      h("div.grid2",
        stat("خدمت اليوم", num(d.served)),
        stat("متوسط الانتظار", d.avg_wait_min != null ? `${num(d.avg_wait_min)} د` : "—"),
        stat("راضون", d.satisfaction_pct != null ? `${num(d.satisfaction_pct)}٪` : "—"),
        stat("بالانتظار الآن", num(d.live.waiting))),
      has("lost_customers") && d.lost ? h("section.stat.highlight", { "data-testid": "lost-sar" },
        h("span.label", "حاسبة الزبائن الضائعين"),
        h("span.value", `≈ ${num(d.lost.sar)} ريال`),
        h("span.small", `خسرت اليوم ${num(d.lost.count)} زباين ≈ ${num(d.lost.sar)} ريال`)) : locked("lost_customers"),
      card("الطابور الآن", "users-group",
        h("div.row.between", BusyPill(q.busy_level), h("a.small", { href: "./owner/queue" }, "التفاصيل")),
        h("div.list", q.services.map((s) => h("div.list-item", h("div.grow", h("div.title", s.name), h("div.muted.small", MODE_AR[s.mode])),
          h("div.small", { style: { textAlign: "end" } }, h("div", `${num(s.waiting)} ينتظرون`), s.mode === "remote" ? h("div.muted", `يُخدم الآن: ${s.now_serving ? num(s.now_serving) : "—"}`) : null))))),
      d.latest_summary ? card("ملخص المساء", "moon", h("p", d.latest_summary.text), h("p.muted.small", date(d.latest_summary.day + "T12:00:00Z"))) : card("ملخص المساء", "moon", h("p.muted", "يوصلك أول ملخص الليلة الساعة " + num(br.settings.summary_time))),
      has("busy_alert") ? card("إنذار الزحمة", "alarm",
        h("p.small", `ينبّهك إذا وصل الطابور ${num(br.settings.busy_alert_threshold)} وأنت بعيد.`),
        h("p.muted.small", d.live.busy_alert?.last_alert_at ? `آخر إنذار: ${time(d.live.busy_alert.last_alert_at)}` : "ما صار إنذار اليوم")) : locked("busy_alert"),
      h("div.grid2",
        h("a.btn", { href: `./s/${br.public_id}`, target: "_blank", rel: "noopener" }, icon("building-store"), "صفحة المحل"),
        h("a.btn", { href: "./owner/poster" }, icon("printer"), "ملصق QR")),
      h("button.btn.btn-block", { type: "button", onclick: enableOwnerPush }, icon("bell"), "فعّل تنبيهاتي على هذا الجوال"),
    );
  }

  function stat(label, value) { return h("div.stat", h("span.label", label), h("span.value", value)); }

  async function enableOwnerPush() {
    try { const sub = await subscribePush(); await api.owner("subscribe_push", { subscription: sub }); toast("تم، بتوصلك التنبيهات"); }
    catch (e) { toast(e?.message === "denied" ? "رفض المتصفح التنبيهات، فعّلها من إعدادات المتصفح" : errorText(e), { error: true }); }
  }

  // ---------------- الطابور ----------------
  async function queue() {
    const q = await api.owner("queue", { branch_id: br.id });
    const svcName = (id) => q.services.find((s) => s.id === id)?.name ?? "";
    fill(root, 
      card("حالة الزحمة", "gauge", h("div.row", h("span.muted.small", "الآن:"), BusyPill(q.busy_level)),
        h("div.seg", [["free", "فاضي"], ["some", "زحمة خفيفة"], ["busy", "زحمة"], [null, "تلقائي"]].map(([lv, label]) =>
          h("button", { type: "button", onclick: async () => { await api.owner("set_busy", { branch_id: br.id, level: lv }); toast("تم"); queue(); } }, label)))),
      ...q.services.map((s) => card(s.name, s.mode === "remote" ? "users" : s.mode === "receipt" ? "receipt" : "car",
        h("div.grid2", stat("يُخدم الآن", num(s.now_serving ?? "—")), stat("بالانتظار", num(s.waiting))),
        s.mode === "remote" ? h("p.muted.small", `انتظار المنضم الآن: حوالي ${num(s.estimate_min)} دقيقة`) : null)),
      q.providers.length ? card("الكراسي", "armchair", h("div.list", q.providers.map((p) => h("div.list-item", h("span.grow", p.name),
        h("div.small", { style: { textAlign: "end" } }, h("div", `${num(p.waiting)} ينتظرونه`), h("div.muted", `يُخدم الآن: ${p.serving ? num(p.serving) : "—"}`)))))) : null,
      card("التذاكر النشطة", "list-numbers", q.tickets.length ? h("div.list", q.tickets.map((x) => h("div.list-item",
        h("strong.num", { style: { minWidth: "3ch", fontSize: "1.2rem" } }, num(x.receipt_code ?? x.number)),
        h("div.grow", h("div", svcName(x.service_id)), h("div.muted.small", [x.item_label, x.party_size > 1 ? `${num(x.party_size)} أشخاص` : null, x.priority ? "أولوية" : null].filter(Boolean).join(" · "))),
        h("span.badge", { waiting: "بالانتظار", called: "تم النداء", serving: "يُخدم" }[x.status] ?? x.status)))) : h("p.muted.center", "ما فيه أحد الحين")),
      h("a.btn.btn-block", { href: "./owner/settings#devices" }, icon("device-mobile"), "افتح شاشة الموظف (اربط جهاز)"),
    );
  }

  // ---------------- العروض ----------------
  async function offers() {
    const parts = [await questsSection()];
    if (has("quiet_coupon") || has("timed_offers")) {
      const sug = await api.owner("suggest_quiet_coupon", { branch_id: br.id }).catch(() => null);
      if (sug?.suggestion) {
        parts.push(sug.locked ? locked("quiet_coupon", `${sug.suggestion.label_ar}: كوبون الهدوء`) :
          h("section.card", { "data-testid": "quiet-suggestion", style: { background: "var(--ticket)" } },
            h("div.card-head", icon("bulb"), h("h3", `${sug.suggestion.label_ar}، فعّل كوبون الهدوء`)),
            h("p.small", "خصم للساعات الهادئة يجيب زباين في وقت فاضي. تقدر تعدّله بعدين."),
            h("button.btn.btn-primary", { type: "button", onclick: async () => {
              const { label_ar: _l, ...row } = sug.suggestion;
              try { await api.owner("upsert", { table: "offers", row }); toast("تم تفعيل كوبون الهدوء"); offers(); } catch (e) { toast(errorText(e), { error: true }); }
            } }, icon("bolt"), "فعّل بلمسة")));
      }
    } else parts.push(locked("quiet_coupon"));

    if (has("timed_offers")) {
      const { rows } = await api.owner("list", { table: "offers", branch_id: br.id });
      parts.push(card("العروض", "discount",
        rows.length ? h("div.list", rows.map((o) => h("div.list-item",
          h("div.grow", h("div.title", o.title, o.kind === "quiet_coupon" ? h("span.badge", { style: { marginInlineStart: "6px" } }, "هدوء") : null),
            h("div.muted.small", [o.discount_text, o.weekdays?.length === 7 ? "كل الأيام" : o.weekdays?.map((d) => WEEKDAYS.ar[d]).join("، "), o.start_time ? num(`${o.start_time.slice(0, 5)}–${o.end_time?.slice(0, 5) ?? ""}`) : "كل اليوم"].filter(Boolean).join(" · "))),
          h("button.icon-btn", { type: "button", "aria-label": o.is_active ? "إيقاف" : "تشغيل", onclick: async () => { await api.owner("upsert", { table: "offers", row: { id: o.id, branch_id: br.id, kind: o.kind, is_active: !o.is_active } }); offers(); } }, icon(o.is_active ? "toggle-right" : "toggle-left")),
          h("button.icon-btn", { type: "button", "aria-label": "تعديل", onclick: () => offerSheet(o) }, icon("pencil")),
          h("button.icon-btn", { type: "button", "aria-label": "حذف", onclick: async () => { if (await confirmSheet("حذف العرض؟", o.title, "احذف", "إلغاء", true)) { await api.owner("delete", { table: "offers", id: o.id }); offers(); } } }, icon("trash"))))) : h("p.muted", "ما فيه عروض بعد"),
        h("button.btn.btn-block", { type: "button", "data-testid": "add-offer", onclick: () => offerSheet() }, icon("plus"), "عرض جديد")));
    } else parts.push(locked("timed_offers"));

    if (has("loyalty")) {
      const goal = h("input", { id: "loyalty-goal", type: "number", min: 2, max: 50, value: br.settings.loyalty_goal });
      const reward = h("input", { id: "loyalty-reward", maxlength: 80, value: br.settings.loyalty_reward_text });
      parts.push(card("مرّيت علينا (الولاء)", "gift", field("عدد الزيارات للمكافأة", goal), field("المكافأة", reward),
        h("button.btn.btn-primary", { type: "button", onclick: async () => {
          try { await api.owner("settings_update", { branch_id: br.id, settings: { loyalty_goal: +goal.value, loyalty_reward_text: reward.value.trim() } }); toast("تم الحفظ"); await refreshOverview(); }
          catch (e) { toast(errorText(e), { error: true }); }
        } }, "احفظ")));
    } else parts.push(locked("loyalty"));

    const d = await api.owner("dashboard", { branch_id: br.id, range: "7d" });
    parts.push(card("آخر الاستخدامات (٧ أيام)", "receipt-2", d.redemptions.length ? h("div.list", d.redemptions.map((r) => h("div.list-item", h("span.grow", r.title),
      h("span.muted.small", `${date(r.redeemed_at)} ${time(r.redeemed_at)}`)))) : h("p.muted", "ما فيه استخدامات بعد")));
    fill(root, planBadge(), ...parts);
  }

  // ---------------- «تحدّياتي» ----------------
  async function questsSection() {
    if (!has("quests")) return locked("quests", "تحدّياتي: صمّم تحدّي لعملائك");
    const [{ quests, interests_7d }, sug] = await Promise.all([api.owner("quests", { branch_id: br.id }), api.owner("suggest_quests", { branch_id: br.id }).catch(() => ({ suggestions: [] }))]);
    return h("section.stack", { "data-testid": "owner-quests", style: { gap: "14px" } },
      h("div.wait-head", h("h2", "تحدّياتي"), h("span.muted", "أنت اللي تصمم التحدّي، ودوري يحسب الزيارات تلقائياً")),
      h("div.banner.ok", icon("gift"), h("span", "زبونك يشوف وهو ينتظر أقوى ٤ مفاجآت منك: الجوائز الجاهزة أولاً، ثم النادرة، ثم العروض")),
      h("div.grid2", stat("مشتركين", num(quests.reduce((a, q) => a + q.participants, 0))), stat("طلبات «أبيها» ٧ أيام", num(interests_7d))),
      sug.suggestions.length ? card("اقتراحات من أرقامك", "bulb", h("div.list", sug.suggestions.map((x) => h("div.list-item",
        h("div.grow", h("div.title", x.title, " · ", h("span", { style: { color: "var(--accent)" } }, x.reward_text)), h("div.muted.small", x.why)),
        x.locked ? h("span.badge.warn", "المتكاملة") : h("button.btn", { type: "button", "data-testid": "use-suggestion", onclick: () => questBuilder(x) }, "صمّمه"))))) : null,
      h("button.btn.btn-primary.btn-block", { type: "button", "data-testid": "new-quest", onclick: () => questBuilder() }, icon("plus"), "تحدّي جديد"),
      quests.length ? card("التحديات", "flag-3", h("div.list", quests.map((q) => h("div.list-item",
        h("div.grow", h("div.title", q.title, q.rarity === "rare" ? h("span.badge.warn", { style: { marginInlineStart: "6px" } }, "نادر") : null, !q.open ? h("span.badge.danger", { style: { marginInlineStart: "6px" } }, "منتهي") : null),
          h("div.muted.small", `${QKIND[q.kind]} · ${q.reward_text} · ${num(q.participants)} مشترك · ${num(q.completed)} أنجزوا · ${num(q.redeemed)} استخدموا`)),
        h("button.icon-btn", { type: "button", "aria-label": q.is_active ? "إيقاف" : "تشغيل", onclick: async () => { await api.owner("upsert", { table: "quests", row: { id: q.id, branch_id: br.id, kind: q.kind, is_active: !q.is_active } }); offers(); } }, icon(q.is_active ? "toggle-right" : "toggle-left")),
        h("button.icon-btn", { type: "button", "aria-label": "حذف", onclick: async () => { if (await confirmSheet("حذف التحدّي؟", q.title, "احذف", "إلغاء", true)) { await api.owner("delete", { table: "quests", id: q.id }); offers(); } } }, icon("trash")))))) : null);
  }

  /** Four steps like a quest editor, with the customer's card previewed live under the form. */
  async function questBuilder(seed = {}) {
    const [{ rows: svcs }, { rows: provs }] = await Promise.all([api.owner("list", { table: "services", branch_id: br.id }), api.owner("list", { table: "providers", branch_id: br.id })]);
    const smart = has("smart_quests");
    const d = { kind: "visits", title: "", description: "", service_id: null, provider_id: null, required_visits: 3, reward_text: "خصم ١٥٪", rarity: "common",
      max_participants: null, weekdays: [0, 1, 2, 3, 4, 5, 6], time_start: null, time_end: null, duration_days: 7, ...seed };
    const preview = h("div", { "data-testid": "quest-preview" });
    const draw = () => fill(preview, QuestCard({ ...d, title: d.title || "اسم التحدّي", id: "preview", participants: 0,
      spots_left: d.rarity === "rare" ? d.max_participants : null, ends_at: new Date(Date.now() + d.duration_days * 86400000).toISOString(),
      service: svcs.find((x) => x.id === d.service_id)?.name ?? null, provider: provs.find((x) => x.id === d.provider_id)?.display_name ?? null,
      mine: { visits: Math.max(0, d.required_visits - 1), completed: false, redeemed: false } }, { preview: true }));
    const on = (k, f = (v) => v) => (e) => { d[k] = f(e.target.value); draw(); };
    const step = (n, label, ...body) => h("div.field", h("span", h("span.badge", { style: { marginInlineEnd: "6px" } }, num(n)), label), ...body);
    const count = h("output.big-num", { style: { fontSize: "1.8rem", minWidth: "2ch", textAlign: "center" } }, num(d.required_visits));
    const setCount = (v) => { d.required_visits = Math.max(1, Math.min(20, v)); count.textContent = num(d.required_visits); draw(); };
    const chipRow = (vals, key, fmt) => h("div.chips", vals.map((v) => h("button.chip", { type: "button", "aria-pressed": String(d[key] === v), onclick: (e) => {
      d[key] = v; e.currentTarget.parentElement.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget))); draw();
      if (key === "reward_text") reward.value = v;
    } }, fmt(v))));
    const reward = h("input", { id: "quest-reward", maxlength: 40, value: d.reward_text, oninput: on("reward_text") });
    const title = h("input", { id: "quest-title", maxlength: 80, value: d.title, placeholder: "مثلاً: قهوة الأسبوع", oninput: on("title") });
    const desc = h("input", { id: "quest-desc", maxlength: 200, value: d.description, placeholder: "سطر قصير يشرح التحدّي", oninput: on("description") });
    const kindSel = h("select", { id: "quest-kind", onchange: (e) => { d.kind = e.target.value; quietRow.hidden = d.kind !== "quiet"; provRow.hidden = d.kind !== "provider"; draw(); } },
      Object.entries(QKIND).map(([k, v]) => h("option", { value: k, selected: k === d.kind, disabled: k !== "visits" && !smart }, k !== "visits" && !smart ? `${v} (المتكاملة)` : v)));
    const tStart = h("input", { type: "time", value: d.time_start?.slice(0, 5) ?? "15:00", oninput: on("time_start") });
    const tEnd = h("input", { type: "time", value: d.time_end?.slice(0, 5) ?? "17:00", oninput: on("time_end") });
    const quietRow = h("div.grid2", { hidden: d.kind !== "quiet" }, h("label.field", h("span", "من"), tStart), h("label.field", h("span", "إلى"), tEnd));
    const provRow = h("label.field", { hidden: d.kind !== "provider" }, h("span", "مقدّم الخدمة"), h("select", { onchange: on("provider_id", (v) => v || null) },
      h("option", { value: "" }, "اختر"), provs.map((p) => h("option", { value: p.id, selected: p.id === d.provider_id }, p.display_name))));
    const rare = h("input", { type: "checkbox", checked: d.rarity === "rare", onchange: (e) => { d.rarity = e.target.checked ? "rare" : "common"; spots.disabled = !e.target.checked; d.max_participants = e.target.checked ? +spots.value || 20 : null; draw(); } });
    const spots = h("input", { type: "number", min: 1, max: 1000, value: d.max_participants ?? 20, disabled: d.rarity !== "rare", style: { maxWidth: "6em" }, oninput: (e) => { d.max_participants = +e.target.value || null; draw(); } });
    const err = h("p.err", { hidden: true });
    draw();
    await openSheet({ title: seed.title ? "صمّم التحدّي" : "تحدّي جديد", body: [
      step(1, "الخدمة", h("select", { id: "quest-service", onchange: on("service_id", (v) => v || null) }, h("option", { value: "" }, "أي خدمة"),
        svcs.filter((x) => x.is_active).map((x) => h("option", { value: x.id, selected: x.id === d.service_id }, x.name)))),
      step(2, "كم مرة يزور؟", h("div.row", { style: { gap: "16px" } },
        h("button.icon-btn", { type: "button", "aria-label": "−", style: { border: "1.5px solid var(--line)" }, onclick: () => setCount(d.required_visits - 1) }, icon("minus")), count,
        h("button.icon-btn", { type: "button", "aria-label": "+", style: { border: "1.5px solid var(--line)" }, onclick: () => setCount(d.required_visits + 1) }, icon("plus")))),
      step(3, "مدة التحدّي", chipRow([3, 7, 14, 30], "duration_days", (v) => `${num(v)} أيام`)),
      step(4, "الجائزة", chipRow(["خصم ١٠٪", "خصم ١٥٪", "خصم ٢٠٪", "الزيارة علينا"], "reward_text", (v) => v), reward),
      h("label.field", h("span", "اسم التحدّي"), title), h("label.field", h("span", "الوصف"), desc),
      h("label.field", h("span", "نوع التحدّي"), kindSel), quietRow, provRow,
      h("div.row", h("label.check", rare, h("span", "نادر بعدد محدود")), spots),
      h("div.field", h("span", "هكذا يشوفه الزبون وهو ينتظر"), preview), err],
      actions: [{ id: "quest-save", label: "انشر التحدّي", primary: true, onClick: async (close) => {
        if (d.title.trim().length < 2) { err.hidden = false; err.textContent = "اكتب اسم التحدّي"; return; }
        if (!d.reward_text.trim()) { err.hidden = false; err.textContent = "اكتب الجائزة"; return; }
        if (d.kind === "provider" && !d.provider_id) { err.hidden = false; err.textContent = "اختر مقدّم الخدمة"; return; }
        const now = new Date();
        try {
          await api.owner("upsert", { table: "quests", row: { branch_id: br.id, kind: d.kind, title: d.title.trim(), description: d.description.trim() || null,
            service_id: d.service_id, provider_id: d.kind === "provider" ? d.provider_id : null, required_visits: d.required_visits, reward_text: d.reward_text.trim(),
            rarity: d.rarity, max_participants: d.rarity === "rare" ? d.max_participants : null, weekdays: d.weekdays,
            time_start: d.kind === "quiet" ? d.time_start ?? "15:00" : null, time_end: d.kind === "quiet" ? d.time_end ?? "17:00" : null,
            starts_at: now.toISOString(), ends_at: new Date(now.getTime() + d.duration_days * 86400000).toISOString(), is_active: true } });
          close(); toast("نشرنا التحدّي، بيشوفه زبائنك وهم ينتظرون"); offers();
        } catch (e) { err.hidden = false; err.textContent = errorText(e); }
      } }, { label: "إلغاء", ghost: true }] });
  }

  async function offerSheet(o = {}) {
    const title = h("input", { id: "offer-title", maxlength: 80, value: o.title ?? "" });
    const terms = h("input", { id: "offer-terms", maxlength: 300, value: o.terms ?? "" });
    const disc = h("input", { id: "offer-discount", maxlength: 40, value: o.discount_text ?? "", placeholder: "١٠٪" });
    const days = new Set(o.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
    const dayChips = h("div.chips", WEEKDAYS.ar.map((n, i) => h("button.chip", { type: "button", "aria-pressed": String(days.has(i)), onclick: (e) => { days.has(i) ? days.delete(i) : days.add(i); e.currentTarget.setAttribute("aria-pressed", String(days.has(i))); } }, n)));
    const start = h("input", { id: "offer-start", type: "time", value: o.start_time?.slice(0, 5) ?? "" });
    const end = h("input", { id: "offer-end", type: "time", value: o.end_time?.slice(0, 5) ?? "" });
    const from = h("input", { type: "date", value: o.valid_from ?? "" });
    const to = h("input", { type: "date", value: o.valid_to ?? "" });
    const err = h("p.err", { hidden: true });
    await openSheet({ title: o.id ? "تعديل العرض" : "عرض جديد", body: [field("العنوان", title), field("الشروط", terms), field("الخصم", disc), h("div.field", h("span", "الأيام"), dayChips),
      h("div.grid2", field("من الساعة", start), field("إلى الساعة", end)), h("div.grid2", field("يبدأ", from), field("ينتهي", to)), h("p.muted.small", "اترك الساعات فاضية ليكون العرض طول اليوم."), err],
      actions: [{ id: "offer-save", label: "احفظ", primary: true, onClick: async (close) => {
        if (title.value.trim().length < 2) { err.hidden = false; err.textContent = "اكتب عنوان العرض"; return; }
        if (!days.size) { err.hidden = false; err.textContent = "اختر يوماً واحداً على الأقل"; return; }
        try {
          await api.owner("upsert", { table: "offers", row: { id: o.id, branch_id: br.id, kind: o.kind ?? "timed", title: title.value.trim(), terms: terms.value.trim() || null, discount_text: disc.value.trim() || null,
            weekdays: [...days].sort(), start_time: start.value || null, end_time: end.value || null, valid_from: from.value || null, valid_to: to.value || null, is_active: o.is_active ?? true } });
          close(); toast("تم الحفظ"); offers();
        } catch (e) { err.hidden = false; err.textContent = errorText(e); }
      } }, { label: "إلغاء", ghost: true }] });
  }

  // ---------------- نبضي ----------------
  async function pulse() {
    let range = store.get("dawri.owner.range", "7d");
    const body = h("div.stack", { style: { gap: "16px" } });
    const seg = h("div.seg", { role: "group", "aria-label": "المدة" }, [["today", "اليوم"], ["7d", "٧ أيام"], ["30d", "٣٠ يوم"]].map(([k, label]) =>
      h("button", { type: "button", "aria-pressed": String(k === range), "data-range": k, onclick: () => { range = k; store.set("dawri.owner.range", k); seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === k))); draw(); } }, label)));
    fill(root, planBadge(), seg, body);
    async function draw() {
      fill(body, ...skeleton(2));
      const d = await api.owner("dashboard", { branch_id: br.id, range });
      const dayLabels = (arr) => arr.map((x) => num(x.day.slice(8)));
      fill(body, 
        h("div.grid2", stat("خدمت", num(d.served)), stat("متوسط الانتظار", d.avg_wait_min != null ? `${num(d.avg_wait_min)} د` : "—"),
          stat("راضون", d.satisfaction_pct != null ? `${num(d.satisfaction_pct)}٪` : "—"), stat("انضموا", num(d.joined))),
        card("الوصول حسب الساعة", "clock-hour-4", BarChart(d.arrivals_by_hour, { labels: d.arrivals_by_hour.map((_, i) => num(i)), title: "الوصول حسب الساعة" })),
        d.wait_trend.length > 1 ? card("متوسط الانتظار", "hourglass", LineChart(d.wait_trend.map((x) => x.avg_wait_min), { labels: dayLabels(d.wait_trend), title: "متوسط الانتظار بالدقائق" })) : null,
        d.lost ? h("section.card", { "data-testid": "pulse-lost" }, h("div.card-head", icon("user-minus"), h("h3", "الزبائن الضائعين")),
          h("div.row.between", h("span.big-num", `${num(d.lost.count)}`), h("span", { style: { color: "var(--danger)", fontWeight: 700 } }, `≈ ${num(d.lost.sar)} ريال`)),
          h("p.muted.small", `من خرج قبل خدمته أو لم يحضر × متوسط الفاتورة (${num(d.lost.avg_ticket_value_sar)} ريال)`),
          d.lost_trend.length > 1 ? LineChart(d.lost_trend.map((x) => x.count), { labels: dayLabels(d.lost_trend), title: "الزبائن الضائعين" }) : null) : locked("lost_customers"),
        d.heatmap ? card("تقرير الذروة", "flame",
          d.busiest ? h("p.small", `أزحم وقت: ${WEEKDAYS.ar[d.busiest.weekday]} ${hourLabel(d.busiest.hour)}`) : null,
          d.quiet_windows?.length ? h("p.small", `أهدأ وقت: ${d.quiet_windows.map((w) => `${WEEKDAYS.ar[w.weekday]} ${hourLabel(w.start_hour)}`).join("، ")}`) : null,
          Heatmap(d.heatmap.arrivals, d.heatmap.open, { title: "الزحمة حسب اليوم والساعة" }), h("div.legend", h("span", "كل ما غمق اللون زادت الزحمة"))) : locked("peak_report"),
        d.provider_times ? card("أداء كل موظف", "armchair", d.provider_times.length ? h("div.list", d.provider_times.map((p) => h("div.list-item", h("span.grow", p.name),
          h("span.small", `${num(p.served)} زبون · ${num(p.avg_service_min)} د للزبون`)))) : h("p.muted", "ما فيه بيانات بعد")) : null,
        d.negative_feedback ? card("الشكاوى (تصلك سراً)", "message-report", d.negative_feedback.length ? h("div.list", d.negative_feedback.map((x) => h("div.list-item",
          h("div.grow", h("div.title", REASON_AR[x.reason] ?? "شي ثاني"), x.note ? h("div.muted.small", x.note) : null), h("span.muted.small", date(x.created_at))))) : h("p.muted", "ما فيه شكاوى، ممتاز")) : locked("feedback", "التقييم بالأسباب"),
        d.absent ? card("الغايبون", "user-question", h("p.muted.small", "زباين وافقوا على التواصل وما زاروك من ٣٠ يوم. اتصل فيهم بنفسك."),
          d.absent.length ? h("div.list", { "data-testid": "absent-list" }, d.absent.map((c) => h("div.list-item",
            h("div.grow", h("div.num", { dir: "ltr", style: { textAlign: "right" } }, c.phone), h("div.muted.small", `${num(c.visits)} زيارات · آخر زيارة قبل ${num(c.days_since)} يوم`)),
            h("a.btn", { href: `tel:${c.phone}` }, icon("phone"), "اتصال")))) : h("p.muted", "ما فيه غايبين")) : locked("absent_customers"),
      );
    }
    await draw();
  }

  // ---------------- الإعدادات ----------------
  async function settings() {
    const parts = [planBadge()];
    if (branches.length > 1) {
      const sel = h("select", { onchange: (e) => { store.set("dawri.owner.branch", e.target.value); ctx.rerender(); } }, branches.map((x) => h("option", { value: x.id, selected: x.id === br.id }, `${x.business.name} · ${x.name}`)));
      parts.push(card("الفرع", "map-pin", sel));
    }
    parts.push(await pageEditor(), await menuEditor(), await newsEditor(), await servicesEditor(), rulesEditor(), await devicesEditor(),
      card("التنبيهات", "bell", h("p.muted.small", "إنذار الزحمة وملخص المساء يوصلونك على هذا الجوال."), h("button.btn.btn-block", { type: "button", onclick: enableOwnerPush }, icon("bell"), "فعّل تنبيهاتي")),
      card("المظهر", "contrast", h("div.seg", { role: "group" }, [[null, "تلقائي"], ["light", "فاتح"], ["dark", "داكن"]].map(([v, label]) =>
        h("button", { type: "button", "aria-pressed": String(currentTheme() === v), "data-theme-choice": v ?? "auto", onclick: (e) => { setTheme(v); e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget))); } }, label)))),
      card("ملصق QR للطباعة", "printer", h("p.muted.small", "ملصق باسم المحل ورمز يفتح صفحتك."), h("a.btn.btn-block", { href: "./owner/poster" }, "افتح الملصق")),
      planCard(),
      h("button.btn.btn-ghost.btn-block", { type: "button", onclick: async () => { await api.auth.signOut(); nav("./"); } }, icon("logout"), "تسجيل خروج"));
    fill(root, ...parts.filter(Boolean));
    if (location.hash === "#devices") document.getElementById("devices")?.scrollIntoView({ block: "start" });
  }

  function planCard() {
    const all = Object.keys(FEATURE_AR);
    return card(`الباقة: ${PLAN_AR[bz.effective_plan ?? bz.plan] ?? "موقوفة"}`, "crown",
      bz.trial_days_left > 0 ? h("p.small", `أنت في التجربة المجانية (كل الميزات) لمدة ${num(bz.trial_days_left)} يوم.`) : null,
      h("div.list", { "data-testid": "features-list" }, all.map((x) => h("div.list-item", { style: { minHeight: "40px", padding: "6px 0" } },
        icon(has(x) ? "circle-check" : "lock"), h("span.grow", FEATURE_AR[x]),
        has(x) ? null : h("span.badge.warn", `متاحة في باقة ${PLAN_AR[MIN_PLAN(x)]}`)))));
  }

  async function pageEditor() {
    const page = has("full_page") ? (await api.owner("list", { table: "business_pages", branch_id: br.id })).rows[0] ?? {} : null;
    const phone = h("input", { id: "page-phone", type: "tel", dir: "ltr", value: br.phone ?? "" });
    const mapUrl = h("input", { id: "page-map", type: "url", dir: "ltr", value: br.map_url ?? "" });
    const review = h("input", { id: "page-review", type: "url", dir: "ltr", value: br.google_review_url ?? "" });
    const address = h("input", { id: "page-address", value: br.address ?? "" });
    const hours = hoursEditor(br.hours);
    const bio = page ? h("textarea", { id: "page-bio", maxlength: 600 }, page.bio ?? "") : null;
    const highlights = page ? h("input", { id: "page-highlights", value: (page.highlights ?? []).join("، ") }) : null;
    let photos = page?.photos ?? [];
    const photoRow = h("div.photos");
    const drawPhotos = () => fill(photoRow, ...photos.map((p) => h("img", { src: api.photoUrl(p), alt: "" })));
    drawPhotos();
    const upload = page ? h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", onchange: async (e) => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 3 * 1024 * 1024) return toast("الصورة أكبر من ٣ ميغا", { error: true });
      try { photos = [...photos, await api.uploadPhoto(br.id, file)].slice(-6); drawPhotos(); toast("ارفعنا الصورة، اضغط احفظ"); } catch (err) { toast(errorText(err), { error: true }); }
    } }) : null;
    return card("صفحة المحل", "building-store",
      field("العنوان", address), field("رقم الاتصال (زر اتصال فقط)", phone), field("رابط الموقع في الخرائط", mapUrl), field("رابط تقييم قوقل", review, "الراضي يُوجَّه له بعد الخدمة"),
      h("div.field", h("span", "الدوام"), hours.el),
      page ? [field("نبذة", bio), field("مميزات (افصلها بفاصلة)", highlights), h("div.field", h("span", "صور (حتى ٦)"), photoRow, upload)] : locked("full_page", "صفحتي الكاملة: نبذة وصور"),
      h("button.btn.btn-primary", { type: "button", "data-testid": "save-page", onclick: async () => {
        try {
          await api.owner("upsert", { table: "branches", row: { id: br.id, address: address.value.trim() || null, phone: phone.value.trim() || null, map_url: mapUrl.value.trim() || null, google_review_url: review.value.trim() || null, hours: hours.value() } });
          if (page) await api.owner("upsert", { table: "business_pages", row: { branch_id: br.id, bio: bio.value.trim() || null, highlights: highlights.value.split(/[،,]/).map((x) => x.trim()).filter(Boolean), photos, is_published: true } });
          toast("تم الحفظ"); await refreshOverview();
        } catch (e) { toast(errorText(e), { error: true }); }
      } }, "احفظ"));
  }

  function hoursEditor(hours) {
    const rows = KEYS.map((k, i) => {
      const iv = hours?.[k]?.[0];
      const on = h("input", { type: "checkbox", checked: !!iv, "aria-label": `${WEEKDAYS.ar[i]} مفتوح` });
      const o = h("input", { type: "time", value: iv?.[0] ?? "09:00", "aria-label": "يفتح" });
      const c = h("input", { type: "time", value: iv?.[1] ?? "23:00", "aria-label": "يقفل" });
      return { k, on, o, c, el: h("div.row", { style: { flexWrap: "nowrap", gap: "6px" } }, h("label.check", { style: { minWidth: "6.5em" } }, on, h("span", WEEKDAYS.ar[i])), o, c) };
    });
    rows.forEach((r) => [r.o, r.c].forEach((x) => Object.assign(x.style, { minHeight: "40px", padding: "6px", borderRadius: "10px", border: "1.5px solid var(--line)", background: "var(--paper)", minWidth: 0, flex: 1 })));
    return { el: h("div.stack", rows.map((r) => r.el)), value: () => Object.fromEntries(rows.map((r) => [r.k, r.on.checked ? [[r.o.value, r.c.value]] : []])) };
  }

  async function menuEditor() {
    if (!has("menu")) return locked("menu", "قائمتي: الخدمات والأسعار");
    const { rows } = await api.owner("list", { table: "menu_items", branch_id: br.id });
    const photoBtn = has("menu_photo_ai") ? h("label.btn.btn-block", { "data-testid": "menu-photo" }, icon("camera"), "صوّر قائمتك",
      h("input.sr", { type: "file", accept: "image/*", capture: "environment", onchange: (e) => menuFromPhoto(e.target.files[0]) })) : locked("menu_photo_ai");
    return card("قائمتي", "tools-kitchen-2",
      rows.length ? h("div.list", rows.map((m) => h("div.list-item", h("div.grow", h("div", m.name), h("div.muted.small", [m.category, m.price_sar != null ? `${num(+m.price_sar)} ر.س` : null].filter(Boolean).join(" · "))),
        h("button.icon-btn", { type: "button", "aria-label": "تعديل", onclick: () => menuSheet(m) }, icon("pencil")),
        h("button.icon-btn", { type: "button", "aria-label": "حذف", onclick: async () => { await api.owner("delete", { table: "menu_items", id: m.id }); settings(); } }, icon("trash"))))) : h("p.muted", "القائمة فاضية"),
      h("button.btn.btn-block", { type: "button", onclick: () => menuSheet() }, icon("plus"), "صنف جديد"), photoBtn);
  }

  async function menuSheet(m = {}) {
    const name = h("input", { maxlength: 80, value: m.name ?? "" }), cat = h("input", { maxlength: 40, value: m.category ?? "" });
    const price = h("input", { type: "number", min: 0, step: "0.5", value: m.price_sar ?? "" }), err = h("p.err", { hidden: true });
    await openSheet({ title: m.id ? "تعديل صنف" : "صنف جديد", body: [field("الاسم", name), field("القسم", cat), field("السعر (ر.س)", price), err], actions: [{ label: "احفظ", primary: true, onClick: async (close) => {
      if (!name.value.trim()) { err.hidden = false; err.textContent = "اكتب الاسم"; return; }
      try { await api.owner("upsert", { table: "menu_items", row: { id: m.id, branch_id: br.id, name: name.value.trim(), category: cat.value.trim() || null, price_sar: price.value === "" ? null : +price.value } }); close(); settings(); }
      catch (e) { err.hidden = false; err.textContent = errorText(e); }
    } }, { label: "إلغاء", ghost: true }] });
  }

  async function menuFromPhoto(file) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return toast("الصورة أكبر من ٤ ميغا", { error: true });
    toast("نقرأ القائمة…", { ms: 6000 });
    const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.readAsDataURL(file); });
    let items;
    try { items = (await api.ai("menu_from_photo", { branch_id: br.id, image_base64: b64 })).items; } catch (e) { return toast(errorText(e), { error: true }); }
    const rows = items.map((it) => ({ it, name: h("input", { value: it.name, "aria-label": "الاسم" }), price: h("input", { type: "number", min: 0, step: "0.5", value: it.price_sar ?? "", placeholder: "السعر؟", "aria-label": "السعر" }), keep: h("input", { type: "checkbox", checked: true, "aria-label": "احفظ" }) }));
    await openSheet({ title: `لقينا ${num(items.length)} أصناف`, body: [h("p.muted.small", "راجع الأسماء والأسعار قبل الحفظ. السعر الفاضي ما قدرنا نقرأه."),
      h("div.stack", { "data-testid": "ai-rows" }, rows.map((r) => h("div.row", { style: { flexWrap: "nowrap" } }, r.keep, h("label.field", { style: { flex: 2 } }, r.name), h("label.field", { style: { flex: 1 } }, r.price))))],
      actions: [{ label: "احفظ في القائمة", primary: true, onClick: async (close) => {
        const keep = rows.filter((r) => r.keep.checked && r.name.value.trim()).map((r) => ({ category: r.it.category, name: r.name.value.trim(), description: r.it.description, price_sar: r.price.value === "" ? null : +r.price.value, duration_min: r.it.duration_min }));
        if (!keep.length) return close();
        try { await api.owner("menu_bulk", { branch_id: br.id, items: keep }); close(); toast("أضفنا الأصناف"); settings(); } catch (e) { toast(errorText(e), { error: true }); }
      } }, { label: "إلغاء", ghost: true }] });
  }

  async function newsEditor() {
    if (!has("news")) return locked("news");
    const { rows } = await api.owner("list", { table: "news_posts", branch_id: br.id });
    const title = h("input", { maxlength: 80, placeholder: "العنوان" }), body = h("textarea", { maxlength: 1000, placeholder: "التفاصيل" });
    return card("وش الجديد؟", "news",
      rows.length ? h("div.list", rows.map((n) => h("div.list-item", h("div.grow", h("div.title", n.title), h("div.muted.small", date(n.published_at))),
        h("button.icon-btn", { type: "button", "aria-label": "حذف", onclick: async () => { await api.owner("delete", { table: "news_posts", id: n.id }); settings(); } }, icon("trash"))))) : null,
      field("خبر جديد", title), h("label.field", h("span.sr", "التفاصيل"), body),
      h("button.btn", { type: "button", onclick: async () => {
        if (title.value.trim().length < 2) return toast("اكتب عنوان الخبر", { error: true });
        try { await api.owner("upsert", { table: "news_posts", row: { branch_id: br.id, title: title.value.trim(), body: body.value.trim() || null } }); toast("نشرنا الخبر"); settings(); } catch (e) { toast(errorText(e), { error: true }); }
      } }, icon("send"), "انشر"));
  }

  async function servicesEditor() {
    const [{ rows: svcs }, { rows: provs }] = await Promise.all([api.owner("list", { table: "services", branch_id: br.id }), api.owner("list", { table: "providers", branch_id: br.id })]);
    const svcSheet = async (s = {}) => {
      const name = h("input", { maxlength: 60, value: s.name ?? "" }), mins = h("input", { type: "number", min: 1, max: 600, value: s.avg_minutes ?? 15 });
      const mode = h("select", Object.entries(MODE_AR).map(([k, v]) => h("option", { value: k, selected: k === (s.mode ?? "remote") }, v)));
      await openSheet({ title: s.id ? "تعديل خدمة" : "خدمة جديدة", body: [field("الاسم", name), field("وضع العمل", mode), field("متوسط الدقائق", mins)], actions: [{ label: "احفظ", primary: true, onClick: async (close) => {
        if (!name.value.trim()) return toast("اكتب اسم الخدمة", { error: true });
        try { await api.owner("upsert", { table: "services", row: { id: s.id, branch_id: br.id, name: name.value.trim(), mode: mode.value, avg_minutes: +mins.value } }); close(); settings(); } catch (e) { toast(errorText(e), { error: true }); }
      } }, { label: "إلغاء", ghost: true }] });
    };
    const provName = h("input", { maxlength: 40, placeholder: "مثلاً: كرسي ٤ · فهد" });
    return card("الخدمات ومقدّموها", "list-check",
      h("div.list", svcs.map((s) => h("div.list-item", h("div.grow", h("div.title", s.name), h("div.muted.small", `${MODE_AR[s.mode]} · ${num(s.avg_minutes)} د${s.is_active ? "" : " · موقوفة"}`)),
        h("button.icon-btn", { type: "button", "aria-label": s.is_active ? "إيقاف" : "تشغيل", onclick: async () => { await api.owner("upsert", { table: "services", row: { id: s.id, branch_id: br.id, is_active: !s.is_active } }); settings(); } }, icon(s.is_active ? "toggle-right" : "toggle-left")),
        h("button.icon-btn", { type: "button", "aria-label": "تعديل", onclick: () => svcSheet(s) }, icon("pencil"))))),
      h("button.btn.btn-block", { type: "button", onclick: () => svcSheet() }, icon("plus"), "خدمة جديدة"),
      h("div.divider"),
      h("h3", "مقدّمو الخدمة (الكراسي)"),
      has("preferred_provider") ? null : h("p.muted.small", "اختيار الزبون لمقدّم بعينه متاح في باقة النمو؛ الكراسي تُستخدم لتوزيع الطابور في كل الباقات."),
      provs.length ? h("div.list", provs.map((p) => h("div.list-item", h("span.grow", p.display_name),
        h("button.icon-btn", { type: "button", "aria-label": "حذف", onclick: async () => { await api.owner("delete", { table: "providers", id: p.id }); settings(); } }, icon("trash"))))) : null,
      h("div.row", { style: { flexWrap: "nowrap" } }, h("label.field", { style: { flex: 1 } }, h("span.sr", "اسم مقدّم الخدمة"), provName),
        h("button.btn", { type: "button", onclick: async () => {
          if (!provName.value.trim()) return;
          try { await api.owner("upsert", { table: "providers", row: { branch_id: br.id, display_name: provName.value.trim() } }); settings(); } catch (e) { toast(errorText(e), { error: true }); }
        } }, icon("plus"))));
  }

  function rulesEditor() {
    const s = br.settings;
    const inputs = {
      return_now_threshold: ["«ارجع الآن» قبل كم دور", 1, 10], remote_join_limit: ["حد الحجز من برّا في نفس الوقت", 1, 100],
      remote_close_minutes_before_closing: ["يقفل الحجز من برّا قبل الإغلاق بـ (دقيقة)", 0, 240], avg_ticket_value_sar: ["متوسط الفاتورة (ريال)", 1, 10000],
      busy_alert_threshold: ["إنذار الزحمة عند (زبون)", 2, 200], snooze_max: ["حد «تأخرت شوي» لكل تذكرة", 0, 5],
    };
    const els = Object.fromEntries(Object.entries(inputs).map(([k, [, min, max]]) => [k, h("input", { type: "number", min, max, value: s[k], id: `rule-${k}` })]));
    const summary = h("input", { type: "time", value: s.summary_time, id: "rule-summary_time" });
    return card("قواعد الطابور", "adjustments",
      ...Object.entries(inputs).map(([k, [label]]) => field(label, els[k])), field("وقت ملخص المساء", summary),
      h("button.btn.btn-primary", { type: "button", onclick: async () => {
        const settings = Object.fromEntries(Object.entries(els).map(([k, el]) => [k, Number(el.value)]));
        settings.summary_time = summary.value || "22:00";
        try { await api.owner("settings_update", { branch_id: br.id, settings }); toast("تم الحفظ"); await refreshOverview(); } catch (e) { toast(errorText(e), { error: true }); }
      } }, "احفظ"));
  }

  async function devicesEditor() {
    const [{ devices }, { rows: provs }] = await Promise.all([api.owner("devices", { branch_id: br.id }), api.owner("list", { table: "providers", branch_id: br.id })]);
    const label = h("input", { id: "device-label", maxlength: 40, placeholder: "مثلاً: كرسي ٢" });
    const language = h("select", { id: "device-lang" }, Object.entries(LANGS).map(([k, v]) => h("option", { value: k }, v)));
    const prov = provs.length ? h("select", { id: "device-provider" }, h("option", { value: "" }, "بدون (كل الطابور)"), provs.map((p) => h("option", { value: p.id }, p.display_name))) : null;
    return h("section.card", { id: "devices" }, h("div.card-head", icon("device-mobile"), h("h3", "أجهزة الموظفين")),
      devices.length ? h("div.list", devices.map((d) => h("div.list-item", h("div.grow", h("div.title", d.label), h("div.muted.small", [LANGS[d.language], d.revoked_at ? "ملغي" : d.last_seen_at ? `آخر ظهور ${time(d.last_seen_at)}` : "ما اتصل بعد"].join(" · "))),
        d.revoked_at ? null : h("button.btn.btn-danger", { type: "button", onclick: async () => { if (await confirmSheet("إلغاء ربط الجهاز؟", d.label, "ألغِ الربط", "تراجع", true)) { await api.owner("revoke_device", { device_id: d.id }); settings(); } } }, "إلغاء")))) : null,
      field("اسم الجهاز", label), field("لغة الشاشة", language), prov ? field("مقدّم الخدمة", prov) : null,
      h("button.btn.btn-primary", { type: "button", "data-testid": "create-device", onclick: async () => {
        if (!label.value.trim()) return toast("اكتب اسم الجهاز", { error: true });
        try {
          const r = await api.owner("create_staff_device", { branch_id: br.id, label: label.value.trim(), language: language.value, provider_id: prov?.value || null });
          await openSheet({ title: "امسح من جوال الموظف", body: [h("p.muted.small.center", "يظهر الرابط مرة وحدة فقط. امسحه من جوال الموظف أو انسخه."), QR(r.pairing_url, { label: "رابط الربط" }),
            h("p.small.center", { dir: "ltr", style: { wordBreak: "break-all" }, "data-testid": "pairing-url" }, r.pairing_url)],
            actions: [{ label: "انسخ الرابط", onClick: async () => { try { await navigator.clipboard.writeText(r.pairing_url); toast("تم النسخ"); } catch { toast("انسخه يدوياً من فوق"); } } }, { label: "تمام", primary: true }] });
          settings();
        } catch (e) { toast(errorText(e), { error: true }); }
      } }, icon("qrcode"), "اربط جهاز جديد"));
  }
}
