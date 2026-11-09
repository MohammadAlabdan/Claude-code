// Customer shop page /s/{public_id}: busy status, services with mode-specific actions, offers, menu, page, Q&A.
import { h, icon, card, store, skeleton, vibrate, fill } from "../ui/dom.js";
import { t, num, time, errorText, hourLabel, WEEKDAYS, lang } from "../i18n.js";
import { BusyPill, LockedCard } from "../ui/components.js";
import { openSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { Heatmap } from "../ui/charts.js";
import { QuestCard } from "../ui/quest.js";
import { setTheme } from "../app.js";
import { subscribePush, pushSupported, needsInstallForPush, localNotify } from "../ui/push.js";

const KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const fmtHours = (ivs) => ivs.map(([o, c]) => (o === c ? t("shop.all_day") : `${o}–${c}`)).join("، ");

/** Best 2-hour window from the arrivals heatmap among open hours (lowest average). */
export function bestTime(bt) {
  if (!bt) return null;
  let best = null;
  bt.arrivals.forEach((row, d) => row.forEach((v, hr) => {
    if (hr > 22 || !bt.open[d][hr] || !bt.open[d][hr + 1] || bt.arrivals.every((r) => r[hr] === 0)) return;
    const avg = (v + row[hr + 1]) / 2;
    if (!best || avg < best.avg) best = { d, hr, avg };
  }));
  return best;
}

/** Today's calmest 2-hour window still ahead (from the arrivals heatmap), or null. */
export function quietToday(bt) {
  if (!bt) return null;
  const r = new Date(Date.now() + 3 * 3600000), d = r.getUTCDay(), now = r.getUTCHours();
  const row = bt.arrivals[d], open = bt.open[d];
  let best = null, peak = 0;
  row.forEach((v, hr) => { if (open[hr]) peak = Math.max(peak, v); });
  for (let hr = Math.max(now + 1, 7); hr < 23; hr++) { // daytime hours people actually go out
    if (!open[hr] || !open[hr + 1]) continue;
    const avg = (row[hr] + row[hr + 1]) / 2;
    if (!best || avg < best.avg) best = { hr, avg };
  }
  return best && peak > 0 && best.avg < peak * 0.6 ? best : null;
}

const watchKey = (pid) => `dawri.quiet.${pid}`;

/** 🌙 / ☀️ button: switches between dark and light for this device (remembered). */
export function themeToggle() {
  const isDark = () => (document.documentElement.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
  const btn = h("button.icon-btn", { type: "button", "data-testid": "theme-toggle" });
  const sync = () => { const d = isDark(); btn.replaceChildren(icon(d ? "sun" : "moon")); btn.setAttribute("aria-label", t(d ? "action.theme_light" : "action.theme_dark")); btn.title = btn.getAttribute("aria-label"); };
  btn.addEventListener("click", () => { setTheme(isDark() ? "light" : "dark"); sync(); });
  sync();
  return btn;
}

export function langToggle(rerender) {
  return h("button.icon-btn", { type: "button", "aria-label": t("action.language"), "data-testid": "lang-toggle",
    onclick: () => { store.set("dawri.lang", lang() === "ar" ? "en" : "ar"); rerender(); } },
    h("span", { style: { fontWeight: 700, fontSize: ".9rem" } }, lang() === "ar" ? "EN" : "ع"));
}

export async function render(ctx) {
  const { api, params, shell, nav } = ctx;
  const publicId = params[0].toLowerCase();
  shell.setActions(themeToggle(), langToggle(ctx.rerender));
  shell.content.append(...skeleton(3));

  // Returning customer with an active ticket goes straight back to it.
  const saved = store.get(`dawri.ticket.${publicId}`);
  if (saved && !location.search.includes("stay")) {
    try {
      const tk = await api.publicTicket(saved);
      if (["waiting", "called", "serving"].includes(tk.status) || (tk.status === "done" && !tk.feedback && Date.now() - Date.parse(tk.done_at ?? 0) < 2 * 3600000)) {
        return nav(`./t/${saved}`, { replace: true });
      }
    } catch { store.del(`dawri.ticket.${publicId}`); }
  }

  let data;
  const root = h("div.stack", { style: { gap: "16px" } });
  const load = async () => {
    data = await api.publicBranch(publicId);
    checkWatch();
    paint();
  };
  try { await load(); } catch (e) {
    fill(shell.content, h("div.empty", icon("building-store"), h("p", errorText(e)), h("a.btn", { href: "./" }, t("action.home"))));
    return;
  }
  fill(shell.content, root);

  const unsub = api.subscribe(publicId, () => load().catch(() => {}));
  const poll = setInterval(() => document.visibilityState === "visible" && load().catch(() => {}), 30000);
  ctx.onCleanup(() => { unsub(); clearInterval(poll); });

  async function join(service) {
    const providers = data.providers.filter((p) => !p.service_ids || p.service_ids.includes(service.id));
    let party = 1, provider = null;
    const partyOut = h("output.big-num", { style: { fontSize: "2rem", minWidth: "2ch", textAlign: "center" } }, num(1));
    const step = (d) => () => { party = Math.min(6, Math.max(1, party + d)); partyOut.textContent = num(party); };
    const body = [
      h("p.muted", t("join.service", { name: service.name })),
      providers.length ? h("label.field", h("span", t("join.provider")),
        h("select", { id: "join-provider", onchange: (e) => (provider = e.target.value || null) },
          h("option", { value: "" }, t("join.any_provider")), providers.map((p) => h("option", { value: p.id }, p.name)))) : null,
      data.features.includes("family_ticket") ? h("div.field", h("span", t("join.party")), h("p.muted.small", t("join.party_hint")),
        h("div.row", { style: { justifyContent: "center", gap: "18px" } },
          h("button.icon-btn", { type: "button", "aria-label": "−", onclick: step(-1), style: { border: "1.5px solid var(--line)" } }, icon("minus")),
          partyOut,
          h("button.icon-btn", { type: "button", "aria-label": "+", onclick: step(1), style: { border: "1.5px solid var(--line)" } }, icon("plus")))) : null,
    ];
    await openSheet({ title: t("join.title"), body, actions: [
      { id: "join-confirm", label: t("join.cta"), primary: true, onClick: async (close) => {
        try {
          const r = await api.customer("join", { public_id: publicId, service_id: service.id, provider_id: provider, party_size: party, lang: lang() });
          store.set(`dawri.ticket.${publicId}`, r.ticket_token);
          vibrate(30);
          close();
          nav(`./t/${r.ticket_token}`);
        } catch (e) { close(); refused(e); }
      } },
      { label: t("action.cancel"), ghost: true }] });
  }

  async function receipt(service) {
    const input = h("input", { id: "receipt-code", inputmode: "numeric", autocomplete: "off", maxlength: 12, placeholder: "47", dir: "ltr", style: { fontSize: "1.6rem", textAlign: "center", letterSpacing: ".1em" } });
    const err = h("p.err", { hidden: true });
    await openSheet({ title: t("receipt.title"), body: [h("p.muted", t("receipt.lead")), h("label.field", h("span", t("receipt.label")), input, err)], actions: [
      { id: "receipt-confirm", label: t("receipt.cta"), primary: true, onClick: async (close) => {
        const code = input.value.trim();
        if (!code) { err.hidden = false; err.textContent = t("receipt.required"); input.setAttribute("aria-invalid", "true"); return; }
        try {
          const r = await api.customer("join_receipt", { public_id: publicId, service_id: service.id, receipt_code: code, lang: lang() });
          store.set(`dawri.ticket.${publicId}`, r.ticket_token);
          close();
          nav(`./t/${r.ticket_token}`);
        } catch (e) { err.hidden = false; err.textContent = errorText(e); }
      } },
      { label: t("action.cancel"), ghost: true }] });
  }

  function refused(e) {
    const best = bestTime(data.best_time);
    openSheet({ title: t("join.refused"), body: [
      h("div.banner.warn", icon("clock-pause"), h("span", errorText(e))),
      e.extra?.next_open_at ? h("p", t("join.next_open", { time: time(e.extra.next_open_at) })) : null,
      best ? h("p", t("join.best_time", { day: WEEKDAYS[lang()][best.d], hour: hourLabel(best.hr) })) : null,
      e.extra?.busy_level ? h("div.row", h("span.muted", t("shop.now")), BusyPill(e.extra.busy_level)) : null,
    ], actions: [{ label: t("action.ok"), primary: true }] });
  }

  function paint() {
    const b = data.branch, f = data.features;
    shell.setTitle(b.business_name);
    const today = KEYS[new Date(Date.now() + 3 * 3600000).getUTCDay()];
    const hoursToday = fmtHours(b.hours[today] ?? []);
    const photo = data.page?.photos?.[0];
    const est = Math.max(0, ...data.services.filter((s) => s.mode === "remote").map((s) => s.estimate_min ?? 0));

    fill(root, 
      pulse(b, f, photo, hoursToday, est),

      card(t("shop.services"), "list-check", h("div.list#services", data.services.map((s) => h("div.list-item", { "data-service": s.id },
        h("div.grow", h("div.title", s.name),
          h("div.muted.small", s.mode === "remote" ? t("shop.service_wait", { n: num(s.waiting), m: num(s.estimate_min) })
            : s.mode === "receipt" ? t("mode.receipt") : t("mode.dropoff"))),
        s.mode === "remote" ? h("button.btn.btn-primary", { type: "button", "data-testid": "take-number", disabled: !b.open, onclick: () => join(s) }, t("shop.take_number"))
          : s.mode === "receipt" ? h("button.btn.btn-primary", { type: "button", "data-testid": "track-order", onclick: () => receipt(s) }, t("shop.track_order"))
          : h("span.small.muted", { style: { maxWidth: "45%" } }, t("shop.dropoff_hint")))))),

      data.ready_numbers.length ? card(t("shop.ready_now"), "bell-ringing", h("div.chips", data.ready_numbers.slice(0, 10).map((n) => h("span.chip", { style: { cursor: "default" } }, num(n))))) : null,

      data.quests?.length ? h("section.stack", { "data-testid": "shop-quests" }, h("div.wait-head", h("h2", t("quest.list_title")), h("span.muted", t("quest.shop_hint"))),
        h("div.quest-list", data.quests.map((q) => QuestCard(q, { preview: true })))) : null,

      data.offers.length ? card(t("shop.offers"), "discount", h("div.list", data.offers.map((o) => h("div.list-item",
        h("div.grow", h("div.title", o.title), o.terms ? h("div.muted.small", o.terms) : null),
        o.discount_text ? h("span.badge", o.discount_text) : null)))) : null,

      f.includes("best_time") && data.best_time ? (() => {
        const best = bestTime(data.best_time);
        return card(t("shop.best_time"), "chart-dots",
          best ? h("p", t("shop.best_time_line", { day: WEEKDAYS[lang()][best.d], hour: hourLabel(best.hr) })) : null,
          Heatmap(data.best_time.arrivals, data.best_time.open, { title: t("shop.best_time") }),
          h("div.legend", h("span", t("shop.heat_legend"))));
      })() : null,

      f.includes("menu") && data.menu.length ? card(t("shop.menu"), "tools-kitchen-2", ...Object.entries(data.menu.reduce((g, m) => ((g[m.category ?? ""] ??= []).push(m), g), {}))
        .map(([cat, items]) => h("div.stack", cat ? h("h3", cat) : null, h("div.list", items.map((m) => h("div.list-item",
          h("div.grow", h("div", m.name), m.description ? h("div.muted.small", m.description) : null),
          m.price_sar != null ? h("strong.num", `${num(+m.price_sar)} ${t("unit.sar")}`) : null)))))) : null,

      f.includes("news") && data.news.length ? card(t("shop.news"), "news", h("div.list", data.news.map((n) => h("div.list-item",
        h("div.grow", h("div.title", n.title), n.body ? h("div.muted.small", n.body) : null), h("span.muted.small", new Date(n.published_at).toLocaleDateString(lang() === "ar" ? "ar-SA-u-ca-gregory" : "en-GB")))))) : null,

      data.page ? card(t("shop.about"), "info-circle",
        data.page.bio ? h("p", data.page.bio) : null,
        data.page.photos?.length ? h("div.photos", data.page.photos.map((p) => h("img", { src: api.photoUrl(p), alt: "", loading: "lazy" }))) : null,
        data.page.highlights?.length ? h("div.chips", data.page.highlights.map((x) => h("span.chip", { style: { cursor: "default" } }, x))) : null) : null,

      card(t("shop.hours"), "clock", h("table.simple", h("tbody", KEYS.map((k, i) => h("tr", { style: k === today ? { fontWeight: 700 } : null },
        h("td", WEEKDAYS[lang()][i]), h("td.num", (b.hours[k] ?? []).length ? num(fmtHours(b.hours[k])) : t("shop.closed"))))))),

      h("div.grid2",
        b.phone ? h("a.btn", { href: `tel:${b.phone}`, "data-testid": "call" }, icon("phone"), t("shop.call")) : null,
        b.map_url ? h("a.btn", { href: b.map_url, target: "_blank", rel: "noopener" }, icon("map-pin"), t("shop.map")) : null),

      f.includes("qa_assistant") ? qaCard() : null,
      h("p.center.muted.small", t("shop.powered")));
  }

  /** «نبض المحل»: the live crowd, said the way a friend would say it, with what to do about it. */
  function pulse(b, f, photo, hoursToday, est) {
    const remote = data.services.filter((s) => s.mode === "remote");
    const level = !b.open ? "closed" : b.busy_level;
    const watch = store.get(watchKey(publicId));
    const quiet = data.best_time ? quietToday(data.best_time) : null;
    const share = async () => {
      const url = location.href.split("?")[0];
      const text = t("pulse.share_text", { shop: b.business_name });
      try { if (navigator.share) return await navigator.share({ title: b.business_name, text, url }); } catch { return; }
      try { await navigator.clipboard.writeText(url); toast(t("pulse.copied")); } catch { toast(url); }
    };
    const primary = remote.length && b.open
      ? h("button.btn.btn-primary.btn-xl", { type: "button", "data-testid": "pulse-join",
          onclick: () => (remote.length === 1 ? join(remote[0]) : document.getElementById("services")?.scrollIntoView({ behavior: "smooth", block: "center" })) },
          icon("ticket"), t("pulse.join"))
      : null;
    const canWatch = b.open && remote.length && f.includes("fadeet") && b.busy_level !== "free";
    return h(`section.pulse.lv-${level}`, { "data-testid": "shop-header", "aria-live": "polite" },
      h("div.p-top",
        h("div.avatar", photo ? h("img", { src: api.photoUrl(photo), alt: "" }) : b.business_name.slice(0, 1)),
        h("div.stack", { style: { gap: "0", minWidth: 0, flex: 1 } },
          h("h2", b.name),
          h("div.row.small", b.open ? h("span.badge", t("shop.open")) : h("span.badge.danger", t("shop.closed")),
            hoursToday ? h("span.muted", num(hoursToday)) : null)),
        h("button.icon-btn.p-share", { type: "button", "aria-label": t("pulse.share"), title: t("pulse.share"), "data-testid": "pulse-share", onclick: share }, icon("share"))),
      h("div.p-now",
        h("span.p-dot", { "aria-hidden": "true" }),
        h("div.grow",
          h("b.p-title", t(`pulse.${level}.title`)),
          h("p.p-line", level === "closed"
            ? (b.next_open_at ? t("pulse.closed.line_at", { time: time(b.next_open_at) }) : t("pulse.closed.line"))
            : t(`pulse.${level}.line`, { n: num(b.waiting), m: num(est || 5) }))),
        b.open && remote.length ? h("div.p-count", { "data-testid": "fadeet-line" }, h("b.num", num(b.waiting)), h("span", t("pulse.waiting"))) : null),
      quiet && b.open ? h("p.p-hint", icon("leaf"), t("pulse.quiet_today", { hour: hourLabel(quiet.hr), to: hourLabel(quiet.hr + 2) })) : null,
      watch ? h("div.p-watch", { "data-testid": "quiet-watching" }, icon("bell-ringing"),
        h("span.grow", watch.threshold === 0 ? t("pulse.watching_zero") : t("pulse.watching", { n: num(watch.threshold) })),
        h("button.btn.btn-ghost.btn-sm", { type: "button", onclick: () => unwatch(true) }, t("action.cancel"))) : null,
      h("div.p-actions", primary,
        canWatch && !watch ? h("button.btn", { type: "button", "data-testid": "quiet-watch", onclick: quietSheet }, icon("bell"), t("pulse.watch")) : null));
  }

  async function quietSheet() {
    let threshold = 2;
    const opts = [0, 1, 2, 3];
    const chips = h("div.chips", { role: "group", "aria-label": t("pulse.watch_q") }, opts.map((n) =>
      h("button.chip", { type: "button", "aria-pressed": String(n === threshold), "data-n": n,
        onclick: () => { threshold = n; chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(+c.dataset.n === n))); } },
        n === 0 ? t("pulse.opt_zero") : t("pulse.opt_n", { n: num(n) }))));
    const err = h("p.err", { hidden: true });
    const blocked = !pushSupported() ? t("pulse.no_push") : needsInstallForPush() ? t("pulse.ios_hint") : null;
    await openSheet({ title: t("pulse.watch_title"), body: [
      h("p", t("pulse.watch_lead")),
      h("div.field", h("span", t("pulse.watch_q")), chips),
      h("p.muted.small", icon("shield-check"), " ", t("pulse.watch_privacy")),
      blocked ? h("div.banner.warn", icon("info-circle"), h("span", blocked)) : null, err,
    ], actions: [
      { id: "quiet-confirm", label: t("pulse.watch_cta"), primary: true, onClick: async (close) => {
        if (blocked) { err.hidden = false; err.textContent = blocked; return; }
        try {
          const sub = await subscribePush();
          const r = await api.customer("quiet_watch", { public_id: publicId, subscription: sub, threshold, lang: lang() });
          close();
          if (r.already_quiet) { toast(t("pulse.already_quiet")); return; }
          store.set(watchKey(publicId), { threshold, until: Date.now() + 4 * 3600000, endpoint: sub.endpoint, keys: sub.keys });
          vibrate(30);
          toast(t("pulse.watch_on"));
          paint();
        } catch (e) {
          err.hidden = false;
          err.textContent = e.message === "denied" ? t("pulse.denied") : e.message === "unsupported" ? t("pulse.no_push") : errorText(e);
        }
      } },
      { label: t("action.cancel"), ghost: true }] });
  }

  async function unwatch(tellServer) {
    const w = store.get(watchKey(publicId));
    store.del(watchKey(publicId));
    if (tellServer && w?.endpoint) api.customer("quiet_unwatch", { subscription: { endpoint: w.endpoint, keys: w.keys } }).catch(() => {});
    paint();
  }

  /** The watch fires on the server (push); on this page it also shows right away, and in demo mode locally. */
  function checkWatch() {
    const w = store.get(watchKey(publicId));
    if (!w) return;
    if (Date.now() > w.until) { store.del(watchKey(publicId)); return; }
    const b = data.branch;
    if (!b.open || b.waiting > w.threshold) return;
    store.del(watchKey(publicId));
    const body = b.waiting === 0 ? t("pulse.calm_zero") : t("pulse.calm_n", { n: num(b.waiting) });
    vibrate([200, 100, 200]);
    if (api.demo || document.visibilityState !== "visible") localNotify(b.business_name, body, `./s/${publicId}`);
    toast(body);
  }

  function qaCard() {
    const log = h("div.chat", { "aria-live": "polite" });
    const input = h("input", { id: "qa-input", maxlength: 300, placeholder: t("qa.placeholder") });
    const ask = async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      log.append(h("div.bubble.q", q));
      input.value = "";
      const wait = h("div.bubble.a.muted", "…");
      log.append(wait);
      try { wait.textContent = (await api.ai("qa", { public_id: publicId, question: q })).answer; wait.classList.remove("muted"); }
      catch (err) { wait.textContent = errorText(err); }
    };
    return card(t("qa.title"), "message-question", h("p.muted.small", t("qa.lead")), log,
      h("form.row", { onsubmit: ask, style: { flexWrap: "nowrap" } }, h("label.field", { style: { flex: 1 } }, h("span.sr", t("qa.title")), input),
        h("button.btn.btn-primary", { type: "submit", "aria-label": t("qa.send") }, icon("send"))));
  }
}
