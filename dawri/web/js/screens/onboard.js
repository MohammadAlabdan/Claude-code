// Self-setup wizard /start: one question per screen, ~10 minutes, ends with shop link, poster and staff pairing QR.
import { h, icon, store, fill } from "../ui/dom.js";
import { num, errorText, WEEKDAYS } from "../i18n.js";
import { toast } from "../ui/toast.js";
import { QR } from "../ui/qr.js";
import { requireSession } from "./auth.js";

const ACTIVITIES = [
  ["barber", "حلاق", "scissors", "remote"], ["salon", "صالون", "brush", "remote"], ["clinic", "عيادة", "stethoscope", "remote"], ["lab", "مختبر", "flask", "remote"],
  ["cafe", "مقهى", "coffee", "receipt"], ["restaurant", "مطعم سريع", "burger", "receipt"], ["bakery", "مخبز", "bread", "receipt"],
  ["carwash", "مغسلة سيارات", "car", "dropoff"], ["phone_repair", "صيانة جوالات", "device-mobile-cog", "dropoff"], ["other", "غير ذلك", "dots", "remote"],
];
const SUGGESTED = {
  barber: [["حلاقة شعر", 20], ["حلاقة ذقن", 10], ["شعر وذقن", 30]], salon: [["قص شعر", 30], ["صبغة", 60], ["سشوار", 25]],
  clinic: [["كشف عام", 15], ["مراجعة", 10]], lab: [["سحب دم", 10], ["استلام نتائج", 5]], cafe: [["طلبات المقهى", 7]], restaurant: [["الطلبات", 10]],
  bakery: [["الطلبات", 5]], carwash: [["غسيل خارجي", 25], ["غسيل داخلي وخارجي", 45]], phone_repair: [["تغيير شاشة", 60], ["تغيير بطارية", 30]], other: [["الخدمة", 15]],
};
const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const LANGS = [["ar", "العربية"], ["en", "English"], ["ur", "اردو"], ["bn", "বাংলা"], ["fil", "Filipino"]];

export async function render(ctx) {
  const { api, shell } = ctx;
  await requireSession(ctx, { title: "ركّب دوري لمحلك", lead: "أنشئ حساباً بالبريد، وخلال ١٠ دقائق يكون عندك ملصق QR جاهز. تجربة مجانية ١٤ يوم.", signupFirst: true, redirect: "/start" });
  shell.setTitle("تهيئة المحل");
  const data = store.get("dawri.onboard.draft") ?? { category: null, business_name: "", district: "", services: [], open: "09:00", close: "23:00", days: [0, 1, 2, 3, 4, 6], staff_language: "ar" };
  const save = () => store.set("dawri.onboard.draft", data);
  let step = 0;
  const steps = [activity, name, services, hours, language, finish];

  function frame(title, lead, body, { next = "التالي", onNext, back = true } = {}) {
    const err = h("p.err", { hidden: true, role: "alert" });
    fill(shell.content, 
      h("div.dots", { "aria-label": `الخطوة ${step + 1} من ${steps.length - 1}` }, steps.slice(0, -1).map((_, i) => h(`span${i === step ? ".on" : ""}`))),
      h("section.card", h("h2", title), lead ? h("p.muted", lead) : null, body, err),
      h("div.grid2",
        back && step > 0 ? h("button.btn", { type: "button", onclick: () => { step--; steps[step](); } }, "رجوع") : h("span"),
        h("button.btn.btn-primary", { type: "button", "data-testid": "wizard-next", onclick: async () => {
          const problem = await onNext?.();
          if (problem) { err.hidden = false; err.textContent = problem; return; }
          save(); step++; steps[step]();
        } }, next)));
  }

  function activity() {
    const grid = h("div.grid2", ACTIVITIES.map(([k, label, ic]) => h("button.chip", { type: "button", "aria-pressed": String(data.category === k), "data-category": k, style: { minHeight: "64px", borderRadius: "16px", display: "flex", gap: "8px", justifyContent: "center", alignItems: "center" },
      onclick: (e) => { data.category = k; grid.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget))); } }, icon(ic), label)));
    frame("وش نوع نشاطك؟", "نختار لك وضع العمل المناسب، وتقدر تغيّره بعدين.", grid, { onNext: () => (data.category ? null : "اختر نوع النشاط") });
  }

  function name() {
    const n = h("input", { id: "ob-name", maxlength: 80, value: data.business_name, placeholder: "مثلاً: حلاق الأصيل" });
    const d = h("input", { id: "ob-district", maxlength: 100, value: data.district, placeholder: "مثلاً: حي الملقا، الرياض" });
    frame("اسم المحل والحي", null, h("div.stack", h("label.field", h("span", "اسم المحل"), n), h("label.field", h("span", "الحي والمدينة"), d)),
      { onNext: () => { data.business_name = n.value.trim(); data.district = d.value.trim(); return data.business_name.length < 2 ? "اكتب اسم المحل" : null; } });
  }

  function services() {
    const mode = ACTIVITIES.find((a) => a[0] === data.category)?.[3] ?? "remote";
    if (!data.services.length || data.services[0].mode !== mode) data.services = (SUGGESTED[data.category] ?? SUGGESTED.other).map(([n, m]) => ({ name: n, avg_minutes: m, mode }));
    const list = h("div.stack");
    const draw = () => fill(list, ...data.services.map((s, i) => h("div.row", { style: { flexWrap: "nowrap" } },
      h("label.field", { style: { flex: 2 } }, h("span.sr", "اسم الخدمة"), h("input", { value: s.name, maxlength: 60, oninput: (e) => (s.name = e.target.value) })),
      h("label.field", { style: { flex: 1 } }, h("span.sr", "الدقائق"), h("input", { type: "number", min: 1, max: 600, value: s.avg_minutes, oninput: (e) => (s.avg_minutes = +e.target.value) })),
      h("button.icon-btn", { type: "button", "aria-label": "حذف", onclick: () => { data.services.splice(i, 1); draw(); } }, icon("trash")))));
    draw();
    frame("الخدمات", { remote: "وضع العمل: احجز دورك من برّا. اكتب كل خدمة ومتوسط دقائقها.", receipt: "وضع العمل: ادفع وانتظر. الزبون يكتب رقم طلبه من الفاتورة.", dropoff: "وضع العمل: سلّم وارجع. تسجّل السيارة أو الجهاز ويتابع الزبون من جواله." }[mode],
      h("div.stack", h("div.row.muted.small", h("span", { style: { flex: 2 } }, "الخدمة"), h("span", { style: { flex: 1 } }, "دقائق"), h("span", { style: { width: "48px" } })), list,
        h("button.btn", { type: "button", onclick: () => { data.services.push({ name: "", avg_minutes: 15, mode }); draw(); } }, icon("plus"), "خدمة أخرى")),
      { onNext: () => { data.services = data.services.filter((s) => s.name.trim()); return data.services.length ? null : "أضف خدمة واحدة على الأقل"; } });
  }

  function hours() {
    const o = h("input", { id: "ob-open", type: "time", value: data.open }), c = h("input", { id: "ob-close", type: "time", value: data.close });
    const days = new Set(data.days);
    const chips = h("div.chips", WEEKDAYS.ar.map((n, i) => h("button.chip", { type: "button", "aria-pressed": String(days.has(i)), onclick: (e) => { days.has(i) ? days.delete(i) : days.add(i); e.currentTarget.setAttribute("aria-pressed", String(days.has(i))); } }, n)));
    frame("الدوام", "إذا يقفل بعد منتصف الليل اكتب وقت الإغلاق عادي (مثلاً ٠١:٠٠).", h("div.stack", h("div.field", h("span", "أيام العمل"), chips), h("div.grid2", h("label.field", h("span", "يفتح"), o), h("label.field", h("span", "يقفل"), c))),
      { onNext: () => { data.open = o.value; data.close = c.value; data.days = [...days]; return days.size ? null : "اختر يوماً واحداً على الأقل"; } });
  }

  function language() {
    const chips = h("div.chips", LANGS.map(([k, v]) => h("button.chip", { type: "button", "aria-pressed": String(data.staff_language === k), onclick: (e) => { data.staff_language = k; chips.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", String(x === e.currentTarget))); } }, v)));
    frame("لغة شاشة الموظف", "الموظف يشوف الشاشة بلغته، والزبون يشوف العربية.", chips, { next: "جهّز محلي", onNext: async () => {
      try {
        const r = await api.onboard({ business_name: data.business_name, category: data.category, district: data.district, staff_language: data.staff_language,
          services: data.services.map((s) => ({ name: s.name.trim(), mode: s.mode, avg_minutes: s.avg_minutes || 15 })),
          hours: Object.fromEntries(KEYS.map((k, i) => [k, data.days.includes(i) ? [[data.open, data.close]] : []])) });
        data.result = r;
        return null;
      } catch (e) { return errorText(e); }
    } });
  }

  function finish() {
    const r = data.result;
    store.del("dawri.onboard.draft");
    store.set("dawri.owner.branch", r.branch_id);
    toast("جاهز!");
    fill(shell.content, 
      h("section.card.center", { style: { justifyItems: "center" }, "data-testid": "onboard-done" }, icon("circle-check"), h("h2", "محلك جاهز على دوري"),
        h("p.badge.warn", `تجربة مجانية ${num(14)} يوم`), h("p.hand", "مبروك، أول زبون على الطريق")),
      h("section.card", h("div.card-head", icon("link"), h("h3", "رابط صفحة المحل")), h("p.small", { dir: "ltr", style: { wordBreak: "break-all" } }, r.shop_url),
        h("div.grid2", h("a.btn", { href: `./s/${r.public_id}` }, "افتح الصفحة"), h("a.btn", { href: "./owner/poster" }, icon("printer"), "ملصق QR"))),
      h("section.card", h("div.card-head", icon("device-mobile"), h("h3", "اربط جوال الموظف")), h("p.muted.small", "امسح هذا الرمز من جوال الموظف، ويفتح شاشة النداء مباشرة. يظهر مرة وحدة."),
        QR(r.pairing_url, { label: "رابط ربط الموظف" }), h("p.small", { dir: "ltr", style: { wordBreak: "break-all" } }, r.pairing_url)),
      h("a.btn.btn-primary.btn-block", { href: "./owner" }, "ادخل لوحة المحل"));
  }

  steps[0]();
}
