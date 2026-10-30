// Ticket page /t/{token} (and /c/{claim} for dropoff claim links). Live via Broadcast + 20 s polling.
import { h, icon, card, store, skeleton, vibrate, fill } from "../ui/dom.js";
import { t, num, errorText, lang } from "../i18n.js";
import { TicketCard, NowServingBoard, QueueLine, StageTracker } from "../ui/components.js";
import { openSheet, confirmSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { subscribePush, needsInstallForPush, pushSupported, localNotify, unlockAudio, chime } from "../ui/push.js";
import { langToggle } from "./shop.js";

export async function render(ctx) {
  const { api, params, shell, nav, name } = ctx;
  shell.setActions(langToggle(ctx.rerender));

  if (name === "claim") {
    shell.content.append(...skeleton(2));
    try {
      const r = await api.customer("claim_dropoff", { claim_token: params[0] });
      store.set(`dawri.ticket.${r.ticket.branch.public_id}`, r.ticket_token);
      return nav(`/t/${r.ticket_token}`, { replace: true });
    } catch (e) {
      fill(shell.content, h("div.empty", icon("link-off"), h("p", errorText(e)), h("p.muted.small", t("claim.used"))));
      return;
    }
  }

  const token = params[0];
  let tk, prev = null, overlayShown = null, pushDenied = false;
  shell.content.append(...skeleton(3));

  const board = NowServingBoard(t("ticket.now_serving"));
  const line = QueueLine();
  const root = h("div.stack", { style: { gap: "16px" } });

  async function load() {
    tk = await api.publicTicket(token);
    store.set(`dawri.ticket.${tk.branch.public_id}`, token);
    paint();
    react();
    prev = tk;
  }
  try { await load(); } catch (e) {
    fill(shell.content, h("div.empty", icon("ticket-off"), h("p", errorText(e)), h("a.btn", { href: "/" }, t("action.home"))));
    return;
  }
  fill(shell.content, root);

  const unsub = api.subscribe(tk.branch.public_id, () => load().catch(() => {}));
  const poll = setInterval(() => load().catch(() => {}), 20000);
  const onVis = () => document.visibilityState === "visible" && load().catch(() => {});
  const unlock = () => unlockAudio();
  document.addEventListener("visibilitychange", onVis);
  document.addEventListener("pointerdown", unlock, { once: true });
  ctx.onCleanup(() => { unsub(); clearInterval(poll); document.removeEventListener("visibilitychange", onVis); document.removeEventListener("pointerdown", unlock); });

  // Transitions: return-now, called, ready. Vibrate/sound/local notification once per state.
  function react() {
    const was = prev;
    const alertOnce = (key, title, body) => {
      if (overlayShown === key) return false;
      overlayShown = key;
      vibrate([300, 120, 300, 120, 300]);
      chime();
      if (document.visibilityState !== "visible" || api.demo) localNotify(tk.branch.name, body ?? title, `/t/${token}`);
      return true;
    };
    if (tk.mode === "remote" && tk.called && (!was || !was.called)) {
      if (alertOnce(`called-${tk.called_at}`, t("ticket.your_turn"))) showOverlay(t("ticket.your_turn"), tk.number);
    } else if (tk.ready && (!was || !was.ready)) {
      const msg = tk.mode === "dropoff" ? t("ticket.ready_pickup") : t("ticket.order_ready");
      if (alertOnce(`ready-${tk.id}`, msg)) showOverlay(msg, tk.mode === "receipt" ? tk.receipt_code : tk.number);
    } else if (tk.return_now && was && !was.return_now) {
      vibrate([200, 100, 200]);
      if (document.visibilityState !== "visible" || api.demo) localNotify(tk.branch.name, t("ticket.return_now"), `/t/${token}`);
    }
  }

  function showOverlay(message, number) {
    document.querySelector(".called")?.remove();
    const el = h("div.called", { role: "alertdialog", "aria-live": "assertive", "aria-label": message, "data-testid": "called-overlay" },
      h("div.c-inner", h("div.c-num.num", num(number)), h("div.c-msg", message),
        h("button.btn.btn-xl", { type: "button", style: { background: "var(--on-accent)", color: "var(--accent)", borderColor: "transparent", minWidth: "60%" },
          onclick: () => el.remove() }, t("action.ok"))));
    document.body.append(el);
    ctx.onCleanup(() => el.remove());
  }

  function statusLine() {
    if (tk.mode === "receipt") return tk.ready ? t("ticket.order_ready") : t("ticket.preparing");
    if (tk.mode === "dropoff") return t(`stage.${tk.stage ?? "received"}`);
    switch (tk.status) {
      case "waiting": return tk.position === 0 ? t("ticket.next") : t("ticket.ahead", { n: num(tk.position) });
      case "called": case "serving": return t("ticket.your_turn");
      case "done": return t("ticket.done");
      case "left": return t("ticket.left");
      case "no_show": return t("ticket.no_show");
      default: return t("ticket.cancelled");
    }
  }

  function paint() {
    shell.setTitle(tk.branch.business_name);
    const waiting = tk.mode === "remote" && tk.status === "waiting";
    const active = ["waiting", "called", "serving"].includes(tk.status) || (tk.mode === "dropoff" && tk.status !== "done" && tk.status !== "cancelled");
    board.update(tk.mode === "remote" ? tk.now_serving : null);
    line.update(tk.position ?? 0);

    fill(root, 
      tk.mode === "remote" && active ? board : null,
      waiting && tk.return_now ? h("div.banner.warn", { "data-testid": "return-now", role: "alert" }, icon("walk"), h("span", t("ticket.return_now"))) : null,

      TicketCard({
        label: tk.mode === "receipt" ? t("ticket.order_number") : tk.mode === "dropoff" ? t("ticket.your_number") : t("ticket.your_number"),
        number: tk.mode === "receipt" ? tk.receipt_code : tk.number,
        status: statusLine(),
        estimate: waiting ? t("ticket.estimate", { m: num(tk.estimate_min) }) : null,
        alert: waiting && tk.return_now,
      }),

      waiting ? h("section.card", { "aria-label": t("ticket.line") }, line,
        h("p.muted.small.center", [tk.service.name, tk.provider?.name, tk.party_size > 1 ? t("ticket.party", { n: num(tk.party_size) }) : null].filter(Boolean).join(" · "))) : null,

      tk.mode === "dropoff" ? card(tk.item_label, "car", StageTracker(["received", "in_progress", "ready", "picked_up"].map((k) => ({ key: k, label: t(`stage.${k}`) })), tk.stage)) : null,

      active ? pushCard() : null,
      active && tk.offers.length ? offersCard() : null,

      waiting ? h("div.grid2",
        tk.features.includes("late_button") ? h("button.btn", { type: "button", "data-testid": "late", disabled: tk.snooze_left < 1, onclick: late }, icon("clock-plus"), t("ticket.late")) : null,
        h("button.btn.btn-danger", { type: "button", "data-testid": "leave", onclick: leave }, icon("door-exit"), t("ticket.leave"))) : null,

      tk.status === "done" ? afterCards() : null,
      ["left", "no_show", "cancelled"].includes(tk.status) ? h("a.btn.btn-primary.btn-block", { href: `/s/${tk.branch.public_id}?stay` }, t("ticket.new_number")) : null,
      h("a.btn.btn-ghost.btn-block", { href: `/s/${tk.branch.public_id}?stay` }, icon("building-store"), t("ticket.shop_page")),
    );
  }

  function pushCard() {
    if (tk.push_enabled) return h("div.banner.ok", { "data-testid": "push-on" }, icon("bell-check"), h("span", t("push.on")));
    if (pushDenied || !pushSupported()) {
      return h("div.banner.warn", { "data-testid": "push-off" }, icon("bell-off"), h("span", t("push.off")));
    }
    return h("section.card", { "data-testid": "push-card" },
      h("div.card-head", icon("bell-ringing"), h("h3", t("push.title"))),
      h("p.muted.small", t("push.lead")),
      h("button.btn.btn-primary.btn-block", { type: "button", "data-testid": "enable-push", onclick: enablePush }, icon("bell"), t("push.cta")));
  }

  async function enablePush() {
    unlockAudio();
    if (needsInstallForPush()) {
      openSheet({ title: t("push.ios_title"), body: [h("ol.steps-guide",
        h("li", h("span", t("push.ios_step1")), icon("share")),
        h("li", h("span", t("push.ios_step2")), icon("square-plus")))], actions: [{ label: t("action.ok"), primary: true }] });
      return;
    }
    try {
      const sub = await subscribePush();
      await api.customer("subscribe_push", { token, subscription: sub });
      toast(t("push.enabled_toast"));
      await load();
    } catch (e) {
      pushDenied = e?.message === "denied" || e?.message === "unsupported";
      if (!pushDenied) toast(errorText(e), { error: true });
      paint();
    }
  }

  function offersCard() {
    return card(t("ticket.offers"), "discount", h("div.list", tk.offers.map((o) => h("div.list-item",
      h("div.grow", h("div.title", o.title), o.terms ? h("div.muted.small", o.terms) : null),
      o.discount_text ? h("span.badge", o.discount_text) : null,
      h("button.btn", { type: "button", onclick: () => redeem({ offer_id: o.id, title: o.title }) }, t("redeem.use"))))));
  }

  async function redeem(target) {
    const input = h("input", { id: "redeem-code", inputmode: "numeric", maxlength: 4, autocomplete: "one-time-code", dir: "ltr", placeholder: "0000",
      style: { fontSize: "2rem", textAlign: "center", letterSpacing: ".3em", fontFamily: "var(--f-led)" } });
    const err = h("p.err", { hidden: true });
    await openSheet({ title: t("redeem.title", { title: target.title }), body: [h("p.muted", t("redeem.lead")), h("label.field", h("span", t("redeem.code")), input, err)],
      actions: [{ id: "redeem-confirm", label: t("redeem.confirm"), primary: true, onClick: async (close) => {
        const code = input.value.replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).trim();
        if (!/^\d{4}$/.test(code)) { err.hidden = false; err.textContent = t("redeem.four_digits"); return; }
        try {
          const r = await api.customer("redeem", target.loyalty ? { token, loyalty: true, code } : { token, offer_id: target.offer_id, code });
          close();
          vibrate(60);
          openSheet({ title: t("redeem.done"), body: [h("div.empty", { style: { color: "var(--accent)" } }, icon("circle-check"), h("p", { style: { fontWeight: 700, color: "var(--ink)" } }, r.title))],
            actions: [{ label: t("action.ok"), primary: true }] });
          load();
        } catch (e) { err.hidden = false; err.textContent = errorText(e); }
      } }, { label: t("action.cancel"), ghost: true }] });
  }

  async function late() {
    const choice = await openSheet({ title: t("late.title"), body: [h("p.muted", t("late.lead")), h("p.small", t("late.left", { n: num(tk.snooze_left) }))],
      actions: [{ id: "late-1", label: t("late.one"), primary: true, value: 1 }, { id: "late-2", label: t("late.two"), value: 2 }, { label: t("action.cancel"), ghost: true }] });
    if (!choice) return;
    try { await api.customer("snooze", { token, steps: choice }); toast(t("late.done")); await load(); }
    catch (e) { toast(errorText(e), { error: true }); }
  }

  async function leave() {
    if (!(await confirmSheet(t("leave.title"), t("leave.lead"), t("leave.confirm"), t("action.cancel"), true))) return;
    try { await api.customer("leave", { token }); store.del(`dawri.ticket.${tk.branch.public_id}`); toast(t("leave.done")); await load(); }
    catch (e) { toast(errorText(e), { error: true }); }
  }

  // ---------- after service: feedback → loyalty ----------
  function afterCards() {
    const out = [];
    const f = tk.features;
    if (f.includes("feedback") && !tk.feedback) out.push(feedbackCard());
    else if (tk.feedback?.positive && afterCards.reviewUrl) out.push(h("a.btn.btn-primary.btn-block", { href: afterCards.reviewUrl, target: "_blank", rel: "noopener", "data-testid": "google-review" }, icon("brand-google"), t("feedback.google")));
    if (f.includes("loyalty")) {
      if (tk.loyalty) out.push(loyaltyCard());
      else if (!tk.has_phone && (tk.feedback || !f.includes("feedback")) && !store.get("dawri.loyalty.skip")) out.push(loyaltyPrompt());
    }
    if (!f.includes("feedback") && !f.includes("loyalty")) out.push(h("p.hand.center", t("ticket.thanks")));
    return out;
  }

  function feedbackCard() {
    const reasons = ["long_wait", "quality", "treatment", "price", "other"];
    let reason = null;
    const note = h("textarea", { id: "fb-note", maxlength: 280, placeholder: t("feedback.note") });
    const negative = h("div.stack", { hidden: true },
      h("p.small", t("feedback.why")),
      h("div.chips", reasons.map((r) => h("button.chip", { type: "button", "aria-pressed": "false", "data-reason": r, onclick: (e) => {
        reason = r;
        negative.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === e.currentTarget)));
      } }, t(`reason.${r}`)))),
      h("label.field", h("span.sr", t("feedback.note")), note),
      h("button.btn.btn-primary", { type: "button", "data-testid": "fb-send", onclick: () => send(false) }, t("feedback.send")));
    async function send(positive) {
      try {
        const r = await api.customer("feedback", { token, positive, reason: positive ? null : reason ?? "other", note: positive ? null : note.value.trim() || null });
        afterCards.reviewUrl = r.google_review_url;
        toast(t("feedback.thanks"));
        await load();
      } catch (e) { toast(errorText(e), { error: true }); }
    }
    return h("section.card", { "data-testid": "feedback-card" },
      h("div.card-head", icon("message-heart"), h("h3", t("feedback.title"))),
      h("div.grid2",
        h("button.btn", { type: "button", "data-testid": "fb-up", style: { fontSize: "1.6rem" }, onclick: () => send(true), "aria-label": t("feedback.good") }, "👍"),
        h("button.btn", { type: "button", "data-testid": "fb-down", style: { fontSize: "1.6rem" }, "aria-label": t("feedback.bad"), onclick: () => { negative.hidden = false; } }, "👎")),
      negative);
  }

  function loyaltyPrompt() {
    const phone = h("input", { id: "loyalty-phone", type: "tel", inputmode: "tel", placeholder: "05XXXXXXXX", dir: "ltr", maxlength: 14 });
    const consent = h("input", { id: "loyalty-consent", type: "checkbox" });
    const err = h("p.err", { hidden: true });
    return h("section.card", { "data-testid": "loyalty-prompt" },
      h("div.card-head", icon("gift"), h("h3", t("loyalty.title"))),
      h("p.muted.small", t("loyalty.lead")),
      h("label.field", h("span", t("loyalty.phone")), phone),
      h("label.check", consent, h("span", t("loyalty.consent"))),
      err,
      h("div.grid2",
        h("button.btn.btn-primary", { type: "button", onclick: async () => {
          if (!consent.checked) { err.hidden = false; err.textContent = t("loyalty.need_consent"); return; }
          try { await api.customer("set_phone", { token, phone: phone.value, consent: true }); toast(t("loyalty.saved")); await load(); }
          catch (e) { err.hidden = false; err.textContent = errorText(e); }
        } }, t("loyalty.join")),
        h("button.btn.btn-ghost", { type: "button", onclick: () => { store.set("dawri.loyalty.skip", true); paint(); } }, t("loyalty.skip"))));
  }

  function loyaltyCard() {
    const l = tk.loyalty;
    return h("section.card", { "data-testid": "loyalty-card" },
      h("div.card-head", icon("gift"), h("h3", t("loyalty.progress_title"))),
      h("div.row.between", h("span.big-num", t("loyalty.progress", { v: num(Math.min(l.visits, l.goal)), g: num(l.goal) })), h("span.muted.small", l.reward_text)),
      h("div.dots", Array.from({ length: l.goal }, (_, i) => h(`span${i < l.visits ? ".on" : ""}`))),
      l.reward_available ? h("button.btn.btn-primary.btn-block", { type: "button", onclick: () => redeem({ loyalty: true, title: l.reward_text }) }, t("redeem.use")) : null);
  }
}
