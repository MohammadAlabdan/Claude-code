// Signature components: TicketCard, NowServingBoard, QueueLine, BusyPill, StageTracker, LockedCard.
import { h, icon, fill } from "./dom.js";
import { num, t } from "../i18n.js";

export function TicketCard({ label, number, status, estimate, alert = false }) {
  return h(`div.ticket${alert ? ".alert" : ""}`, { role: "group", "aria-label": `${label} ${number}` },
    h("div.t-label", label),
    h("div.t-number.num", num(number)),
    h("div.t-perf", { "aria-hidden": "true" }),
    status ? h("div.t-status", status) : null,
    estimate ? h("div.t-est", estimate) : null);
}

/** Dark LED board. update(n) blinks twice when the number changes. */
export function NowServingBoard(label, { big = false } = {}) {
  const digits = h("span.b-digits", "--");
  const el = h(`div.board${big ? ".big" : ""}`, { role: "status", "aria-live": "polite" },
    h("span.b-label", label), digits);
  let last = null;
  el.update = (n) => {
    const v = n == null ? "--" : String(n).padStart(2, "0");
    if (v === last) return;
    digits.textContent = v;
    digits.setAttribute("aria-label", `${label} ${n ?? ""}`);
    if (last !== null) { digits.classList.remove("flash"); void digits.offsetWidth; digits.classList.add("flash"); }
    last = v;
  };
  return el;
}

/** Row of little people; the user's figure is highlighted. update(ahead) animates the front one hopping out. */
export function QueueLine() {
  const el = h("div.qline", { "aria-hidden": "true" });
  let shown = null;
  const render = (ahead) => {
    const visible = Math.min(ahead, 8);
    fill(el, 
      ...Array.from({ length: visible }, () => h("span.qp")),
      ahead > visible ? h("span.more", `+${num(ahead - visible)}`) : null,
      h("span.qp.me", h("span.tag", t("ticket.you"))));
  };
  el.update = (ahead) => {
    ahead = Math.max(0, ahead ?? 0);
    if (shown !== null && ahead < shown && el.firstChild?.classList.contains("qp") && !el.firstChild.classList.contains("me")) {
      el.firstChild.classList.add("hop");
      setTimeout(() => render(ahead), 400);
    } else render(ahead);
    shown = ahead;
  };
  return el;
}

export function BusyPill(level) {
  const lv = ["free", "some", "busy"].includes(level) ? level : "free";
  return h(`span.pill.${lv}`, t(`busy.${lv}`));
}

export function StageTracker(stages, current) {
  const idx = stages.findIndex((s) => s.key === current);
  return h("ol.stages", { "aria-label": t("ticket.stages") },
    stages.map((s, i) => h(`li${i < idx ? ".done" : ""}${i === idx ? ".current" : ""}`, { "aria-current": i === idx ? "step" : null }, s.label)));
}

export function LockedCard(title, plan, iconName = "lock") {
  return h("section.card.locked", h("div.card-head", icon(iconName), h("h3", title), icon("lock", t("locked.label"))),
    h("p.muted.small", t("locked.available_in", { plan: t(`plan.${plan}`) })));
}
