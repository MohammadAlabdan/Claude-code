// «تحدّياتي» cards and the «وأنت تنتظر» story carousel shown on the ticket page.
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

/**
 * StoryCarousel(slides) — the «وأنت تنتظر» showcase: swipeable cards with story-style progress bars,
 * auto-advancing every 6 s until the customer touches it (and never with reduced motion).
 */
export function StoryCarousel(slides, { label }) {
  if (!slides.length) return null;
  const bars = h("div.story-bars", slides.map(() => h("span", h("i"))));
  const track = h("div.story-track", { tabindex: "0", "aria-label": label, "aria-roledescription": "carousel" },
    slides.map((s, i) => h("div.story-slide", { role: "group", "aria-label": `${i + 1} / ${slides.length}` }, s)));
  const el = h("section.story", { "data-testid": "waiting-showcase" }, bars, track);
  let idx = 0, timer = null, paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mark = () => bars.querySelectorAll("span").forEach((b, i) => { b.className = i < idx ? "done" : i === idx ? "now" : ""; });
  const go = (i) => { idx = (i + slides.length) % slides.length; track.scrollTo({ left: -idx * track.clientWidth * (document.documentElement.dir === "rtl" ? 1 : -1), behavior: "smooth" }); mark(); };
  track.addEventListener("scroll", () => {
    const i = Math.round(Math.abs(track.scrollLeft) / Math.max(1, track.clientWidth));
    if (i !== idx) { idx = i; mark(); }
  }, { passive: true });
  const stop = () => { paused = true; clearInterval(timer); el.classList.add("paused"); };
  track.addEventListener("pointerdown", stop, { once: true });
  track.addEventListener("keydown", (e) => { stop(); if (e.key === "ArrowLeft") go(idx + (document.documentElement.dir === "rtl" ? 1 : -1)); if (e.key === "ArrowRight") go(idx + (document.documentElement.dir === "rtl" ? -1 : 1)); });
  if (!paused && slides.length > 1) timer = setInterval(() => document.visibilityState === "visible" && go(idx + 1), 6000);
  el.stop = () => clearInterval(timer);
  mark();
  return el;
}

/** Offer slide: the discount is the headline. */
export function OfferSlide(o, onUse) {
  return h("article.promo.offer", h("span.promo-tag", icon("discount"), t("showcase.offer")),
    h("b.promo-big", o.discount_text ?? "%"), h("h3", o.title), o.terms ? h("p", o.terms) : null,
    h("button.btn.q-cta", { type: "button", onclick: () => onUse(o) }, t("redeem.use")));
}

/** «أبيها» slide: an extra service or item the customer can ask for while waiting. */
export function ItemSlide(m, wanted, onToggle) {
  return h(`article.promo.item${wanted ? ".wanted" : ""}`, { "data-item": m.id },
    h("span.promo-tag", icon("sparkles"), m.category ?? t("showcase.add")),
    h("h3", m.name), m.description ? h("p", m.description) : null,
    h("div.promo-row", m.price_sar != null ? h("b.promo-price", `${num(+m.price_sar)} ${t("unit.sar")}`) : h("span"),
      m.duration_min ? h("span.promo-min", icon("clock"), t("showcase.minutes", { n: num(m.duration_min) })) : null),
    h(`button.btn.q-cta${wanted ? ".q-win" : ""}`, { type: "button", "data-testid": "want-item", "aria-pressed": String(wanted), onclick: () => onToggle(m, !wanted) },
      wanted ? [icon("check"), t("showcase.wanted")] : [icon("hand-finger"), t("showcase.want")]),
    wanted ? h("p.promo-note", t("showcase.wanted_note")) : null);
}

export function NewsSlide(n) {
  return h("article.promo.news", h("span.promo-tag", icon("news"), t("shop.news")), h("h3", n.title), n.body ? h("p", n.body) : null);
}
