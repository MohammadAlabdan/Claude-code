// Staff app /staff (paired device, no account). One-hand controls, device language, offline action queue.
import { h, icon, card, store, skeleton, vibrate, fill } from "../ui/dom.js";
import { t, num, errorText, lang, langDir } from "../i18n.js";
import { NowServingBoard, BusyPill } from "../ui/components.js";
import { openSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { Keypad } from "../ui/keypad.js";
import { QR } from "../ui/qr.js";

const QUEUE_KEY = "dawri.staff.queue";

export async function render(ctx) {
  const { api, shell, nav, name } = ctx;

  if (name === "pair") {
    const tok = location.hash.slice(1);
    if (tok.length >= 20) { store.set("dawri.device", tok); history.replaceState({}, "", "/staff"); return nav("/staff", { replace: true }); }
    return unpaired();
  }
  if (!store.get("dawri.device")) return unpaired();

  shell.content.append(...skeleton(3));
  let state;
  try { state = await api.staff("state"); } catch (e) {
    if (e.code === "device_unpaired") { store.del("dawri.device"); return unpaired(); }
    fill(shell.content, h("div.empty", icon("wifi-off"), h("p", errorText(e)), h("button.btn", { type: "button", onclick: ctx.rerender }, t("action.retry"))));
    return;
  }
  const L = state.device.language;
  await ctx.setLang("staff", L);
  document.documentElement.dir = langDir(L);

  // ---------- offline queue ----------
  const syncDot = h("span.sync-dot", { title: t("sync.ok"), role: "img", "aria-label": t("sync.ok") });
  const offlineBar = h("div.offline-bar", { hidden: navigator.onLine, role: "status" }, t("offline.banner"));
  const pending = () => store.get(QUEUE_KEY, []);
  const setPending = (q) => { store.set(QUEUE_KEY, q); syncDot.classList.toggle("pending", q.length > 0); syncDot.setAttribute("aria-label", q.length ? t("sync.pending", { n: q.length }) : t("sync.ok")); };
  setPending(pending());
  async function flush() {
    let q = pending();
    while (q.length && navigator.onLine) {
      try { await api.staff(q[0].action, q[0].body); } catch (e) { if (e.extra?.offline) break; }
      q = q.slice(1);
      setPending(q);
    }
    if (!q.length) reload();
  }
  async function act(action, body = {}, { quiet = false } = {}) {
    if (!navigator.onLine) {
      setPending([...pending(), { action, body, at: Date.now() }]);
      toast(t("offline.queued"));
      return null;
    }
    try {
      const r = await api.staff(action, body);
      if (!quiet) vibrate(25);
      reload();
      return r;
    } catch (e) {
      if (e.extra?.offline) { setPending([...pending(), { action, body, at: Date.now() }]); offlineBar.hidden = false; toast(t("offline.queued")); return null; }
      toast(L === "ar" ? errorText(e) : e.message_en ?? t("error.generic"), { error: true });
      return null;
    }
  }
  const onOnline = () => { offlineBar.hidden = true; flush(); };
  const onOffline = () => { offlineBar.hidden = false; };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  // ---------- wake lock ----------
  let wake = null;
  const keepAwake = async () => { try { if (document.visibilityState === "visible") wake = await navigator.wakeLock?.request("screen"); } catch { /* unsupported */ } };
  keepAwake();
  document.addEventListener("visibilitychange", keepAwake);

  // ---------- live ----------
  let reloading = false;
  async function reload() {
    if (reloading) return;
    reloading = true;
    try { state = await api.staff("state"); paint(); } catch { /* keep last state */ } finally { reloading = false; }
  }
  const unsub = api.subscribe(state.branch.public_id, reload);
  const poll = setInterval(reload, 15000);
  ctx.onCleanup(() => { unsub(); clearInterval(poll); clearInterval(codeTimer); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); document.removeEventListener("visibilitychange", keepAwake); wake?.release?.(); });

  // ---------- rotating redemption code ----------
  const codeEl = h("span.code.num", "----");
  const ringFg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  ring.setAttribute("viewBox", "0 0 46 46"); ring.classList.add("ring");
  const ringBg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  for (const [c, color] of [[ringBg, "var(--line)"], [ringFg, "var(--accent)"]]) { c.setAttribute("cx", 23); c.setAttribute("cy", 23); c.setAttribute("r", 19); c.style.stroke = color; ring.append(c); }
  ringFg.style.strokeDasharray = String(2 * Math.PI * 19);
  ringFg.style.transform = "rotate(-90deg)"; ringFg.style.transformOrigin = "center";
  let expires = 0;
  async function refreshCode() {
    try { const r = await api.staff("rotating_code"); codeEl.textContent = r.code; expires = Date.now() + r.expires_in * 1000; } catch { /* keep */ }
  }
  const codeTimer = setInterval(() => {
    const left = Math.max(0, expires - Date.now()) / 60000;
    ringFg.style.strokeDashoffset = String(2 * Math.PI * 19 * (1 - left));
    if (left <= 0) refreshCode();
  }, 1000);
  refreshCode();
  const codeCard = h("section.card", { "data-testid": "rotating-code" }, h("div.code-card", ring, h("div.stack", { style: { gap: "2px" } }, h("span.muted.small", t("code.title")), codeEl), h("span.muted.small", { style: { flex: 1 } }, t("code.hint"))));

  // ---------- UI state ----------
  const modes = [...new Set(state.services.map((s) => s.mode))];
  let mode = store.get("dawri.staff.mode") && modes.includes(store.get("dawri.staff.mode")) ? store.get("dawri.staff.mode") : modes[0];
  let providerFilter = state.device.provider_id ?? null;
  const board = NowServingBoard(t("board.now"), { big: true });
  const root = h("div.stack", { style: { gap: "16px" } });
  fill(shell.content, offlineBar, root);
  shell.setActions(syncDot);

  const svc = (id) => state.services.find((s) => s.id === id);
  const prov = (id) => state.providers.find((p) => p.id === id);
  const myCurrent = () => state.tickets.find((x) => x.mode === "remote" && x.called_by_me && ["called", "serving"].includes(x.status));

  function paint() {
    shell.setTitle(state.branch.name);
    const parts = [];
    if (modes.length > 1) parts.push(h("div.seg", { role: "group" }, modes.map((m) => h("button", { type: "button", "aria-pressed": String(m === mode), onclick: () => { mode = m; store.set("dawri.staff.mode", m); paint(); } }, t(`mode.${m}`)))));
    if (mode === "remote") parts.push(...remotePanel());
    if (mode === "receipt") parts.push(...receiptPanel());
    if (mode === "dropoff") parts.push(...dropoffPanel());
    parts.push(busyCard(), codeCard);
    fill(root, ...parts);
  }

  // ---------- remote ----------
  function remotePanel() {
    const current = myCurrent();
    const svcIds = state.services.filter((s) => s.mode === "remote").map((s) => s.id);
    board.update(current?.number ?? null);
    const waiting = state.tickets.filter((x) => x.mode === "remote" && x.status === "waiting" && svcIds.includes(x.service_id)
      && (!providerFilter || !x.provider_id || x.provider_id === providerFilter));
    return [
      board,
      state.providers.length ? h("div.chips", { role: "group", "aria-label": t("provider.filter") },
        h("button.chip", { type: "button", "aria-pressed": String(!providerFilter), onclick: () => { providerFilter = null; paint(); } }, t("provider.all")),
        state.providers.map((p) => h("button.chip", { type: "button", "aria-pressed": String(providerFilter === p.id), onclick: () => { providerFilter = p.id; paint(); } }, p.name))) : null,
      h("button.btn.btn-primary.btn-xl.btn-block", { type: "button", "data-testid": "call-next", style: { minHeight: "96px", fontSize: "2rem" },
        onclick: async () => { const r = await act("call_next", { provider_id: providerFilter }); if (r?.empty) toast(t("queue.empty")); } }, icon("speakerphone"), t("action.call_next")),
      current ? h("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" } },
        h("button.btn", { type: "button", "data-testid": "push-back", onclick: () => act("push_back", { ticket_id: current.id }) }, t("action.push_back")),
        h("button.btn.btn-danger", { type: "button", "data-testid": "no-show", onclick: () => act("no_show", { ticket_id: current.id }) }, t("action.no_show")),
        h("button.btn", { type: "button", "data-testid": "done", onclick: () => act("done", { ticket_id: current.id }) }, icon("check"), t("action.done"))) : null,
      card(t("queue.waiting", { n: num(waiting.length) }), "users",
        waiting.length ? h("div.stack", waiting.map(ticketRow)) : h("p.muted.center", t("queue.empty")),
        h("button.btn.btn-block", { type: "button", "data-testid": "add-walkin", onclick: addWalkIn }, icon("user-plus"), t("action.add_customer"))),
    ];
  }

  function ticketRow(x) {
    let pressTimer;
    const el = h(`div.staff-ticket${x.priority ? ".prio" : ""}`, { role: "button", tabindex: "0", "data-ticket": x.number,
      onclick: () => ticketActions(x),
      onkeydown: (e) => { if (e.key === "Enter") ticketActions(x); },
      onpointerdown: () => { pressTimer = setTimeout(() => { pressTimer = null; vibrate(40); priority(x); }, 600); },
      onpointerup: () => clearTimeout(pressTimer), onpointerleave: () => clearTimeout(pressTimer),
      oncontextmenu: (e) => e.preventDefault() },
      h("span.n", num(x.number)),
      h("div.grow", { style: { flex: 1, minWidth: 0 } },
        h("div", svc(x.service_id)?.name ?? ""),
        h("div.row.small.muted", { style: { gap: "8px" } },
          x.party_size > 1 ? h("span", icon("users"), " ", num(x.party_size)) : null,
          x.provider_id ? h("span", prov(x.provider_id)?.name) : null,
          x.priority ? h("span.badge.warn", t(`priority.${x.priority_reason ?? "other"}`)) : null,
          x.source === "walk_in" ? h("span.badge", t("source.walk_in")) : null)),
      !x.push_enabled ? h("span", { title: t("bell.off"), "data-testid": "bell-off", style: { color: "var(--danger)", fontSize: "1.3rem" } }, icon("bell-off", t("bell.off"))) : null);
    return el;
  }

  async function ticketActions(x) {
    await openSheet({ title: `${t("ticket.number")} ${num(x.number)}`, body: [!x.push_enabled ? h("div.banner.warn", icon("bell-off"), h("span", t("bell.off_hint"))) : null],
      actions: [
        { label: t("action.call_this"), primary: true, onClick: async (close) => { close(); await act("call_ticket", { ticket_id: x.id }); } },
        { label: t("action.priority"), onClick: async (close) => { close(); priority(x); } },
        { label: t("action.push_back"), onClick: async (close) => { close(); await act("push_back", { ticket_id: x.id }); } },
        { label: t("action.no_show"), danger: true, onClick: async (close) => { close(); await act("no_show", { ticket_id: x.id }); } },
        { label: t("action.cancel"), ghost: true }] });
  }

  async function priority(x) {
    const reason = await openSheet({ title: t("priority.title", { n: num(x.number) }), body: [h("p.muted.small", t("priority.lead"))],
      actions: ["elderly", "pregnant", "disability", "other"].map((r) => ({ id: `prio-${r}`, label: t(`priority.${r}`), value: r })).concat([{ label: t("action.cancel"), ghost: true }]) });
    if (reason) { await act("set_priority", { ticket_id: x.id, reason }); toast(t("priority.done")); }
  }

  async function addWalkIn() {
    const remote = state.services.filter((s) => s.mode === "remote");
    let party = 1;
    const sel = h("select", { id: "walkin-service" }, remote.map((s) => h("option", { value: s.id }, s.name)));
    const provSel = state.providers.length ? h("select", { id: "walkin-provider" }, h("option", { value: "" }, t("provider.all")), state.providers.map((p) => h("option", { value: p.id, selected: p.id === providerFilter }, p.name))) : null;
    const out = h("output.big-num", num(1));
    const familyOk = state.branch.features.includes("family_ticket");
    const r = await openSheet({ title: t("walkin.title"), body: [
      h("label.field", h("span", t("walkin.service")), sel),
      provSel ? h("label.field", h("span", t("walkin.provider")), provSel) : null,
      familyOk ? h("div.row", { style: { justifyContent: "center", gap: "18px" } },
        h("button.icon-btn", { type: "button", style: { border: "1.5px solid var(--line)" }, onclick: () => { party = Math.max(1, party - 1); out.textContent = num(party); } }, icon("minus")), out,
        h("button.icon-btn", { type: "button", style: { border: "1.5px solid var(--line)" }, onclick: () => { party = Math.min(6, party + 1); out.textContent = num(party); } }, icon("plus"))) : null],
      actions: [{ id: "walkin-confirm", label: t("walkin.cta"), primary: true, onClick: async (close) => close(await act("add_walk_in", { service_id: sel.value, party_size: party, provider_id: provSel?.value || null })) },
        { label: t("action.cancel"), ghost: true }] });
    if (r?.number) {
      openSheet({ title: t("walkin.say"), body: [h("div.center", { "data-testid": "walkin-number" }, h("div", { style: { font: "400 7rem/1 var(--f-display)" } }, num(r.number)),
        h("p.muted", t("walkin.ahead", { n: num(r.position) })))], actions: [{ label: t("action.ok"), primary: true }] });
    }
  }

  // ---------- receipt ----------
  function receiptPanel() {
    const waitingCodes = state.tickets.filter((x) => x.mode === "receipt" && x.status === "waiting");
    return [
      card(t("receipt.title"), "receipt",
        h("p.muted.small", t("receipt.lead")),
        Keypad({ enterLabel: t("action.ready"), onEnter: async (code, reset) => {
          const r = await act("mark_ready", { receipt_code: code });
          if (r || !navigator.onLine) { toast(t("receipt.marked", { n: num(code) })); reset(); }
        } })),
      state.ready_numbers.length ? card(t("receipt.last_ready"), "bell-ringing", h("div.chips", state.ready_numbers.map((c) => h("span.chip", { style: { cursor: "default" } }, num(c))))) : null,
      waitingCodes.length ? card(t("receipt.waiting"), "clock", h("div.chips", waitingCodes.map((x) => h("button.chip", { type: "button", onclick: async () => { await act("mark_ready", { receipt_code: x.receipt_code }); toast(t("receipt.marked", { n: num(x.receipt_code) })); } },
        num(x.receipt_code), !x.push_enabled ? icon("bell-off", t("bell.off")) : null)))) : null,
    ];
  }

  // ---------- dropoff ----------
  function dropoffPanel() {
    const items = state.tickets.filter((x) => x.mode === "dropoff");
    const next = { received: "in_progress", in_progress: "ready", ready: "picked_up" };
    return [
      h("button.btn.btn-primary.btn-xl.btn-block", { type: "button", "data-testid": "dropoff-new", onclick: newDropoff }, icon("car"), t("dropoff.new")),
      card(t("dropoff.items", { n: num(items.length) }), "list",
        items.length ? h("div.stack", items.map((x) => h("div.staff-ticket", { "data-ticket": x.number },
          h("span.n", num(x.number)),
          h("div", { style: { flex: 1, minWidth: 0 } }, h("div", x.item_label), h("div.small.muted", state.labels[x.stage] ?? x.stage)),
          next[x.stage] ? h("button.btn", { type: "button", "data-testid": `stage-${next[x.stage]}`, onclick: () => act("dropoff_stage", { ticket_id: x.id, stage: next[x.stage] }) }, t(`stage.${next[x.stage]}`)) : null))) : h("p.muted.center", t("dropoff.empty"))),
    ];
  }

  async function newDropoff() {
    const svcs = state.services.filter((s) => s.mode === "dropoff");
    const sel = h("select", { id: "dropoff-service" }, svcs.map((s) => h("option", { value: s.id }, s.name)));
    const label = h("input", { id: "dropoff-label", maxlength: 60, placeholder: t("dropoff.label_ph") });
    const err = h("p.err", { hidden: true });
    const r = await openSheet({ title: t("dropoff.new"), body: [h("label.field", h("span", t("dropoff.service")), sel), h("label.field", h("span", t("dropoff.label")), label, err)],
      actions: [{ id: "dropoff-create", label: t("dropoff.create"), primary: true, onClick: async (close) => {
        if (!label.value.trim()) { err.hidden = false; err.textContent = t("dropoff.label_required"); return; }
        close(await act("dropoff_create", { service_id: sel.value, item_label: label.value.trim() }));
      } }, { label: t("action.cancel"), ghost: true }] });
    if (r?.claim_url) {
      openSheet({ title: t("dropoff.scan", { n: num(r.number) }), body: [h("p.muted.small.center", t("dropoff.scan_hint")), QR(r.claim_url, { label: t("dropoff.scan_hint") }),
        h("p.small.center", { style: { wordBreak: "break-all", direction: "ltr" }, "data-testid": "claim-url" }, r.claim_url)], actions: [{ label: t("action.ok"), primary: true }] });
    }
  }

  // ---------- busy level ----------
  function busyCard() {
    const cur = state.branch.manual_busy ?? null;
    return card(t("busy.title"), "gauge",
      h("div.row", h("span.muted.small", t("busy.now")), BusyPill(state.branch.busy_level)),
      h("div.seg", { role: "group" }, [[null, t("busy.auto")], ["free", t("busy.free")], ["some", t("busy.some")], ["busy", t("busy.busy")]].map(([lv, label]) =>
        h("button", { type: "button", "aria-pressed": String(cur === lv), onclick: () => act("set_busy", { level: lv }) }, label))));
  }

  paint();
  if (pending().length && navigator.onLine) flush();

  function unpaired() {
    shell.setTitle(t("app.title"));
    fill(shell.content, h("div.empty", { style: { paddingTop: "48px" } }, icon("device-mobile-off"), h("h2", t("unpaired.title")), h("p", t("unpaired.lead"))));
  }
}
