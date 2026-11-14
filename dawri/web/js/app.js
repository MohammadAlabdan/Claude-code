// App shell: router, top bar, tab bar, theme, language, API selection (real or demo), service worker.
import { h, icon, store, fill } from "./ui/dom.js";
import { langDir, loadStrings, setArabicDigits, t } from "./i18n.js";

const cfg = window.DAWRI_CONFIG ?? {};
const appEl = document.getElementById("app");
let apiPromise;
export function getApi() {
  apiPromise ??= (cfg.DEMO_MODE ? import("./demo-api.js") : cfg.BACKEND === "netlify" ? import("./api-netlify.js") : import("./api.js")).then((m) => m.createApi(cfg));
  return apiPromise;
}

// ---------- theme ----------
export function setTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
  store.set("dawri.theme", theme ?? null);
  if (!theme) store.del("dawri.theme");
}
export const currentTheme = () => document.documentElement.dataset.theme ?? null;

// ---------- routes ----------
const ROUTES = [
  [/^\/$/, "home"],
  [/^\/s\/([a-z0-9]{4,16})\/?$/i, "shop"],
  [/^\/t\/([\w-]{20,100})\/?$/, "ticket"],
  [/^\/c\/([\w-]{20,100})\/?$/, "claim"],
  [/^\/staff\/pair\/?$/, "pair"],
  [/^\/staff\/?$/, "staff"],
  [/^\/owner\/poster\/?$/, "poster"],
  [/^\/owner(?:\/(home|queue|offers|pulse|settings))?\/?$/, "owner"],
  [/^\/start\/?$/, "onboard"],
  [/^\/admin\/?$/, "admin"],
  [/^\/dev\/ui\/?$/, "devui"],
];
const MODULES = {
  home: () => import("./screens/home.js"), shop: () => import("./screens/shop.js"), ticket: () => import("./screens/ticket.js"),
  claim: () => import("./screens/ticket.js"), pair: () => import("./screens/staff.js"), staff: () => import("./screens/staff.js"),
  owner: () => import("./screens/owner.js"), poster: () => import("./screens/poster.js"), onboard: () => import("./screens/onboard.js"),
  admin: () => import("./screens/admin.js"), devui: () => import("./screens/devui.js"),
};

let cleanup = [];
let renderToken = 0;

// The app can live at "/" (Netlify, VPS) or under a sub-path such as "/Claude-code/" (GitHub Pages);
// <base href> in index.html says which. Routes below are matched relative to it.
const BASE_PATH = new URL(document.baseURI).pathname;
const appPath = () => "/" + (location.pathname.startsWith(BASE_PATH) ? location.pathname.slice(BASE_PATH.length) : location.pathname.slice(1));

export function nav(path, { replace = false } = {}) {
  if (new URL(path, document.baseURI).href === location.href) return render();
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  render();
}

/** Shell pieces a screen can use. */
function makeShell(lang, demo) {
  const titleEl = h("h1");
  const actions = h("div.actions");
  const top = h("header.topbar", h("a.brand", { href: "./", "aria-label": "دوري" }, h("img", { src: "./assets/logo.svg", alt: "" })), titleEl, actions);
  const content = h("main.content", { id: "main", tabindex: "-1" });
  const tabbar = h("nav.tabbar", { hidden: true, "aria-label": "tabs" });
  // Customer and owner pages: say plainly when the connection drops (the staff screen has its own queueing bar).
  const offline = location.pathname.includes("/staff") ? null
    : h("div.offline-bar.soft", { role: "status", hidden: navigator.onLine, "data-testid": "offline-strip" },
      lang === "ar" ? "انقطع الإنترنت عندك… دورك محفوظ عندنا، والصفحة ترجع تتحدّث أول ما يرجع الاتصال" : "You're offline. Your turn is safe with us; this page updates again once you're back online");
  if (offline && !window.__dawriOffline) {
    window.__dawriOffline = true;
    window.addEventListener("offline", () => document.querySelectorAll("[data-testid=offline-strip]").forEach((e) => (e.hidden = false)));
    window.addEventListener("online", () => document.querySelectorAll("[data-testid=offline-strip]").forEach((e) => (e.hidden = true)));
  }
  fill(appEl, demo ? h("div.demo-strip", { role: "note" }, "وضع تجريبي · بيانات للعرض فقط") : null, offline, top, content, tabbar);
  appEl.classList.remove("has-tabs", "wide");
  document.documentElement.lang = lang;
  document.documentElement.dir = langDir(lang);
  return {
    content, top, app: appEl,
    setTitle(text) { titleEl.textContent = text ?? ""; document.title = text ? `${text} · دوري` : "دوري"; },
    setActions(...nodes) { fill(actions, ...nodes.flat().filter(Boolean)); },
    hideTop() { top.hidden = true; },
    setTabs(tabs, current) {
      tabbar.hidden = !tabs?.length;
      appEl.classList.toggle("has-tabs", !!tabs?.length);
      fill(tabbar, ...(tabs ?? []).map((tb) => h("a.tab", { href: tb.href, "aria-current": tb.key === current ? "page" : null, "data-tab": tb.key }, icon(tb.icon), h("span", tb.label))));
    },
  };
}

async function render() {
  const my = ++renderToken;
  cleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  cleanup = [];
  const path = appPath();
  let name = "home", params = [];
  for (const [re, n] of ROUTES) { const m = path.match(re); if (m) { name = n; params = m.slice(1); break; } }
  if (!ROUTES.some(([re]) => re.test(path))) name = "notfound";

  const ns = ["staff", "pair"].includes(name) ? "staff" : "customer";
  const lang = ns === "staff" ? "ar" : (["shop", "ticket", "claim", "home"].includes(name) ? store.get("dawri.lang", "ar") : "ar");
  await loadStrings(ns, lang);
  setArabicDigits(true);
  if (my !== renderToken) return;
  const api = await getApi();
  if (my !== renderToken) return;
  const shell = makeShell(lang, api.demo);

  if (name === "notfound") {
    shell.setTitle("دوري");
    shell.content.append(h("div.empty", icon("map-pin-off"), h("p", "الصفحة غير موجودة"), h("a.btn.btn-primary", { href: "./" }, "الرئيسية")));
    return;
  }
  const mod = await MODULES[name]();
  if (my !== renderToken) return;
  const ctx = {
    api, params, name, nav, shell, cfg,
    onCleanup: (fn) => cleanup.push(fn),
    async setLang(nsName, l) { await loadStrings(nsName, l); document.documentElement.lang = l; document.documentElement.dir = langDir(l); },
    rerender: render,
  };
  try {
    await (mod.render ?? mod.default)(ctx);
  } catch (e) {
    console.error(e);
    fill(shell.content, h("div.empty", icon("alert-triangle"), h("p", e?.message_ar ?? t("error.generic")),
      h("button.btn", { type: "button", onclick: render }, t("action.retry"))));
  }
}

// internal links without full reloads
document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[href]");
  if (!a || a.target || a.hasAttribute("download") || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || /^(tel|mailto):/.test(a.getAttribute("href"))) return;
  e.preventDefault();
  nav(url.pathname + url.hash);
});
window.addEventListener("popstate", render);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* optional */ });
}
render();
