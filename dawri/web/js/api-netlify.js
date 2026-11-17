// Real backend on Netlify: Netlify Functions + Netlify Database. Same interface as api.js / demo-api.js.
// Differences from Supabase: our own owner login (/api/auth), polling instead of Realtime, photos in Netlify Blobs.
import { ApiError } from "./errors.js";
import { store } from "./ui/dom.js";

const SESSION = "dawri.session";
const base = () => new URL(".", document.baseURI).href.replace(/\/$/, "");

export async function createApi(cfg = {}) {
  const authCbs = new Set();
  // push public key comes from the server (generated there, see deploy/netlify/lib/secrets.mts)
  if (!cfg.VAPID_PUBLIC_KEY) {
    try { cfg.VAPID_PUBLIC_KEY = (await (await fetch(`${base()}/api/config`)).json()).vapid_public_key ?? ""; } catch { /* offline: push stays off */ }
  }
  const session = () => {
    const s = store.get(SESSION);
    if (s && s.expires_at * 1000 > Date.now()) return s;
    if (s) store.del(SESSION);
    return null;
  };
  const setSession = (s) => { if (s) store.set(SESSION, s); else store.del(SESSION); authCbs.forEach((cb) => cb(session())); };

  async function post(path, body, extraHeaders = {}) {
    const s = session();
    let res;
    try {
      res = await fetch(`${base()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(s ? { Authorization: `Bearer ${s.access_token}` } : {}), ...extraHeaders },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError("network", { message_ar: "ما فيه اتصال بالإنترنت", message_en: "No internet connection", offline: true });
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && s && path !== "/api/auth") setSession(null);
    if (!res.ok || data?.error) throw new ApiError(data?.error ?? "server_error", data ?? {});
    return data;
  }
  const fn = (name, body, headers) => post(`/functions/v1/${name}`, body, headers);

  return {
    demo: false,
    noMagicLink: true,
    demoAccounts: cfg.SHOW_DEMO_ACCOUNTS === true,
    publicBranch: (publicId) => post("/api/rpc/public_branch", { p_public_id: publicId }),
    publicTicket: (token) => post("/api/rpc/public_ticket", { p_token: token }),
    customer: (action, body = {}) => fn("customer", { action, ...body }),
    staff: (action, body = {}) => fn("staff", { action, ...body }, { "x-device-token": store.get("dawri.device") ?? "" }),
    owner: (action, body = {}) => fn("owner", { action, ...body }),
    onboard: (body) => fn("onboard", body),
    ai: (action, body = {}) => fn("ai", { action, ...body }),
    admin: (action, body = {}) => fn("admin", { action, ...body }),
    auth: {
      async session() { return session(); },
      async signIn(email, password) { const s = await post("/api/auth", { action: "signin", email, password }); setSession(s); return s; },
      async signUp(email, password) { const s = await post("/api/auth", { action: "signup", email, password }); setSession(s); return s; },
      async magicLink() { throw new ApiError("invalid_input", { message_ar: "الدخول برابط البريد غير متاح هنا، ادخل بكلمة المرور", message_en: "Use your password to sign in" }); },
      async signOut() { setSession(null); },
      async updateAccount({ current_password, email, password }) {
        const s = session();
        const res = await post("/api/auth", { action: "update", current_password, email, password }, s ? { Authorization: `Bearer ${s.access_token}` } : {});
        setSession(res); return res;
      },
      onChange(cb) { authCbs.add(cb); return () => authCbs.delete(cb); },
    },
    // No Realtime on Netlify: refresh while the page is visible, right away when it comes back.
    // `every` (ms, or a function returning ms) lets each screen poll only as often as it needs:
    // a ticket far from its turn asks every 15s, one about to be called every 4s. Hidden pages never ask.
    subscribe(_publicId, cb, every = 4000) {
      let last = 0;
      const gap = () => Math.max(3000, Number(typeof every === "function" ? every() : every) || 4000);
      const tick = () => { if (document.visibilityState === "visible" && Date.now() - last >= gap() - 300) { last = Date.now(); cb(); } };
      const timer = setInterval(tick, 1000);
      const onVis = () => { if (document.visibilityState === "visible") { last = 0; tick(); } };
      document.addEventListener("visibilitychange", onVis);
      return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
    },
    async uploadPhoto(branchId, file) {
      const s = session();
      const res = await fetch(`${base()}/api/photo?branch_id=${encodeURIComponent(branchId)}`, {
        method: "POST", headers: { "Content-Type": file.type, ...(s ? { Authorization: `Bearer ${s.access_token}` } : {}) }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(data.error ?? "invalid_input", { message_ar: data.message_ar ?? "تعذّر رفع الصورة" });
      return data.path;
    },
    // platform admin: system health and the daily database backups
    system: {
      health: async () => (await fetch(`${base()}/api/health`, { cache: "no-store" })).json(),
      backups: async () => { const s = session(); const r = await fetch(`${base()}/api/backup`, { headers: s ? { Authorization: `Bearer ${s.access_token}` } : {} }); if (!r.ok) throw new ApiError(r.status === 403 ? "forbidden" : "unauthorized"); return (await r.json()).backups; },
      backupNow: () => post("/api/backup", {}),
      async download(key) {
        const s = session();
        const r = await fetch(`${base()}/api/backup/${encodeURIComponent(key)}`, { headers: s ? { Authorization: `Bearer ${s.access_token}` } : {} });
        if (!r.ok) throw new ApiError("not_found");
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(await r.blob()), download: `jay-backup-${key}` });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      },
    },
    photoUrl: (path) => (/^(https?:|data:)/.test(path) ? path : `${base()}/api/photo/${path}`),
  };
}
