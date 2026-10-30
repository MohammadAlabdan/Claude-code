// Demo mode: an in-browser implementation of API_CONTRACT.md, seeded with three demo shops.
// State lives in localStorage and changes are shared across tabs (BroadcastChannel), so the
// customer page in one tab and the staff screen in another behave like the real thing.
// Timers advance the queue so every screen has something happening (turn off: localStorage dawri.demo.auto = false).
import { ApiError } from "./errors.js";
import { store } from "./ui/dom.js";

const KEY = "dawri.demo.v1";
const PASSWORD = "Dawri-Demo-2026";
const DAY_MS = 86400000;

// ---------- time (Asia/Riyadh, UTC+3, no DST) ----------
const riyadh = (d = new Date()) => new Date(d.getTime() + 3 * 3600000);
const dayOf = (d = new Date()) => riyadh(d).toISOString().slice(0, 10);
const hourOf = (d = new Date()) => riyadh(d).getUTCHours();
const dowOf = (d = new Date()) => riyadh(d).getUTCDay();
const minutesOfDay = (d = new Date()) => riyadh(d).getUTCHours() * 60 + riyadh(d).getUTCMinutes();
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"[b % 64]).join("");
const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// ---------- plans ----------
const BASIC = ["queue", "fadeet", "return_now", "card", "evening_summary", "late_button", "family_ticket", "priority", "lost_customers", "staff_language"];
const GROWTH = [...BASIC, "menu", "menu_photo_ai", "timed_offers", "loyalty", "feedback", "preferred_provider", "best_time", "busy_alert"];
const FULL = [...GROWTH, "full_page", "news", "qa_assistant", "quiet_coupon", "peak_report", "absent_customers"];
const PLANS = { basic: BASIC, seasonal: BASIC, growth: GROWTH, full: FULL };
const minPlan = (f) => (BASIC.includes(f) ? "basic" : GROWTH.includes(f) ? "growth" : "full");
const DEFAULTS = { return_now_threshold: 2, remote_join_limit: 5, remote_close_minutes_before_closing: 30, avg_ticket_value_sar: 50,
  busy_alert_threshold: 10, snooze_max: 2, no_show_push_back: 2, staff_languages: ["ar"], summary_time: "22:00",
  show_arabic_digits: true, loyalty_goal: 6, loyalty_reward_text: "الزيارة السادسة علينا" };

// ---------- seed ----------
const ALL_DAY = Object.fromEntries(KEYS.map((k) => [k, [["00:00", "00:00"]]]));
const DEMO_HOURS = { rukn: ALL_DAY, aseel: ALL_DAY, lamaa: ALL_DAY };

function seed() {
  const now = Date.now(), today = dayOf();
  const db = {
    version: 1, seededAt: now, counters: {}, ready: [], redemptions: [], feedback: [], summaries: [], status: {}, pushSubs: [],
    users: [
      { id: "u-admin", email: "admin@demo.dawri.app" }, { id: "u-cafe", email: "cafe@demo.dawri.app" },
      { id: "u-barber", email: "barber@demo.dawri.app" }, { id: "u-wash", email: "wash@demo.dawri.app" }],
    admins: ["u-admin"],
    businesses: [
      { id: "biz-rukn", name: "مقهى الركن", slug: "alrukn-cafe", category: "cafe", plan: "growth", plan_until: iso(now + 365 * DAY_MS), trial_until: null, owner: "u-cafe", is_active: true, is_demo: true, created_at: iso(now - 90 * DAY_MS) },
      { id: "biz-aseel", name: "حلاق الأصيل", slug: "alaseel-barber", category: "barber", plan: "full", plan_until: iso(now + 365 * DAY_MS), trial_until: null, owner: "u-barber", is_active: true, is_demo: true, created_at: iso(now - 80 * DAY_MS) },
      { id: "biz-lamaa", name: "مغسلة اللمعة", slug: "allamaa-wash", category: "carwash", plan: "basic", plan_until: iso(now + 365 * DAY_MS), trial_until: null, owner: "u-wash", is_active: true, is_demo: true, created_at: iso(now - 60 * DAY_MS) }],
    branches: [
      { id: "br-rukn", business_id: "biz-rukn", name: "مقهى الركن · الياسمين", public_id: "rukn2026", address: "حي الياسمين، الرياض", map_url: "https://maps.google.com/?q=Al+Yasmin+Riyadh", phone: "0112345671", google_review_url: "https://g.page/r/demo-alrukn/review", hours: DEMO_HOURS.rukn, settings: { avg_ticket_value_sar: 28 }, secret: "demo-secret-rukn" },
      { id: "br-aseel", business_id: "biz-aseel", name: "حلاق الأصيل · الملقا", public_id: "aseel2026", address: "حي الملقا، الرياض", map_url: "https://maps.google.com/?q=Al+Malqa+Riyadh", phone: "0112345672", google_review_url: "https://g.page/r/demo-alaseel/review", hours: DEMO_HOURS.aseel, settings: { avg_ticket_value_sar: 50, staff_languages: ["ar", "ur", "en"] }, secret: "demo-secret-aseel" },
      { id: "br-lamaa", business_id: "biz-lamaa", name: "مغسلة اللمعة · النرجس", public_id: "lamaa2026", address: "حي النرجس، الرياض", map_url: "https://maps.google.com/?q=Al+Narjis+Riyadh", phone: "0112345673", google_review_url: null, hours: DEMO_HOURS.lamaa, settings: { avg_ticket_value_sar: 45, staff_languages: ["ar", "bn", "fil"] }, secret: "demo-secret-lamaa" }],
    services: [
      { id: "svc-rukn", branch_id: "br-rukn", name: "طلبات المقهى", mode: "receipt", avg_minutes: 7, is_active: true, sort: 0 },
      { id: "svc-hair", branch_id: "br-aseel", name: "حلاقة شعر", mode: "remote", avg_minutes: 20, is_active: true, sort: 0 },
      { id: "svc-beard", branch_id: "br-aseel", name: "حلاقة ذقن", mode: "remote", avg_minutes: 10, is_active: true, sort: 1 },
      { id: "svc-both", branch_id: "br-aseel", name: "شعر وذقن", mode: "remote", avg_minutes: 30, is_active: true, sort: 2 },
      { id: "svc-ext", branch_id: "br-lamaa", name: "غسيل خارجي", mode: "dropoff", avg_minutes: 25, is_active: true, sort: 0 },
      { id: "svc-full", branch_id: "br-lamaa", name: "غسيل داخلي وخارجي", mode: "dropoff", avg_minutes: 45, is_active: true, sort: 1 }],
    providers: [
      { id: "pr-1", branch_id: "br-aseel", display_name: "كرسي ١ · أبو سعد", service_ids: null, is_active: true, created_at: iso(now - 50 * DAY_MS) },
      { id: "pr-2", branch_id: "br-aseel", display_name: "كرسي ٢ · ماجد", service_ids: null, is_active: true, created_at: iso(now - 50 * DAY_MS) },
      { id: "pr-3", branch_id: "br-aseel", display_name: "كرسي ٣ · سلطان", service_ids: null, is_active: true, created_at: iso(now - 50 * DAY_MS) }],
    devices: [
      { id: "dev-rukn", branch_id: "br-rukn", label: "شاشة المطبخ", language: "ar", provider_id: null, token: "demo-staff-rukn-kitchen-000000000000", revoked_at: null, last_seen_at: null, created_at: iso(now - 30 * DAY_MS) },
      { id: "dev-aseel1", branch_id: "br-aseel", label: "كرسي ١", language: "ar", provider_id: "pr-1", token: "demo-staff-aseel-chair1-000000000000", revoked_at: null, last_seen_at: null, created_at: iso(now - 30 * DAY_MS) },
      { id: "dev-aseel2", branch_id: "br-aseel", label: "كرسي ٢", language: "ur", provider_id: "pr-2", token: "demo-staff-aseel-chair2-000000000000", revoked_at: null, last_seen_at: null, created_at: iso(now - 30 * DAY_MS) },
      { id: "dev-lamaa", branch_id: "br-lamaa", label: "استقبال المغسلة", language: "bn", provider_id: null, token: "demo-staff-lamaa-front-0000000000000", revoked_at: null, last_seen_at: null, created_at: iso(now - 30 * DAY_MS) }],
    pages: {
      "br-rukn": { bio: "قهوة مختصة وحلا طازج كل يوم، على زاوية شارع الياسمين.", photos: [], highlights: ["قهوة مختصة", "جلسات خارجية"], is_published: true },
      "br-aseel": { bio: "حلاق رجالي من ٢٠١٢. ثلاثة كراسي، وأدوات معقمة لكل زبون.", photos: [], highlights: ["أدوات معقمة", "حلاقة أطفال", "مواقف قريبة"], is_published: true },
      "br-lamaa": { bio: "غسيل يدوي بمواد آمنة على الطلاء، وتسليم في نفس اليوم.", photos: [], highlights: ["غسيل يدوي", "تلميع"], is_published: true } },
    menu: [
      ["br-rukn", "قهوة", "قهوة اليوم", "محصول إثيوبي، تقطير", 14], ["br-rukn", "قهوة", "لاتيه", null, 18], ["br-rukn", "قهوة", "سبانش لاتيه", null, 20],
      ["br-rukn", "حلا", "كيكة تمر", "بصوص التوفي", 16], ["br-rukn", "حلا", "كوكيز", null, 9],
      ["br-aseel", "حلاقة", "حلاقة شعر", null, 40, 20], ["br-aseel", "حلاقة", "حلاقة ذقن", null, 25, 10], ["br-aseel", "حلاقة", "شعر وذقن", null, 60, 30], ["br-aseel", "عناية", "تنظيف بشرة", null, 50, 25],
    ].map(([branch_id, category, name, description, price_sar, duration_min], i) => ({ id: `m-${i}`, branch_id, category, name, description, price_sar, duration_min: duration_min ?? null, is_available: true, sort: i, service_id: null })),
    offers: [
      { id: "of-1", branch_id: "br-rukn", kind: "timed", title: "قهوة الصباح", terms: "قهوة اليوم مع أي حلا قبل ١٠ الصباح", discount_text: "١٠ ر.س", weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "06:00", end_time: "10:00", valid_from: null, valid_to: null, max_redemptions: null, is_active: true, created_at: iso(now - 20 * DAY_MS) },
      { id: "of-2", branch_id: "br-rukn", kind: "timed", title: "حلا اليوم", terms: "الحلا الثاني بنصف السعر", discount_text: "٥٠٪", weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: null, end_time: null, valid_from: null, valid_to: null, max_redemptions: null, is_active: true, created_at: iso(now - 20 * DAY_MS) },
      { id: "of-3", branch_id: "br-aseel", kind: "quiet_coupon", title: "كوبون الهدوء", terms: "خصم على الحلاقة وقت العصر", discount_text: "٢٠٪", weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: "15:00", end_time: "17:00", valid_from: null, valid_to: null, max_redemptions: null, is_active: true, created_at: iso(now - 10 * DAY_MS) },
      { id: "of-4", branch_id: "br-aseel", kind: "timed", title: "حلاقة الأطفال", terms: "حلاقة طفل مع كل حلاقة شعر", discount_text: "١٥ ر.س", weekdays: [0, 1, 2, 3, 4, 5, 6], start_time: null, end_time: null, valid_from: null, valid_to: null, max_redemptions: null, is_active: true, created_at: iso(now - 10 * DAY_MS) }],
    news: [
      { id: "n-1", branch_id: "br-aseel", title: "وصلنا كرسي ثالث", body: "صار عندنا ثلاثة كراسي، والانتظار أقصر.", published_at: iso(now - 6 * DAY_MS) },
      { id: "n-2", branch_id: "br-aseel", title: "دوام العيد", body: "نفتح من ٢ الظهر إلى ٣ الفجر أيام العيد.", published_at: iso(now - 2 * DAY_MS) }],
    loyalty: [
      ["br-aseel", "0551234501", 3, 0, 2], ["br-aseel", "0551234502", 7, 1, 5], ["br-aseel", "0551234503", 4, 0, 41],
      ["br-aseel", "0551234504", 2, 0, 55], ["br-aseel", "0551234505", 9, 1, 34], ["br-rukn", "0551234506", 5, 0, 1],
    ].map(([branch_id, phone, visits, rewards_redeemed, ago], i) => ({ id: `l-${i}`, branch_id, phone, visits, goal: 6, rewards_redeemed, last_visit_at: iso(now - ago * DAY_MS) })),
    history: {},
    tickets: [],
  };

  // 28 days of history per branch: busy evenings, quiet 3–5 pm, fewer on Sunday.
  for (const b of db.branches) {
    db.history[b.id] = [];
    for (let d = 28; d >= 1; d--) {
      const day = dayOf(new Date(now - d * DAY_MS)), dow = new Date(day + "T12:00:00Z").getUTCDay();
      const arrivals = Array.from({ length: 24 }, (_, h) => (h < 9 ? 0 : h === 15 || h === 16 ? (dow === 0 ? 0 : 1) : h >= 19 && h <= 22 ? 5 : 2) - (dow === 0 && h >= 9 && !(h === 15 || h === 16) ? 1 : 0));
      const total = arrivals.reduce((a, c) => a + c, 0), lost = Math.round(total / 15) + (d % 3);
      db.history[b.id].push({ day, arrivals, served: total - lost, wait_sum: (total - lost) * (7 + (d % 5)), wait_n: total - lost, lost, pos: Math.round(total / 3) - 1, neg: 1,
        prov: b.id === "br-aseel" ? { "pr-1": [12 + (d % 3), 20.5], "pr-2": [13, 19.7], "pr-3": [11 + (d % 2), 19.7] } : {} });
    }
    db.feedback.push(...[3, 9, 17].map((d, i) => ({ id: uid(), ticket_id: null, branch_id: b.id, positive: false, reason: ["long_wait", "quality", "price"][i],
      note: i === 0 ? "الانتظار طال أكثر من المتوقع" : null, created_at: iso(now - d * DAY_MS), ticket_number: 10 + i })));
    db.summaries.push({ branch_id: b.id, day: dayOf(new Date(now - DAY_MS)), text: "ملخص اليوم: ٣٧ زبون، انتظار ٨ د، ٩٤٪ راضون. اقتراح: الأحد ٣ العصر–٥ هادئ، جرّب كوبون الهدوء.", stats: {} });
  }

  // Today: barber with a live line, café orders, cars at each stage.
  const add = (b, svc, extra) => {
    const n = (db.counters[`${b}|${today}`] = (db.counters[`${b}|${today}`] ?? 0) + 1);
    const joined = now - (extra.ago ?? 0) * 60000;
    db.tickets.push({ id: uid(), branch_id: b, service_id: svc, provider_id: null, mode: "remote", day: today, number: n, receipt_code: null, item_label: null,
      party_size: 1, source: "remote", status: "waiting", stage: null, priority: false, priority_reason: null, snooze_count: 0, push_back_count: 0,
      push_enabled: false, return_now_sent: false, sort_key: joined, token: null, claim: null, phone: null, consent: false, loyalty_counted: false, lang: "ar",
      called_by: null, joined_at: iso(joined), called_at: null, served_at: null, done_at: null, left_at: null, ...extra });
  };
  const ago = (m) => iso(now - m * 60000);
  add("br-aseel", "svc-hair", { ago: 140, provider_id: "pr-1", status: "done", called_at: ago(128), served_at: ago(127), done_at: ago(107) });
  add("br-aseel", "svc-both", { ago: 125, provider_id: "pr-2", source: "walk_in", status: "done", called_at: ago(113), served_at: ago(112), done_at: ago(82) });
  add("br-aseel", "svc-beard", { ago: 100, provider_id: "pr-3", status: "done", called_at: ago(88), served_at: ago(87), done_at: ago(77) });
  add("br-aseel", "svc-hair", { ago: 90, status: "left", left_at: ago(70) });
  add("br-aseel", "svc-hair", { ago: 60, provider_id: "pr-1", party_size: 2, status: "serving", called_at: ago(48), served_at: ago(47), called_by: "dev-aseel1" });
  add("br-aseel", "svc-beard", { ago: 55, status: "no_show", called_at: ago(43), left_at: ago(40) });
  add("br-aseel", "svc-hair", { ago: 40, push_enabled: true });
  add("br-aseel", "svc-hair", { ago: 30, provider_id: "pr-2", source: "walk_in", priority: true, priority_reason: "elderly" });
  add("br-aseel", "svc-both", { ago: 22, party_size: 3, push_enabled: true });
  for (const [code, st, m] of [["41", "done", 30], ["42", "done", 24], ["44", "done", 15], ["45", "waiting", 6], ["47", "waiting", 3]]) {
    add("br-rukn", "svc-rukn", { ago: m, mode: "receipt", source: "receipt", receipt_code: code, status: st, done_at: st === "done" ? ago(m - 6) : null, called_at: st === "done" ? ago(m - 6) : null });
  }
  db.ready.push(...[["41", 24], ["42", 18], ["43", 12], ["44", 9]].map(([code, m]) => ({ branch_id: "br-rukn", day: today, code, ready_at: ago(m) })));
  for (const [svc, label, st, stage, m] of [["svc-ext", "كامري بيضاء · أ ب ج ١٢٣٤", "done", "picked_up", 120], ["svc-full", "يوكن سوداء · ر س ع ٥٦٧٨", "called", "ready", 70],
    ["svc-ext", "أكسنت فضية · ك ل م ٩٠١٢", "serving", "in_progress", 35], ["svc-full", "لاندكروزر · ط ي ن ٣٤٥٦", "waiting", "received", 10]]) {
    add("br-lamaa", svc, { ago: m, mode: "dropoff", source: "staff", item_label: label, status: st, stage, called_at: stage === "ready" ? ago(m - 30) : null, served_at: stage !== "received" ? ago(m - 5) : null, done_at: st === "done" ? ago(m - 40) : null });
  }
  return db;
}

// ---------- persistence and change events ----------
let db = load();
function load() {
  const d = store.get(KEY);
  if (d?.version === 1 && dayOf(new Date(d.seededAt)) === dayOf()) return d;
  const fresh = seed();
  store.set(KEY, fresh);
  return fresh;
}
const channel = "BroadcastChannel" in window ? new BroadcastChannel("dawri-demo") : null;
const listeners = new Map(); // public_id → Set(cb)
channel?.addEventListener("message", (e) => { db = store.get(KEY) ?? db; fire(e.data.public_id); });
function fire(publicId) { for (const id of publicId === "*" ? listeners.keys() : [publicId]) listeners.get(id)?.forEach((cb) => cb()); }
function commit(publicIds) {
  store.set(KEY, db);
  for (const id of [publicIds].flat().filter(Boolean)) { channel?.postMessage({ public_id: id }); fire(id); }
}
const fresh = () => { db = store.get(KEY) ?? db; };

// ---------- lookups ----------
const branch = (id) => db.branches.find((b) => b.id === id);
const branchByPublic = (pid) => db.branches.find((b) => b.public_id === String(pid ?? "").toLowerCase());
const biz = (b) => db.businesses.find((x) => x.id === b.business_id);
const settings = (b) => ({ ...DEFAULTS, ...b.settings });
function effectivePlan(z) {
  if (!z.is_active) return null;
  if (z.trial_until && Date.parse(z.trial_until) > Date.now()) return "full";
  if (z.plan_until && Date.parse(z.plan_until) <= Date.now()) return null;
  return z.plan;
}
const features = (b) => PLANS[effectivePlan(biz(b))] ?? [];
const has = (b, f) => features(b).includes(f);
const lock = (f) => new ApiError("feature_locked", { feature: f, required_plan: minPlan(f) });
const need = (b, f) => { if (!has(b, f)) throw lock(f); };
const fail = (code, extra) => { throw new ApiError(code, extra); };

function openState(b, at = new Date()) {
  const r = riyadh(at), base = Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate()) - 3 * 3600000;
  const intervals = [];
  for (let d = -1; d <= 7; d++) {
    const dayStart = base + d * DAY_MS, key = KEYS[new Date(dayStart + 3 * 3600000).getUTCDay()];
    for (const [o, c] of b.hours[key] ?? []) {
      const [oh, om] = o.split(":").map(Number), [ch, cm] = c.split(":").map(Number);
      const open = dayStart + (oh * 60 + om) * 60000;
      let close = dayStart + (ch * 60 + cm) * 60000;
      if (close <= open) close += DAY_MS;
      intervals.push([open, close]);
    }
  }
  const t = at.getTime(), cur = intervals.filter(([o, c]) => t >= o && t < c);
  const closes = cur.length ? Math.max(...cur.map((x) => x[1])) : null;
  const next = intervals.filter(([o]) => o > t).map((x) => x[0]).sort((a, b) => a - b)[0];
  return { open: !!cur.length, closes_at: closes ? iso(closes) : null, next_open_at: next ? iso(next) : null };
}

// ---------- queue maths (same rules as the SQL) ----------
const before = (o, t) => (o.priority && !t.priority) || (o.priority === t.priority && (o.sort_key < t.sort_key || (o.sort_key === t.sort_key && o.number < t.number)));
const ahead = (t) => t.status !== "waiting" ? [] : db.tickets.filter((o) => o.service_id === t.service_id && o.status === "waiting" && o.id !== t.id
  && (!t.provider_id || !o.provider_id || o.provider_id === t.provider_id) && before(o, t));
const position = (t) => ahead(t).length;
function serviceMinutes(serviceId, providerId) {
  const d = db.tickets.filter((x) => x.service_id === serviceId && x.status === "done" && x.served_at && x.done_at && (!providerId || x.provider_id === providerId))
    .map((x) => (Date.parse(x.done_at) - Date.parse(x.served_at)) / 60000).filter((m) => m > 0).slice(-30).sort((a, b) => a - b);
  if (d.length >= 3) return Math.max(1, Math.min(600, d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2));
  return db.services.find((s) => s.id === serviceId)?.avg_minutes ?? 15;
}
const providerCount = (s) => Math.max(1, db.providers.filter((p) => p.branch_id === s.branch_id && p.is_active && (!p.service_ids || p.service_ids.includes(s.id))).length);
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);
function estimate(t) {
  const s = db.services.find((x) => x.id === t.service_id);
  const parties = ahead(t).reduce((a, o) => a + o.party_size, 0);
  return round5(parties * serviceMinutes(t.service_id, t.provider_id) / (t.provider_id ? 1 : providerCount(s)));
}
const waitingCount = (bid) => db.tickets.filter((t) => t.branch_id === bid && t.status === "waiting" && t.mode !== "dropoff").length;
function busyLevel(b) {
  const st = db.status[b.id];
  if (st?.manual && Date.now() - Date.parse(st.at) < 30 * 60000) return st.manual;
  const n = waitingCount(b.id);
  return n <= 2 ? "free" : n <= 6 ? "some" : "busy";
}
const nowServing = (sid) => Math.max(0, ...db.tickets.filter((t) => t.service_id === sid && t.day === dayOf() && ["called", "serving"].includes(t.status)).map((t) => t.number)) || null;

function activeOffers(b, at = new Date()) {
  const dow = dowOf(at), hm = `${String(hourOf(at)).padStart(2, "0")}:${String(riyadh(at).getUTCMinutes()).padStart(2, "0")}`, day = dayOf(at);
  return db.offers.filter((o) => o.branch_id === b.id && o.is_active && has(b, o.kind === "quiet_coupon" ? "quiet_coupon" : "timed_offers")
    && o.weekdays.includes(dow) && (!o.valid_from || o.valid_from <= day) && (!o.valid_to || o.valid_to >= day)
    && (!o.start_time || hm >= o.start_time.slice(0, 5)) && (!o.end_time || hm < o.end_time.slice(0, 5))
    && (!o.max_redemptions || db.redemptions.filter((r) => r.offer_id === o.id).length < o.max_redemptions))
    .map(({ id, kind, title, terms, discount_text, start_time, end_time }) => ({ id, kind, title, terms, discount_text, start_time, end_time }));
}
function loyaltyView(b, phone) {
  const c = db.loyalty.find((l) => l.branch_id === b.id && l.phone === phone);
  if (!c) return null;
  const v = c.visits - c.rewards_redeemed * c.goal;
  return { visits: v, goal: c.goal, reward_available: v >= c.goal, reward_text: settings(b).loyalty_reward_text };
}
function ticketView(t) {
  const b = branch(t.branch_id), s = db.services.find((x) => x.id === t.service_id), p = db.providers.find((x) => x.id === t.provider_id);
  const waitingRemote = t.mode === "remote" && t.status === "waiting", pos = waitingRemote ? position(t) : null;
  const fb = db.feedback.find((f) => f.ticket_id === t.id);
  return {
    id: t.id, number: t.number, mode: t.mode, status: t.status, stage: t.stage, receipt_code: t.receipt_code, item_label: t.item_label,
    party_size: t.party_size, service: { id: s.id, name: s.name }, provider: p ? { id: p.id, name: p.display_name } : null,
    position: pos, estimate_min: waitingRemote ? estimate(t) : null, return_now: waitingRemote && pos <= settings(b).return_now_threshold,
    called: t.mode === "remote" && ["called", "serving"].includes(t.status),
    ready: (t.mode === "receipt" && t.status === "done") || (t.mode === "dropoff" && t.stage === "ready"),
    now_serving: nowServing(t.service_id), waiting_in_service: db.tickets.filter((x) => x.service_id === t.service_id && x.status === "waiting").length,
    snooze_left: Math.max(0, settings(b).snooze_max - t.snooze_count), push_enabled: t.push_enabled, has_phone: !!t.phone, lang: t.lang,
    joined_at: t.joined_at, called_at: t.called_at, done_at: t.done_at, feedback: fb ? { positive: fb.positive } : null,
    loyalty: t.phone && has(b, "loyalty") ? loyaltyView(b, t.phone) : null,
    offers: ["waiting", "called", "serving", "done"].includes(t.status) ? activeOffers(b) : [], features: features(b),
    branch: { public_id: b.public_id, name: b.name, business_name: biz(b).name, phone: b.phone, show_arabic_digits: settings(b).show_arabic_digits },
  };
}
function newTicket(b, s, extra) {
  const today = dayOf(), n = (db.counters[`${b.id}|${today}`] = (db.counters[`${b.id}|${today}`] ?? 0) + 1), now = Date.now();
  const t = { id: uid(), branch_id: b.id, service_id: s.id, provider_id: null, mode: s.mode, day: today, number: n, receipt_code: null, item_label: null, party_size: 1,
    source: "remote", status: "waiting", stage: null, priority: false, priority_reason: null, snooze_count: 0, push_back_count: 0, push_enabled: false,
    return_now_sent: false, sort_key: now, token: null, claim: null, phone: null, consent: false, loyalty_counted: false, lang: "ar", called_by: null,
    joined_at: iso(now), called_at: null, served_at: null, done_at: null, left_at: null, ...extra };
  db.tickets.push(t);
  return t;
}
function moveBack(t, steps) {
  const behind = db.tickets.filter((o) => o.service_id === t.service_id && o.status === "waiting" && o.id !== t.id && !o.priority
    && (t.status !== "waiting" || t.priority || before(t, o))).sort((a, b) => (before(a, b) ? -1 : 1)).map((o) => o.sort_key);
  if (behind.length) t.sort_key = behind.length <= steps ? behind[behind.length - 1] + 1 : (behind[steps - 1] + behind[steps]) / 2;
  Object.assign(t, { priority: false, status: "waiting", called_at: null, return_now_sent: false });
}
function applyLoyalty(t) {
  const b = branch(t.branch_id);
  if (t.status !== "done" || !t.consent || !t.phone || t.loyalty_counted || !has(b, "loyalty")) return;
  const c = db.loyalty.find((l) => l.branch_id === b.id && l.phone === t.phone);
  if (c) { c.visits++; c.last_visit_at = iso(); } else db.loyalty.push({ id: uid(), branch_id: b.id, phone: t.phone, visits: 1, goal: settings(b).loyalty_goal, rewards_redeemed: 0, last_visit_at: iso() });
  t.loyalty_counted = true;
}
function finish(t) {
  if (["done", "cancelled", "left", "no_show"].includes(t.status)) return;
  Object.assign(t, { status: "done", done_at: iso(), served_at: t.served_at ?? t.called_at ?? iso(), called_at: t.called_at ?? iso(), stage: t.mode === "dropoff" ? "picked_up" : t.stage });
  applyLoyalty(t);
}
const byToken = (tok) => db.tickets.find((t) => t.token && t.token === tok) ?? fail("ticket_not_found");

async function rotatingCode(secret, minute) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(String(minute))));
  let r = 0;
  for (const x of mac) r = (r * 256 + x) % 10000;
  return String(r).padStart(4, "0");
}

// ---------- analytics ----------
function arrivalsMatrix(b) {
  const m = Array.from({ length: 7 }, () => Array(24).fill(0)), cnt = Array(7).fill(0);
  for (const h of db.history[b.id] ?? []) {
    const dow = new Date(h.day + "T12:00:00Z").getUTCDay();
    cnt[dow]++;
    h.arrivals.forEach((v, i) => (m[dow][i] += v));
  }
  return m.map((row, d) => row.map((v) => Math.round((v / Math.max(1, cnt[d])) * 10) / 10));
}
function openMatrix(b) {
  return KEYS.map((k, d) => Array.from({ length: 24 }, (_, hr) => {
    const mid = hr * 60 + 30;
    const inDay = (b.hours[k] ?? []).some(([o, c]) => { const [oh, om] = o.split(":").map(Number), [ch, cm] = c.split(":").map(Number); const os = oh * 60 + om, cs = ch * 60 + cm; return cs > os ? mid >= os && mid < cs : mid >= os; });
    const prev = (b.hours[KEYS[(d + 6) % 7]] ?? []).some(([o, c]) => { const [oh, om] = o.split(":").map(Number), [ch, cm] = c.split(":").map(Number); return ch * 60 + cm <= oh * 60 + om && mid < ch * 60 + cm; });
    return inDay || prev;
  }));
}
function quietWindows(arrivals, open, limit = 2) {
  const all = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 23; h++) {
    if (!open[d][h] || !open[d][h + 1]) continue;
    // skip the empty small hours: only hours with some traffic in the week count
    if (arrivals.every((row) => row[h] === 0)) continue;
    all.push({ weekday: d, start_hour: h, avg_arrivals: Math.round(((arrivals[d][h] + arrivals[d][h + 1]) / 2) * 10) / 10 });
  }
  all.sort((a, b) => a.avg_arrivals - b.avg_arrivals || a.weekday - b.weekday || a.start_hour - b.start_hour);
  const out = [], days = new Set();
  for (const w of all) { if (days.has(w.weekday)) continue; out.push(w); days.add(w.weekday); if (out.length === limit) break; }
  return out;
}
function busiest(arrivals) {
  let best = null;
  arrivals.forEach((row, d) => row.forEach((v, h) => { if (!best || v > best.avg_arrivals) best = { weekday: d, hour: h, avg_arrivals: v }; }));
  return best;
}
const isLost = (t) => t.status === "no_show" || (t.status === "left" && Date.parse(t.left_at) - Date.parse(t.joined_at) >= 5 * 60000);

function dashboard(b, range) {
  const f = features(b), days = range === "30d" ? 30 : range === "7d" ? 7 : 1, today = dayOf();
  const from = dayOf(new Date(Date.now() - (days - 1) * DAY_MS));
  const hist = (db.history[b.id] ?? []).filter((h) => h.day >= from);
  const todays = db.tickets.filter((t) => t.branch_id === b.id && t.day === today);
  const tWait = todays.filter((t) => t.mode === "remote" && t.called_at).map((t) => (Date.parse(t.called_at) - Date.parse(t.joined_at)) / 60000);
  const todayRow = { day: today, arrivals: Array.from({ length: 24 }, (_, h) => todays.filter((t) => hourOf(new Date(t.joined_at)) === h).length),
    served: todays.filter((t) => t.status === "done").length, wait_sum: tWait.reduce((a, c) => a + c, 0), wait_n: tWait.length, lost: todays.filter(isLost).length,
    pos: db.feedback.filter((x) => x.branch_id === b.id && x.positive && dayOf(new Date(x.created_at)) === today).length,
    neg: db.feedback.filter((x) => x.branch_id === b.id && !x.positive && dayOf(new Date(x.created_at)) === today).length, prov: {} };
  const rows = [...hist, todayRow], sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const lostCount = sum("lost"), avgVal = settings(b).avg_ticket_value_sar;
  const arr = arrivalsMatrix(b), open = openMatrix(b), peak = f.includes("peak_report");
  const prov = {};
  for (const r of rows) for (const [pid, [n, m]] of Object.entries(r.prov)) { prov[pid] ??= [0, 0]; prov[pid][0] += n; prov[pid][1] += n * m; }
  return {
    range, from, to: today, features: f,
    served: sum("served"), joined: rows.reduce((a, r) => a + r.arrivals.reduce((x, y) => x + y, 0), 0),
    avg_wait_min: sum("wait_n") ? Math.round(sum("wait_sum") / sum("wait_n")) : null,
    satisfaction_pct: sum("pos") + sum("neg") ? Math.round((100 * sum("pos")) / (sum("pos") + sum("neg"))) : null,
    lost: f.includes("lost_customers") ? { count: lostCount, sar: lostCount * avgVal, avg_ticket_value_sar: avgVal } : null,
    lost_trend: f.includes("lost_customers") ? rows.map((r) => ({ day: r.day, count: r.lost })) : null,
    arrivals_by_hour: Array.from({ length: 24 }, (_, h) => rows.reduce((a, r) => a + r.arrivals[h], 0)),
    wait_trend: rows.map((r) => ({ day: r.day, avg_wait_min: r.wait_n ? Math.round(r.wait_sum / r.wait_n) : null })),
    heatmap: peak ? { arrivals: arr, open } : null,
    provider_times: peak ? Object.entries(prov).map(([pid, [n, m]]) => ({ provider_id: pid, name: db.providers.find((p) => p.id === pid)?.display_name ?? "", served: n, avg_service_min: Math.round((m / Math.max(1, n)) * 10) / 10 })) : null,
    negative_feedback: f.includes("feedback") ? db.feedback.filter((x) => x.branch_id === b.id && !x.positive && dayOf(new Date(x.created_at)) >= from).map(({ id, reason, note, created_at, ticket_number }) => ({ id, reason, note, created_at, ticket_number })) : null,
    absent: f.includes("absent_customers") ? db.loyalty.filter((c) => c.branch_id === b.id && c.visits >= 2 && Date.now() - Date.parse(c.last_visit_at) >= 30 * DAY_MS && Date.now() - Date.parse(c.last_visit_at) <= 90 * DAY_MS)
      .map((c) => ({ phone: c.phone, visits: c.visits, last_visit_at: c.last_visit_at, days_since: Math.round((Date.now() - Date.parse(c.last_visit_at)) / DAY_MS) })) : null,
    redemptions: db.redemptions.filter((r) => r.branch_id === b.id && dayOf(new Date(r.redeemed_at)) >= from).slice(-30).reverse()
      .map((r) => ({ id: r.id, redeemed_at: r.redeemed_at, kind: r.loyalty_card_id ? "loyalty" : "offer", title: db.offers.find((o) => o.id === r.offer_id)?.title ?? settings(b).loyalty_reward_text })),
    live: { waiting: waitingCount(b.id), busy_level: busyLevel(b), busy_alert: { armed: true, last_alert_at: null } },
    latest_summary: db.summaries.filter((s) => s.branch_id === b.id).slice(-1)[0] ?? null,
    quiet_windows: peak ? quietWindows(arr, open) : null, busiest: peak ? busiest(arr) : null,
  };
}

// ---------- customer ----------
const customer = {
  ticket: ({ token: tok }) => ticketView(byToken(tok)),
  join({ public_id, service_id, provider_id, party_size = 1, lang }) {
    const b = branchByPublic(public_id) ?? fail("branch_not_found");
    need(b, "queue");
    const s = db.services.find((x) => x.id === service_id && x.branch_id === b.id && x.is_active && x.mode === "remote") ?? fail("invalid_service");
    if (party_size < 1 || party_size > 6) fail("invalid_party_size");
    if (party_size > 1) need(b, "family_ticket");
    if (provider_id) { need(b, "preferred_provider"); db.providers.find((p) => p.id === provider_id && p.branch_id === b.id) ?? fail("invalid_provider"); }
    const st = openState(b);
    if (!st.open) fail("closed", { next_open_at: st.next_open_at, busy_level: busyLevel(b) });
    if (st.closes_at && Date.parse(st.closes_at) - Date.now() < settings(b).remote_close_minutes_before_closing * 60000) fail("closing_soon", { next_open_at: st.next_open_at, busy_level: busyLevel(b) });
    if (db.tickets.filter((t) => t.branch_id === b.id && t.status === "waiting" && t.source === "remote").length >= settings(b).remote_join_limit) fail("remote_limit", { busy_level: busyLevel(b) });
    const t = newTicket(b, s, { provider_id: provider_id ?? null, party_size, token: token(), lang: lang === "en" ? "en" : "ar" });
    commit(b.public_id);
    return { ticket_token: t.token, ticket: ticketView(t) };
  },
  join_receipt({ public_id, service_id, receipt_code, lang }) {
    const b = branchByPublic(public_id) ?? fail("branch_not_found");
    need(b, "queue");
    const s = db.services.find((x) => x.id === service_id && x.branch_id === b.id && x.mode === "receipt") ?? fail("invalid_service");
    const code = String(receipt_code ?? "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    if (!code || code.length > 12) fail("invalid_receipt_code");
    let t = db.tickets.find((x) => x.branch_id === b.id && x.day === dayOf() && x.service_id === s.id && x.receipt_code === code);
    if (!t) {
      const ready = db.ready.some((r) => r.branch_id === b.id && r.day === dayOf() && r.code === code);
      t = newTicket(b, s, { receipt_code: code, source: "receipt", token: `rc-${b.id}-${dayOf()}-${code}-demo-token`, lang: lang === "en" ? "en" : "ar",
        ...(ready ? { status: "done", called_at: iso(), served_at: iso(), done_at: iso() } : {}) });
      commit(b.public_id);
    }
    return { ticket_token: t.token, ticket: ticketView(t) };
  },
  subscribe_push({ token: tok }) { const t = byToken(tok); t.push_enabled = true; commit(branch(t.branch_id).public_id); return { ok: true, push_enabled: true }; },
  snooze({ token: tok, steps }) {
    const t = byToken(tok), b = branch(t.branch_id);
    need(b, "late_button");
    if (![1, 2].includes(steps)) fail("invalid_steps");
    if (t.mode !== "remote" || t.status !== "waiting") fail("not_waiting");
    if (t.snooze_count >= settings(b).snooze_max) fail("snooze_limit");
    moveBack(t, steps); t.snooze_count++;
    commit(b.public_id);
    return { ok: true, ticket: ticketView(t) };
  },
  leave({ token: tok }) {
    const t = byToken(tok);
    if (!["waiting", "called"].includes(t.status)) fail("not_waiting");
    Object.assign(t, { status: "left", left_at: iso() });
    commit(branch(t.branch_id).public_id);
    return { ok: true, ticket: ticketView(t) };
  },
  feedback({ token: tok, positive, reason, note }) {
    const t = byToken(tok), b = branch(t.branch_id);
    need(b, "feedback");
    if (t.status !== "done") fail("not_done");
    if (db.feedback.some((f) => f.ticket_id === t.id)) fail("feedback_exists");
    db.feedback.push({ id: uid(), ticket_id: t.id, branch_id: b.id, positive, reason: positive ? null : reason ?? null, note: positive ? null : note || null, created_at: iso(), ticket_number: t.number });
    commit(b.public_id);
    return { ok: true, google_review_url: positive ? b.google_review_url : null };
  },
  set_phone({ token: tok, phone, consent }) {
    const t = byToken(tok), b = branch(t.branch_id);
    need(b, "loyalty");
    if (consent !== true) fail("consent_required");
    let p = String(phone ?? "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/\D/g, "");
    if (/^9665\d{8}$/.test(p)) p = "0" + p.slice(3);
    if (!/^05\d{8}$/.test(p)) fail("invalid_phone");
    Object.assign(t, { phone: p, consent: true });
    applyLoyalty(t);
    commit(b.public_id);
    return { ok: true, loyalty: loyaltyView(b, p) };
  },
  async redeem({ token: tok, offer_id, loyalty, code }) {
    const t = byToken(tok), b = branch(t.branch_id), m = Math.floor(Date.now() / 60000);
    if (!/^\d{4}$/.test(code ?? "") || ![await rotatingCode(b.secret, m), await rotatingCode(b.secret, m - 1)].includes(code)) fail("invalid_code");
    if (loyalty) {
      need(b, "loyalty");
      const c = db.loyalty.find((l) => l.branch_id === b.id && l.phone === t.phone);
      if (!c || c.visits - c.rewards_redeemed * c.goal < c.goal) fail("no_reward");
      c.rewards_redeemed++;
      db.redemptions.push({ id: uid(), branch_id: b.id, offer_id: null, loyalty_card_id: c.id, ticket_id: t.id, redeemed_at: iso(), ticket_number: t.number });
      commit(b.public_id);
      return { ok: true, redeemed: "loyalty", title: settings(b).loyalty_reward_text, loyalty: loyaltyView(b, t.phone) };
    }
    const o = db.offers.find((x) => x.id === offer_id && x.branch_id === b.id) ?? fail("offer_not_found");
    need(b, o.kind === "quiet_coupon" ? "quiet_coupon" : "timed_offers");
    if (!activeOffers(b).some((x) => x.id === o.id)) fail("offer_inactive");
    if (db.redemptions.some((r) => r.offer_id === o.id && r.ticket_id === t.id)) fail("already_redeemed");
    db.redemptions.push({ id: uid(), branch_id: b.id, offer_id: o.id, loyalty_card_id: null, ticket_id: t.id, redeemed_at: iso(), ticket_number: t.number });
    commit(b.public_id);
    return { ok: true, redeemed: "offer", title: o.title };
  },
  claim_dropoff({ claim_token }) {
    const t = db.tickets.find((x) => x.claim && x.claim === claim_token) ?? fail("ticket_not_found");
    Object.assign(t, { token: token(), claim: null });
    commit(branch(t.branch_id).public_id);
    return { ticket_token: t.token, ticket: ticketView(t) };
  },
};

// ---------- staff ----------
const deviceByToken = (tok) => db.devices.find((d) => d.token && d.token === tok && !d.revoked_at) ?? fail("device_unpaired");
const LABELS = {
  ar: { waiting: "بالانتظار", called: "تم النداء", serving: "يُخدم الآن", done: "تم", no_show: "لم يحضر", cancelled: "ملغي", left: "خرج", received: "استلمنا", in_progress: "قيد العمل", ready: "جاهزة", picked_up: "تم الاستلام" },
  en: { waiting: "Waiting", called: "Called", serving: "Serving", done: "Done", no_show: "No-show", cancelled: "Cancelled", left: "Left", received: "Received", in_progress: "In progress", ready: "Ready", picked_up: "Picked up" },
  ur: { waiting: "انتظار میں", called: "بلایا گیا", serving: "خدمت جاری", done: "مکمل", no_show: "نہیں آیا", cancelled: "منسوخ", left: "چلا گیا", received: "وصول کیا", in_progress: "کام جاری", ready: "تیار", picked_up: "لے لیا" },
  bn: { waiting: "অপেক্ষমাণ", called: "ডাকা হয়েছে", serving: "সেবা চলছে", done: "সম্পন্ন", no_show: "আসেনি", cancelled: "বাতিল", left: "চলে গেছে", received: "গ্রহণ করা হয়েছে", in_progress: "কাজ চলছে", ready: "প্রস্তুত", picked_up: "নিয়ে গেছে" },
  fil: { waiting: "Naghihintay", called: "Tinawag na", serving: "Sineserbisyuhan", done: "Tapos", no_show: "Hindi dumating", cancelled: "Kinansela", left: "Umalis", received: "Natanggap", in_progress: "Ginagawa", ready: "Handa na", picked_up: "Nakuha na" },
};
function callTicket(d, t) {
  for (const x of db.tickets) if (x.branch_id === d.branch_id && x.called_by === d.id && x.mode === "remote" && ["called", "serving"].includes(x.status) && x.id !== t.id) finish(x);
  Object.assign(t, { status: "called", called_at: iso(), called_by: d.id, provider_id: t.provider_id ?? d.provider_id });
  return { ok: true, ticket: ticketView(t) };
}
const staffTicket = (d, id) => db.tickets.find((t) => t.id === id && t.branch_id === d.branch_id) ?? fail("ticket_not_found");
function staffAction(d, action, body) {
  const b = branch(d.branch_id);
  switch (action) {
    case "state":
      return {
        device: { id: d.id, label: d.label, language: d.language, provider_id: d.provider_id },
        branch: { id: b.id, public_id: b.public_id, name: b.name, busy_level: busyLevel(b), manual_busy: db.status[b.id]?.manual ?? null, open: openState(b).open, settings: settings(b), features: features(b) },
        services: db.services.filter((s) => s.branch_id === b.id && s.is_active).sort((x, y) => x.sort - y.sort)
          .map((s) => ({ id: s.id, name: s.name, mode: s.mode, avg_minutes: s.avg_minutes, now_serving: nowServing(s.id), waiting: db.tickets.filter((t) => t.service_id === s.id && t.status === "waiting").length })),
        providers: db.providers.filter((p) => p.branch_id === b.id && p.is_active).map((p) => ({ id: p.id, name: p.display_name, service_ids: p.service_ids })),
        tickets: db.tickets.filter((t) => t.branch_id === b.id && (["waiting", "called", "serving"].includes(t.status)))
          .sort((x, y) => (before(x, y) ? -1 : 1))
          .map((t) => ({ id: t.id, number: t.number, mode: t.mode, status: t.status, stage: t.stage, service_id: t.service_id, provider_id: t.provider_id, party_size: t.party_size,
            priority: t.priority, priority_reason: t.priority_reason, push_enabled: t.push_enabled, source: t.source, receipt_code: t.receipt_code, item_label: t.item_label,
            push_back_count: t.push_back_count, joined_at: t.joined_at, called_at: t.called_at, called_by_me: t.called_by === d.id, position: t.status === "waiting" && t.mode === "remote" ? position(t) : null })),
        ready_numbers: db.ready.filter((r) => r.branch_id === b.id && r.day === dayOf()).sort((x, y) => (x.ready_at < y.ready_at ? 1 : -1)).slice(0, 12).map((r) => r.code),
        labels: LABELS[d.language] ?? LABELS.ar, server_time: iso(),
      };
    case "call_next": {
      const prov = body.provider_id ?? d.provider_id;
      const next = db.tickets.filter((t) => t.branch_id === b.id && t.status === "waiting" && t.mode === "remote" && (!body.service_id || t.service_id === body.service_id)
        && (!prov || !t.provider_id || t.provider_id === prov)).sort((x, y) => (before(x, y) ? -1 : 1))[0];
      if (!next) {
        for (const x of db.tickets) if (x.called_by === d.id && ["called", "serving"].includes(x.status)) finish(x);
        return { ok: true, ticket: null, empty: true };
      }
      if (prov) next.provider_id = prov;
      return callTicket(d, next);
    }
    case "call_ticket": { const t = staffTicket(d, body.ticket_id); if (t.status !== "waiting" || t.mode !== "remote") fail("not_waiting"); return callTicket(d, t); }
    case "serve": { const t = staffTicket(d, body.ticket_id); Object.assign(t, { status: "serving", served_at: iso(), called_at: t.called_at ?? iso(), called_by: t.called_by ?? d.id }); return { ok: true }; }
    case "done": { const t = staffTicket(d, body.ticket_id); finish(t); return { ok: true }; }
    case "push_back": {
      const t = staffTicket(d, body.ticket_id);
      if (!["waiting", "called"].includes(t.status)) fail("invalid_state");
      if (t.push_back_count >= 1) Object.assign(t, { status: "no_show", left_at: iso() });
      else { moveBack(t, settings(b).no_show_push_back); t.push_back_count++; }
      return { ok: true, status: t.status };
    }
    case "no_show": { const t = staffTicket(d, body.ticket_id); Object.assign(t, { status: "no_show", left_at: iso() }); return { ok: true }; }
    case "add_walk_in": {
      need(b, "queue");
      const s = db.services.find((x) => x.id === body.service_id && x.branch_id === b.id && x.mode === "remote") ?? fail("invalid_service");
      const party = body.party_size ?? 1;
      if (party > 1) need(b, "family_ticket");
      const t = newTicket(b, s, { source: "walk_in", party_size: party, provider_id: body.provider_id ?? null });
      return { ok: true, ticket_id: t.id, number: t.number, position: position(t), estimate_min: estimate(t) };
    }
    case "mark_ready": {
      const code = String(body.receipt_code ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
      if (!code) fail("invalid_receipt_code");
      const r = db.ready.find((x) => x.branch_id === b.id && x.day === dayOf() && x.code === code);
      if (r) r.ready_at = iso(); else db.ready.push({ branch_id: b.id, day: dayOf(), code, ready_at: iso() });
      const linked = db.tickets.filter((t) => t.branch_id === b.id && t.day === dayOf() && t.mode === "receipt" && t.receipt_code === code && t.status === "waiting");
      linked.forEach(finish);
      return { ok: true, receipt_code: code, customer_linked: linked.length > 0 };
    }
    case "dropoff_create": {
      need(b, "queue");
      const s = db.services.find((x) => x.id === body.service_id && x.branch_id === b.id && x.mode === "dropoff") ?? fail("invalid_service");
      const label = String(body.item_label ?? "").trim();
      if (!label || label.length > 60) fail("invalid_input", { field: "item_label" });
      const claim = token();
      const t = newTicket(b, s, { source: "staff", item_label: label, stage: "received", claim });
      return { ok: true, ticket_id: t.id, number: t.number, claim_token: claim, claim_url: `${location.origin}/c/${claim}` };
    }
    case "dropoff_stage": {
      const t = staffTicket(d, body.ticket_id);
      const st = body.stage;
      if (st === "in_progress") Object.assign(t, { stage: st, status: "serving", served_at: t.served_at ?? iso() });
      else if (st === "ready") Object.assign(t, { stage: st, status: "called", called_at: iso(), served_at: t.served_at ?? iso() });
      else if (st === "picked_up") finish(t);
      else if (st === "received") Object.assign(t, { stage: st, status: "waiting" });
      else fail("invalid_input", { field: "stage" });
      return { ok: true, stage: st };
    }
    case "set_priority": {
      need(b, "priority");
      const t = staffTicket(d, body.ticket_id);
      if (t.status !== "waiting") fail("not_waiting");
      Object.assign(t, { priority: true, priority_reason: body.reason });
      return { ok: true };
    }
    case "set_busy": db.status[b.id] = { ...db.status[b.id], manual: body.level ?? null, at: iso() }; return { ok: true, busy_level: busyLevel(b) };
    case "redeem_check":
      return { redemptions: db.redemptions.filter((r) => r.branch_id === b.id && Date.now() - Date.parse(r.redeemed_at) < 12 * 3600000).slice(-10).reverse()
        .map((r) => ({ id: r.id, redeemed_at: r.redeemed_at, ticket_number: r.ticket_number, kind: r.loyalty_card_id ? "loyalty" : "offer", title: db.offers.find((o) => o.id === r.offer_id)?.title ?? settings(b).loyalty_reward_text })) };
    default: fail("invalid_action");
  }
}

// ---------- owner ----------
const session = () => store.get("dawri.demo.session");
const requireUser = () => session()?.user ?? fail("unauthorized");
function ownedBranch(user, branchId) {
  const b = branch(branchId) ?? fail("forbidden");
  if (biz(b).owner !== user.id && !db.admins.includes(user.id)) fail("forbidden");
  return b;
}
const TABLES = {
  services: ["branch_id", "name", "mode", "avg_minutes", "is_active", "sort"],
  providers: ["branch_id", "display_name", "service_ids", "is_active"],
  menu_items: ["branch_id", "category", "name", "description", "price_sar", "duration_min", "is_available", "sort", "service_id"],
  offers: ["branch_id", "kind", "title", "terms", "discount_text", "weekdays", "start_time", "end_time", "valid_from", "valid_to", "max_redemptions", "is_active"],
  news_posts: ["branch_id", "title", "body", "published_at"],
  business_pages: ["branch_id", "bio", "photos", "highlights", "is_published"],
  branches: ["name", "address", "map_url", "phone", "google_review_url", "hours"],
};
const COLLECTION = { services: "services", providers: "providers", menu_items: "menu", offers: "offers", news_posts: "news" };
const tableFeature = (table, row) => ({ menu_items: "menu", news_posts: "news", business_pages: "full_page", offers: row.kind === "quiet_coupon" ? "quiet_coupon" : "timed_offers" })[table];
function pick(row, cols) { const o = {}; for (const c of cols) if (row && c in row) o[c] = row[c]; return o; }

function ownerAction(user, action, body) {
  switch (action) {
    case "overview":
      return {
        is_admin: db.admins.includes(user.id),
        businesses: db.businesses.filter((z) => z.owner === user.id).map((z) => ({
          id: z.id, name: z.name, slug: z.slug, category: z.category, plan: z.plan, effective_plan: effectivePlan(z), plan_until: z.plan_until, trial_until: z.trial_until,
          trial_days_left: z.trial_until ? Math.max(0, Math.ceil((Date.parse(z.trial_until) - Date.now()) / DAY_MS)) : 0, is_active: z.is_active,
          branches: db.branches.filter((b) => b.business_id === z.id).map((b) => ({ id: b.id, name: b.name, public_id: b.public_id, address: b.address, map_url: b.map_url, phone: b.phone,
            google_review_url: b.google_review_url, hours: b.hours, settings: settings(b), features: features(b) })),
        })),
      };
    case "dashboard": return dashboard(ownedBranch(user, body.branch_id), body.range ?? "today");
    case "queue": {
      const b = ownedBranch(user, body.branch_id);
      return { busy_level: busyLevel(b),
        services: db.services.filter((s) => s.branch_id === b.id && s.is_active).map((s) => {
          const w = db.tickets.filter((t) => t.service_id === s.id && t.status === "waiting");
          return { id: s.id, name: s.name, mode: s.mode, now_serving: nowServing(s.id), waiting: w.length, estimate_min: round5(w.reduce((a, t) => a + t.party_size, 0) * serviceMinutes(s.id) / providerCount(s)) };
        }),
        providers: db.providers.filter((p) => p.branch_id === b.id && p.is_active).map((p) => ({ id: p.id, name: p.display_name, waiting: db.tickets.filter((t) => t.provider_id === p.id && t.status === "waiting").length,
          serving: Math.max(0, ...db.tickets.filter((t) => t.provider_id === p.id && ["called", "serving"].includes(t.status)).map((t) => t.number)) || null })),
        tickets: db.tickets.filter((t) => t.branch_id === b.id && ["waiting", "called", "serving"].includes(t.status)).sort((x, y) => (before(x, y) ? -1 : 1))
          .map((t) => ({ id: t.id, number: t.number, mode: t.mode, status: t.status, stage: t.stage, service_id: t.service_id, provider_id: t.provider_id, party_size: t.party_size, priority: t.priority,
            receipt_code: t.receipt_code, item_label: t.item_label, joined_at: t.joined_at, position: t.status === "waiting" && t.mode === "remote" ? position(t) : null })) };
    }
    case "set_busy": { const b = ownedBranch(user, body.branch_id); db.status[b.id] = { ...db.status[b.id], manual: body.level ?? null, at: iso() }; commit(b.public_id); return { ok: true, busy_level: busyLevel(b) }; }
    case "devices": { const b = ownedBranch(user, body.branch_id); return { devices: db.devices.filter((d) => d.branch_id === b.id).map(({ token: _t, ...d }) => d) }; }
    case "create_staff_device": {
      const b = ownedBranch(user, body.branch_id);
      if (!body.label?.trim()) fail("invalid_input", { field: "label" });
      const tok = token();
      db.devices.push({ id: uid(), branch_id: b.id, label: body.label.trim(), language: body.language ?? "ar", provider_id: body.provider_id ?? null, token: tok, revoked_at: null, last_seen_at: null, created_at: iso() });
      commit(b.public_id);
      return { ok: true, pairing_url: `${location.origin}/staff/pair#${tok}` };
    }
    case "revoke_device": { const d = db.devices.find((x) => x.id === body.device_id) ?? fail("forbidden"); ownedBranch(user, d.branch_id); d.revoked_at = iso(); commit(null); return { ok: true }; }
    case "settings_update": { const b = ownedBranch(user, body.branch_id); b.settings = { ...b.settings, ...body.settings }; commit(b.public_id); return { ok: true, settings: settings(b) }; }
    case "subscribe_push": return { ok: true };
    case "quiet_hours": { const b = ownedBranch(user, body.branch_id); const arrivals = arrivalsMatrix(b), open = openMatrix(b); return { arrivals, open, windows: quietWindows(arrivals, open), busiest: busiest(arrivals) }; }
    case "suggest_quiet_coupon": {
      const b = ownedBranch(user, body.branch_id), w = quietWindows(arrivalsMatrix(b), openMatrix(b))[0];
      if (!w) return { suggestion: null };
      const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"], d = (n) => String(n).replace(/\d/g, (x) => "٠١٢٣٤٥٦٧٨٩"[x]);
      const lab = (h) => `${d(h % 12 || 12)} ${h < 12 ? "الصباح" : h < 15 ? "الظهر" : h < 18 ? "العصر" : "المساء"}`;
      return { locked: !has(b, "quiet_coupon"), required_plan: has(b, "quiet_coupon") ? null : "full",
        suggestion: { kind: "quiet_coupon", title: "كوبون الهدوء", terms: `خصم ${days[w.weekday]} من ${lab(w.start_hour)} لمدة ساعتين`, discount_text: "١٥٪", weekdays: [w.weekday],
          start_time: `${String(w.start_hour).padStart(2, "0")}:00`, end_time: `${String((w.start_hour + 2) % 24).padStart(2, "0")}:00`,
          label_ar: `${days[w.weekday]} ${lab(w.start_hour)}–${d((w.start_hour + 2) % 12 || 12)} هادئ`, branch_id: b.id } };
    }
    case "list": {
      const b = ownedBranch(user, body.branch_id);
      if (body.table === "branches") return { rows: [b] };
      if (body.table === "business_pages") return { rows: db.pages[b.id] ? [{ branch_id: b.id, ...db.pages[b.id] }] : [] };
      const col = COLLECTION[body.table] ?? fail("invalid_input", { field: "table" });
      return { rows: db[col].filter((r) => r.branch_id === b.id) };
    }
    case "upsert": {
      const cols = TABLES[body.table] ?? fail("invalid_input", { field: "table" });
      const row = pick(body.row, cols);
      const branchId = body.table === "branches" ? body.row?.id : row.branch_id;
      const b = ownedBranch(user, branchId);
      const f = tableFeature(body.table, row); if (f) need(b, f);
      if (body.table === "branches") { Object.assign(b, row); commit(b.public_id); return { ok: true, row: { id: b.id } }; }
      if (body.table === "business_pages") { db.pages[b.id] = { ...(db.pages[b.id] ?? {}), ...row }; commit(b.public_id); return { ok: true, row: { branch_id: b.id, ...db.pages[b.id] } }; }
      const list = db[COLLECTION[body.table]];
      let existing = body.row?.id && list.find((r) => r.id === body.row.id);
      if (existing) Object.assign(existing, row);
      else { existing = { id: uid(), created_at: iso(), ...(body.table === "news_posts" ? { published_at: iso() } : {}), ...(body.table === "offers" ? { weekdays: [0, 1, 2, 3, 4, 5, 6], is_active: true, kind: "timed" } : {}), ...(body.table === "menu_items" ? { is_available: true, sort: list.length } : {}), ...(body.table === "services" || body.table === "providers" ? { is_active: true, sort: list.length } : {}), ...row }; list.push(existing); }
      commit(b.public_id);
      return { ok: true, row: existing };
    }
    case "delete": {
      const col = COLLECTION[body.table] ?? fail("invalid_action");
      const r = db[col].find((x) => x.id === body.id) ?? fail("not_found");
      const b = ownedBranch(user, r.branch_id);
      db[col] = db[col].filter((x) => x.id !== body.id);
      commit(b.public_id);
      return { ok: true };
    }
    case "menu_bulk": {
      const b = ownedBranch(user, body.branch_id);
      need(b, "menu");
      if (body.replace) db.menu = db.menu.filter((m) => m.branch_id !== b.id);
      body.items.forEach((it, i) => db.menu.push({ id: uid(), ...pick(it, TABLES.menu_items), branch_id: b.id, is_available: true, sort: i }));
      commit(b.public_id);
      return { ok: true, inserted: body.items.length };
    }
    default: fail("invalid_action");
  }
}

// ---------- background "life" for the demo ----------
let tickTimer = null;
function autoTick() {
  if (store.get("dawri.demo.auto", true) === false) return;
  const last = store.get("dawri.demo.tick", 0);
  if (Date.now() - last < 14000) return; // another tab ticked recently
  store.set("dawri.demo.tick", Date.now());
  fresh();
  const changed = new Set();
  const rnd = (n) => Math.floor(Math.random() * n);
  // barber: keep a short line and call people forward
  const aseel = branch("br-aseel");
  if (aseel) {
    const remoteWaiting = db.tickets.filter((t) => t.branch_id === aseel.id && t.status === "waiting" && t.mode === "remote");
    if (remoteWaiting.length < 3 && Math.random() < 0.6) newTicket(aseel, db.services.find((s) => s.id === ["svc-hair", "svc-beard", "svc-both"][rnd(3)]), { source: Math.random() < 0.5 ? "walk_in" : "remote" });
    if (remoteWaiting.length && Math.random() < 0.55) staffAction(db.devices.find((d) => d.id === ["dev-aseel1", "dev-aseel2"][rnd(2)]), "call_next", {});
    changed.add(aseel.public_id);
  }
  const rukn = branch("br-rukn");
  if (rukn) {
    if (Math.random() < 0.4) { const code = String(48 + db.tickets.filter((t) => t.branch_id === rukn.id).length); db.ready.some((r) => r.code === code) || newTicket(rukn, db.services.find((s) => s.id === "svc-rukn"), { receipt_code: code, source: "receipt", mode: "receipt" }); }
    const oldest = db.tickets.filter((t) => t.branch_id === rukn.id && t.mode === "receipt" && t.status === "waiting").sort((a, b) => a.sort_key - b.sort_key)[0];
    if (oldest && Date.now() - Date.parse(oldest.joined_at) > 40000) staffAction(db.devices.find((d) => d.id === "dev-rukn"), "mark_ready", { receipt_code: oldest.receipt_code });
    changed.add(rukn.public_id);
  }
  const lamaa = branch("br-lamaa");
  if (lamaa) {
    const car = db.tickets.filter((t) => t.branch_id === lamaa.id && t.mode === "dropoff" && !["done", "cancelled"].includes(t.status)).sort((a, b) => a.sort_key - b.sort_key)[0];
    if (car && Math.random() < 0.5) staffAction(db.devices.find((d) => d.id === "dev-lamaa"), "dropoff_stage", { ticket_id: car.id, stage: { received: "in_progress", in_progress: "ready", ready: "picked_up" }[car.stage] });
    changed.add(lamaa.public_id);
  }
  commit([...changed]);
}

// ---------- the API object (same surface as api.js) ----------
const wrap = (f) => async (...a) => {
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180)); // feel like a network
  fresh();
  return structuredClone(await f(...a));
};

export async function createApi() {
  tickTimer ??= setInterval(autoTick, 15000);
  return {
    demo: true,
    publicBranch: wrap((publicId) => {
      const b = branchByPublic(publicId) ?? fail("branch_not_found"), f = features(b), st = openState(b);
      return {
        branch: { public_id: b.public_id, name: b.name, business_name: biz(b).name, category: biz(b).category, address: b.address, map_url: b.map_url, phone: b.phone, hours: b.hours,
          open: st.open, closes_at: st.closes_at, next_open_at: st.next_open_at, busy_level: busyLevel(b), waiting: waitingCount(b.id),
          show_arabic_digits: settings(b).show_arabic_digits, remote_join_limit: settings(b).remote_join_limit },
        features: f,
        services: db.services.filter((s) => s.branch_id === b.id && s.is_active).sort((x, y) => x.sort - y.sort).map((s) => {
          const w = db.tickets.filter((t) => t.service_id === s.id && t.status === "waiting");
          return { id: s.id, name: s.name, mode: s.mode, avg_minutes: s.avg_minutes, now_serving: nowServing(s.id), waiting: w.length,
            estimate_min: round5(w.reduce((a, t) => a + t.party_size, 0) * serviceMinutes(s.id) / providerCount(s)) };
        }),
        providers: f.includes("preferred_provider") ? db.providers.filter((p) => p.branch_id === b.id && p.is_active).map((p) => ({ id: p.id, name: p.display_name, service_ids: p.service_ids })) : [],
        ready_numbers: db.ready.filter((r) => r.branch_id === b.id && r.day === dayOf()).sort((x, y) => (x.ready_at < y.ready_at ? 1 : -1)).slice(0, 20).map((r) => r.code),
        page: f.includes("full_page") && db.pages[b.id]?.is_published ? db.pages[b.id] : null,
        menu: f.includes("menu") ? db.menu.filter((m) => m.branch_id === b.id && m.is_available).sort((x, y) => x.sort - y.sort) : [],
        offers: activeOffers(b),
        best_time: f.includes("best_time") ? { arrivals: arrivalsMatrix(b), open: openMatrix(b) } : null,
        news: f.includes("news") ? db.news.filter((n) => n.branch_id === b.id).sort((x, y) => (x.published_at < y.published_at ? 1 : -1)).slice(0, 10) : [],
        server_time: iso(),
      };
    }),
    publicTicket: wrap((tok) => ticketView(byToken(tok))),
    customer: wrap((action, body = {}) => (customer[action] ?? fail("invalid_action"))(body)),
    staff: wrap((action, body = {}) => {
      const d = deviceByToken(store.get("dawri.device"));
      d.last_seen_at = iso();
      if (action === "rotating_code") {
        const b = branch(d.branch_id);
        return rotatingCode(b.secret, Math.floor(Date.now() / 60000)).then((code) => ({ code, expires_in: 60 - (Math.floor(Date.now() / 1000) % 60) }));
      }
      const r = staffAction(d, action, body);
      if (!["state", "redeem_check"].includes(action)) commit(branch(d.branch_id).public_id);
      return r;
    }),
    owner: wrap((action, body = {}) => ownerAction(requireUser(), action, body)),
    onboard: wrap((p) => {
      const user = requireUser();
      if (!p.business_name || p.business_name.trim().length < 2) fail("invalid_input", { field: "business_name" });
      if (!Array.isArray(p.services) || !p.services.length) fail("invalid_input", { field: "services" });
      const cat = p.category ?? "other", mode = ["cafe", "restaurant", "bakery"].includes(cat) ? "receipt" : ["carwash", "phone_repair"].includes(cat) ? "dropoff" : "remote";
      const bizId = uid(), brId = uid(), pid = Math.random().toString(36).slice(2, 10);
      db.businesses.push({ id: bizId, name: p.business_name.trim(), slug: `d-${pid}`, category: cat, plan: "basic", plan_until: null, trial_until: iso(Date.now() + 14 * DAY_MS), owner: user.id, is_active: true, is_demo: false, created_at: iso() });
      db.branches.push({ id: brId, business_id: bizId, name: p.branch_name || p.business_name.trim(), public_id: pid, address: p.district ?? null, map_url: null, phone: p.phone ?? null, google_review_url: null,
        hours: p.hours && Object.keys(p.hours).length ? p.hours : ALL_DAY, settings: { staff_languages: [p.staff_language ?? "ar"] }, secret: token() });
      p.services.forEach((s, i) => db.services.push({ id: uid(), branch_id: brId, name: s.name, mode: s.mode ?? mode, avg_minutes: s.avg_minutes ?? 15, is_active: true, sort: i }));
      db.pages[brId] = { bio: null, photos: [], highlights: [], is_published: true };
      db.history[brId] = [];
      const tok = token();
      db.devices.push({ id: uid(), branch_id: brId, label: "جهاز الكاشير", language: p.staff_language ?? "ar", provider_id: null, token: tok, revoked_at: null, last_seen_at: null, created_at: iso() });
      commit(pid);
      return { ok: true, business_id: bizId, slug: `d-${pid}`, branch_id: brId, public_id: pid, trial_until: iso(Date.now() + 14 * DAY_MS), shop_url: `${location.origin}/s/${pid}`, pairing_url: `${location.origin}/staff/pair#${tok}` };
    }),
    ai: wrap(async (action, body = {}) => {
      if (action === "status") return { available: true };
      if (action === "menu_from_photo") {
        const user = requireUser(), b = ownedBranch(user, body.branch_id);
        need(b, "menu_photo_ai");
        await new Promise((r) => setTimeout(r, 1200));
        return { note_ar: "راجع الأصناف والأسعار قبل الحفظ", items: [
          { category: "مشروبات حارة", name: "قهوة سعودية", description: null, price_sar: 12, duration_min: null },
          { category: "مشروبات حارة", name: "كورتادو", description: null, price_sar: 16, duration_min: null },
          { category: "مشروبات باردة", name: "آيس لاتيه", description: "حليب طازج", price_sar: 19, duration_min: null },
          { category: "مخبوزات", name: "كرواسون زعتر", description: null, price_sar: null, duration_min: null }] };
      }
      if (action === "qa") {
        const b = branchByPublic(body.public_id) ?? fail("branch_not_found");
        need(b, "qa_assistant");
        const q = String(body.question ?? "");
        if (/موقع|وين|مكان|location|where/i.test(q)) return { answer: `${b.address}. تقدر تفتح الخريطة من زر الموقع في الصفحة.` };
        if (/دوام|متى|تفتح|تقفل|hours|open/i.test(q)) return { answer: "نفتح كل يوم، والأوقات مكتوبة في الصفحة تحت «الدوام»." };
        if (/سعر|كم|بكم|price|cost/i.test(q)) { const m = db.menu.find((x) => x.branch_id === b.id && x.price_sar); return { answer: m ? `مثلاً ${m.name} بـ ${m.price_sar} ريال، والقائمة كاملة في الصفحة.` : "ما عندي هالمعلومة، تقدر تتصل بالمحل مباشرة" }; }
        return { answer: /[؀-ۿ]/.test(q) ? "ما عندي هالمعلومة، تقدر تتصل بالمحل مباشرة" : "I don't have that information. You can call the shop directly." };
      }
      if (action === "summary_text") return { text: "يوم طيب: خدمت زبائنك بانتظار قصير. جرّب كوبون الهدوء في وقت العصر." };
      fail("invalid_action");
    }),
    admin: wrap((action, body = {}) => {
      const user = requireUser();
      if (!db.admins.includes(user.id)) fail("forbidden");
      if (action === "list") return { businesses: db.businesses.map((z) => ({ id: z.id, name: z.name, slug: z.slug, category: z.category, plan: z.plan, effective_plan: effectivePlan(z), plan_until: z.plan_until,
        trial_until: z.trial_until, is_active: z.is_active, is_demo: z.is_demo, created_at: z.created_at, owner_email: db.users.find((u) => u.id === z.owner)?.email ?? null,
        branches: db.branches.filter((b) => b.business_id === z.id).map((b) => ({ id: b.id, name: b.name, public_id: b.public_id })),
        usage: { tickets_30d: db.tickets.filter((t) => branch(t.branch_id)?.business_id === z.id).length + (db.history[db.branches.find((b) => b.business_id === z.id)?.id] ?? []).reduce((a, h) => a + h.arrivals.reduce((x, y) => x + y, 0), 0), ai_calls_30d: 0,
          devices: db.devices.filter((d) => branch(d.branch_id)?.business_id === z.id && !d.revoked_at).length } })) };
      if (action === "update_business") { const z = db.businesses.find((x) => x.id === body.business_id) ?? fail("not_found"); Object.assign(z, pick(body.changes, ["plan", "plan_until", "trial_until", "is_active"])); commit("*"); return { ok: true }; }
      if (action === "branch_dashboard") return dashboard(branch(body.branch_id) ?? fail("not_found"), body.range ?? "7d");
      fail("invalid_action");
    }),
    auth: {
      async session() { const s = session(); return s ? { user: s.user, access_token: "demo" } : null; },
      async signIn(email, password) {
        const u = db.users.find((x) => x.email === String(email).trim().toLowerCase());
        if (!u || (password !== PASSWORD && !u.custom) || (u.custom && u.password !== password)) fail("unauthorized", { message_ar: "البريد أو كلمة المرور غير صحيحة. في الوضع التجريبي كلمة المرور: Dawri-Demo-2026", message_en: "Wrong email or password" });
        store.set("dawri.demo.session", { user: { id: u.id, email: u.email } });
        authCbs.forEach((cb) => cb(session()));
        return session();
      },
      async signUp(email, password) {
        email = String(email).trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) fail("invalid_input", { field: "email" });
        if (String(password).length < 8) fail("invalid_input", { field: "password", message_ar: "كلمة المرور ٨ أحرف على الأقل" });
        let u = db.users.find((x) => x.email === email);
        if (!u) { u = { id: uid(), email, custom: true, password }; db.users.push(u); commit(null); }
        store.set("dawri.demo.session", { user: { id: u.id, email: u.email } });
        authCbs.forEach((cb) => cb(session()));
        return session();
      },
      async magicLink() { fail("invalid_input", { message_ar: "رابط الدخول بالبريد يعمل بعد ربط Supabase. في الوضع التجريبي ادخل بكلمة المرور.", message_en: "Magic links need the real backend" }); },
      async signOut() { store.del("dawri.demo.session"); authCbs.forEach((cb) => cb(null)); },
      onChange(cb) { authCbs.add(cb); return () => authCbs.delete(cb); },
    },
    subscribe(publicId, cb) {
      if (!listeners.has(publicId)) listeners.set(publicId, new Set());
      listeners.get(publicId).add(cb);
      return () => listeners.get(publicId)?.delete(cb);
    },
    async uploadPhoto(_branchId, file) {
      return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    },
    photoUrl: (p) => p,
    async rotatingCodeFor(publicId) { const b = branchByPublic(publicId); return b ? rotatingCode(b.secret, Math.floor(Date.now() / 60000)) : null; },
    reset() { store.del(KEY); db = load(); commit("*"); },
  };
}
const authCbs = new Set();
