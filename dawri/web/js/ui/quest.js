// «تحدّياتي» cards and the «وأنت تنتظر» list of up to 4 surprises shown on the ticket page.
import { h, icon } from "./dom.js";
import { t, num, lang } from "../i18n.js";

const KIND_ICON = { visits: "repeat", quiet: "sunset-2", comeback: "heart-handshake", provider: "armchair-2", friend: "users" };

function daysLeft(iso) {
  const d = Math.ceil((Date.parse(iso) - Date.now()) / 86400000);
  return d <= 1 ? t("quest.ends_today") : t("quest.ends_in", { n: num(d) });
}
function windowText(q) {
  if (!q.time_start) return null;
  const hh = (x) => num(Number(x.slice(0, 2)) % 12 || 12) + (lang() === "ar" ? (Number(x.slice(0, 2)) < 12 ? " ص" : " م") : Number(x.slice(0, 2)) < 12 ? "am" : "pm");
  return t("quest.window", { from: hh(q.time_start), to: hh(q.time_end) });
}

/**
 * QuestCard(q, { onStart, onRedeem, preview }) — a challenge drawn as a ticket stub:
 * reward up top, perforation, then the visit path (one stop per visit, the last stop is the gift).
 */
export function QuestCard(q, { onStart, onRedeem, preview = false } = {}) {
  const mine = q.mine;
  const done = Math.min(mine?.visits ?? 0, q.required_visits);
  const left = q.required_visits - done;
  const stops = Array.from({ length: q.required_visits }, (_, i) => {
    const last = i === q.required_visits - 1;
    return h(`span.q-stop${i < done ? ".on" : ""}${last ? ".gift" : ""}`, { "aria-hidden": "true" }, last ? icon("gift") : i < done ? icon("check") : num(i + 1));
  });
  let cta = null;
  if (!preview) {
    if (!mine) cta = h("button.btn.q-cta", { type: "button", "data-testid": "quest-start", onclick: () => onStart?.(q) }, icon("flag-3"), t("quest.start"));
    else if (mine.redeemed) cta = h("span.q-state", icon("circle-check"), t("quest.redeemed"));
    else if (mine.completed) cta = h("button.btn.q-cta.q-win", { type: "button", "data-testid": "quest-redeem", onclick: () => onRedeem?.(q) }, icon("gift"), t("quest.use_reward"));
    else cta = h("span.q-state", icon("flame"), left === 1 ? t("quest.one_left") : t("quest.left", { n: num(left) }));
  }
  return h(`article.quest${q.rarity === "rare" ? ".rare" : ""}${mine?.completed && !mine.redeemed ? ".won" : ""}`, { "data-quest": q.id, "aria-label": `${q.title}: ${q.reward_text}` },
    h("div.q-head",
      h("span.q-kind", icon(KIND_ICON[q.kind] ?? "flag-3"), t(`quest.kind.${q.kind}`)),
      q.rarity === "rare" ? h("span.q-rare", icon("diamond"), q.spots_left != null ? t("quest.rare_left", { n: num(q.spots_left) }) : t("quest.rare")) : null),
    h("h3.q-title", q.title),
    h("div.q-reward", h("small", t("quest.reward")), h("b", q.reward_text)),
    h("p.q-desc", [q.description, windowText(q), q.provider, q.service].filter(Boolean).join(" · ")),
    h("div.q-perf", { "aria-hidden": "true" }),
    h("div.q-path", { role: "img", "aria-label": t("quest.progress", { v: num(done), n: num(q.required_visits) }) }, stops),
    h("div.q-foot",
      h("span.q-meta", daysLeft(q.ends_at), q.participants ? ` · ${t("quest.joined", { n: num(q.participants) })}` : ""),
      cta));
}

// ---------- «وأنت تنتظر»: a fixed list of at most 4 surprises from the shop ----------

export const WAITING_LIMIT = 4;

/** Highest pull first: a reward ready to use, then one visit away, rare, in progress, offers, the rest. */
export function pickGifts(quests = [], offers = [], limit = WAITING_LIMIT) {
  const score = (q) => (q.mine?.completed && !q.mine?.redeemed ? 0 : q.mine && q.required_visits - q.mine.visits === 1 ? 1
    : q.rarity === "rare" ? 2 : q.mine && !q.mine.redeemed ? 3 : 5);
  const items = [
    ...quests.filter((q) => !q.mine?.redeemed).map((q) => ({ type: "quest", q, rank: score(q) })),
    ...offers.map((o) => ({ type: "offer", o, rank: 4 })),
  ];
  return items.sort((a, b) => a.rank - b.rank).slice(0, limit);
}

/** Minutes until an offer's end time today (Riyadh), or null. */
function offerMinutesLeft(o) {
  if (!o.end_time) return null;
  const r = new Date(Date.now() + 3 * 3600000), now = r.getUTCHours() * 60 + r.getUTCMinutes();
  const [hh, mm] = o.end_time.split(":").map(Number);
  const left = hh * 60 + mm - now;
  return left > 0 && left <= 180 ? left : null;
}
function durationText(min) {
  if (min < 60) return t("gift.min", { n: num(min) });
  const hh = Math.floor(min / 60), mm = min % 60;
  return mm ? t("gift.hmin", { h: num(hh), m: num(mm) }) : t("gift.hours", { h: num(hh) });
}

/** The emotional line under each gift: what the customer feels, not what the system does. */
function hook(item) {
  if (item.type === "offer") return t("gift.offer_hook");
  const q = item.q, m = q.mine;
  if (m?.completed) return t("gift.won");
  if (m && q.required_visits - m.visits === 1) return t("gift.one_left");
  if (m) return t("gift.keep_going", { n: num(q.required_visits - m.visits) });
  return t(`gift.hook.${q.kind}`);
}

function chips(item) {
  const out = [];
  if (item.type === "offer") {
    const left = offerMinutesLeft(item.o);
    out.push(left ? h("span.g-chip.urgent", { "data-countdown": item.o.end_time }, icon("hourglass-high"), t("gift.ends_in", { t: durationText(left) }))
      : h("span.g-chip", icon("clock"), t("gift.today_only")));
    return out;
  }
  const q = item.q;
  if (q.rarity === "rare" && q.spots_left != null) out.push(h("span.g-chip.urgent", icon("flame"), t("gift.spots", { n: num(q.spots_left) })));
  const days = Math.ceil((Date.parse(q.ends_at) - Date.now()) / 86400000);
  out.push(h("span.g-chip", icon("calendar-time"), days <= 1 ? t("quest.ends_today") : t("quest.ends_in", { n: num(days) })));
  if (q.participants) out.push(h("span.g-chip", icon("users"), t("gift.joined", { n: num(q.participants) })));
  return out;
}

/**
 * GiftCard — one surprise from the shop, laid out like a torn coupon:
 * the reward on the stub, the story and the call to act on the body.
 * The first card arrives sealed («اكشف المفاجأة») until the customer taps it.
 */
export function GiftCard(item, { onStart, onRedeem, onUseOffer, sealed = false, onReveal } = {}) {
  const isQuest = item.type === "quest", q = item.q, o = item.o, m = q?.mine;
  const reward = isQuest ? q.reward_text : o.discount_text ?? "🎁";
  const title = isQuest ? q.title : o.title;
  const detail = isQuest ? [q.description, q.service, q.provider].filter(Boolean).join(" · ") : o.terms;
  const kind = isQuest ? (q.rarity === "rare" ? "rare" : m?.completed ? "won" : "challenge") : "offer";
  let cta;
  if (!isQuest) cta = h("button.btn.g-cta", { type: "button", onclick: () => onUseOffer?.(o) }, icon("ticket"), t("redeem.use"));
  else if (!m) cta = h("button.btn.g-cta", { type: "button", "data-testid": "quest-start", onclick: () => onStart?.(q) }, icon("flag-3"), t("gift.start"));
  else if (m.completed) cta = h("button.btn.g-cta", { type: "button", "data-testid": "quest-redeem", onclick: () => onRedeem?.(q) }, icon("gift"), t("quest.use_reward"));
  const progress = isQuest && m ? h("div.g-progress", { role: "img", "aria-label": t("quest.progress", { v: num(m.visits), n: num(q.required_visits) }) },
    Array.from({ length: q.required_visits }, (_, i) => h(`span${i < m.visits ? ".on" : ""}${i === q.required_visits - 1 ? ".last" : ""}`, i === q.required_visits - 1 ? icon("gift") : null))) : null;
  const card = h(`article.gift.${kind}`, { "data-gift": isQuest ? q.id : o.id, "aria-label": `${title}: ${reward}` },
    h("div.g-stub", { "aria-hidden": "true" },
      h("small", isQuest ? t("quest.reward") : t("gift.discount")),
      h(`b${reward.length > 8 ? ".long" : ""}`, reward),
      h("span.g-kind", icon(isQuest ? (q.rarity === "rare" ? "diamond" : "flag-3") : "discount"), isQuest ? t(`quest.kind.${q.kind}`) : t("showcase.offer"))),
    h("div.g-body",
      h("h3", title),
      h("p.g-hook", hook(item)),
      detail ? h("p.g-detail", detail) : null,
      progress,
      h("div.g-chips", chips(item)),
      cta ? h("div.g-act", cta) : m ? h("div.g-act", h("span.q-state", icon("flame"), t("gift.counting"))) : null));
  if (!sealed) return card;
  const cover = h("button.g-seal", { type: "button", "data-testid": "gift-reveal", "aria-label": t("gift.reveal") },
    h("span.g-seal-icon", { "aria-hidden": "true" }, "🎁"), h("b", t("gift.reveal")), h("span", t("gift.reveal_sub")));
  const wrap = h("div.gift-wrap.sealed", card, cover);
  cover.addEventListener("click", () => { wrap.classList.add("opening"); setTimeout(() => { wrap.classList.remove("sealed", "opening"); cover.remove(); onReveal?.(); }, 450); });
  return wrap;
}

/** «أضف لزيارتك»: compact rows for extras the customer can ask for with «أبيها». */
export function ExtraRow(m, wanted, onToggle) {
  return h(`div.extra${wanted ? ".wanted" : ""}`, { "data-item": m.id },
    h("div.grow", h("div.title", m.name), h("div.muted.small", [m.price_sar != null ? `${num(+m.price_sar)} ${t("unit.sar")}` : null,
      m.duration_min ? t("showcase.minutes", { n: num(m.duration_min) }) : null].filter(Boolean).join(" · "))),
    h(`button.btn${wanted ? ".g-want-on" : ".g-want"}`, { type: "button", "data-testid": "want-item", "aria-pressed": String(wanted), onclick: () => onToggle(m, !wanted) },
      wanted ? [icon("check"), t("showcase.wanted")] : [icon("hand-finger"), t("showcase.want")]));
}
