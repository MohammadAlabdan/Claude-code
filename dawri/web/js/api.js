// Real backend: Supabase public RPCs, Edge Functions, Auth, Realtime Broadcast and Storage.
import { ApiError } from "./errors.js";
import { store } from "./ui/dom.js";

const SUPABASE_ESM = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

export async function createApi(cfg) {
  const { createClient } = await import(SUPABASE_ESM);
  const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

  async function fn(name, body, extraHeaders = {}) {
    const { data: { session } } = await sb.auth.getSession();
    let res;
    try {
      res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.SUPABASE_ANON_KEY,
                   Authorization: `Bearer ${session?.access_token ?? cfg.SUPABASE_ANON_KEY}`, ...extraHeaders },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError("network", { message_ar: "ما فيه اتصال بالإنترنت", message_en: "No internet connection", offline: true });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new ApiError(data?.error ?? "server_error", data ?? {});
    return data;
  }

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new ApiError("server_error");
    if (data?.error) throw new ApiError(data.error, data);
    return data;
  }

  return {
    demo: false,
    publicBranch: (publicId) => rpc("public_branch", { p_public_id: publicId }),
    publicTicket: (token) => rpc("public_ticket", { p_token: token }),
    customer: (action, body = {}) => fn("customer", { action, ...body }),
    staff: (action, body = {}) => fn("staff", { action, ...body }, { "x-device-token": store.get("dawri.device") ?? "" }),
    owner: (action, body = {}) => fn("owner", { action, ...body }),
    onboard: (body) => fn("onboard", body),
    ai: (action, body = {}) => fn("ai", { action, ...body }),
    admin: (action, body = {}) => fn("admin", { action, ...body }),
    auth: {
      async session() { return (await sb.auth.getSession()).data.session; },
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new ApiError("unauthorized", { message_ar: "البريد أو كلمة المرور غير صحيحة", message_en: error.message });
        return data.session;
      },
      async signUp(email, password) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/start` } });
        if (error) throw new ApiError("invalid_input", { message_ar: "تعذّر إنشاء الحساب: " + error.message, message_en: error.message });
        return data.session;
      },
      async magicLink(email, redirect = "/owner") {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}${redirect}` } });
        if (error) throw new ApiError("invalid_input", { message_ar: "تعذّر إرسال الرابط", message_en: error.message });
      },
      async signOut() { await sb.auth.signOut(); },
      onChange(cb) { return sb.auth.onAuthStateChange((_e, s) => cb(s)).data.subscription.unsubscribe; },
    },
    subscribe(publicId, cb) {
      const ch = sb.channel(`branch:${publicId}`).on("broadcast", { event: "queue_changed" }, () => cb()).subscribe();
      return () => sb.removeChannel(ch);
    },
    async uploadPhoto(branchId, file) {
      const ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      const path = `${branchId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error } = await sb.storage.from("branch-photos").upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new ApiError("invalid_input", { message_ar: "تعذّر رفع الصورة", message_en: error.message });
      return path;
    },
    photoUrl: (path) => (/^(https?:|data:)/.test(path) ? path : `${cfg.SUPABASE_URL}/storage/v1/object/public/branch-photos/${path}`),
  };
}
