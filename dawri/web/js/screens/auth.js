// Owner sign-in / sign-up (email + password, or magic link). No phone/SMS sign-in.
import { h, icon, fill } from "../ui/dom.js";
import { errorText } from "../i18n.js";
import { toast } from "../ui/toast.js";

/** Renders the sign-in view; resolves once a session exists. */
export function requireSession(ctx, { title = "دخول صاحب المحل", lead = "ادخل بالبريد الإلكتروني وكلمة المرور.", signupFirst = false, redirect = "/owner" } = {}) {
  return new Promise(async (resolve) => {
    const { api, shell } = ctx;
    const existing = await api.auth.session();
    if (existing) return resolve(existing);
    shell.setTitle(title);
    let mode = signupFirst ? "signup" : "signin";
    const email = h("input", { id: "auth-email", type: "email", autocomplete: "email", required: true, dir: "ltr", placeholder: "name@example.com" });
    const password = h("input", { id: "auth-password", type: "password", autocomplete: "current-password", minlength: 8, dir: "ltr" });
    const err = h("p.err", { hidden: true, role: "alert" });
    const submit = h("button.btn.btn-primary.btn-block", { type: "submit", "data-testid": "auth-submit" });
    const toggle = h("button.btn.btn-ghost.btn-block", { type: "button" });
    const sync = () => {
      submit.textContent = mode === "signin" ? "دخول" : "إنشاء حساب";
      toggle.textContent = mode === "signin" ? "ما عندك حساب؟ أنشئ حساباً" : "عندك حساب؟ سجّل دخول";
      password.autocomplete = mode === "signin" ? "current-password" : "new-password";
    };
    toggle.onclick = () => { mode = mode === "signin" ? "signup" : "signin"; sync(); };
    sync();
    const form = h("form.stack", { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) { err.hidden = false; err.textContent = "اكتب بريداً إلكترونياً صحيحاً"; email.setAttribute("aria-invalid", "true"); return; }
      if (password.value.length < 8) { err.hidden = false; err.textContent = "كلمة المرور ٨ أحرف على الأقل"; password.setAttribute("aria-invalid", "true"); return; }
      submit.disabled = true;
      try {
        const s = mode === "signin" ? await api.auth.signIn(email.value.trim(), password.value) : await api.auth.signUp(email.value.trim(), password.value);
        if (!s) { toast("أرسلنا رابط تأكيد على بريدك، افتحه ثم ارجع هنا"); return; }
        resolve(s);
      } catch (e2) { err.hidden = false; err.textContent = errorText(e2); } finally { submit.disabled = false; }
    } },
      h("label.field", h("span", "البريد الإلكتروني"), email),
      h("label.field", h("span", "كلمة المرور"), password),
      err, submit, toggle,
      api.demo || api.noMagicLink ? null : h("button.btn.btn-block", { type: "button", onclick: async () => {
        if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) { err.hidden = false; err.textContent = "اكتب بريدك أولاً"; return; }
        try { await api.auth.magicLink(email.value.trim(), redirect); toast("أرسلنا رابط الدخول على بريدك"); } catch (e2) { err.hidden = false; err.textContent = errorText(e2); }
      } }, icon("mail"), "أرسل لي رابط دخول"));
    fill(shell.content, 
      h("section.card.center", { style: { justifyItems: "center" } }, h("img.hero-logo", { src: "./assets/logo.svg", alt: "" }), h("h2", title), h("p.muted", lead)),
      h("section.card", form),
      api.demo || api.demoAccounts ? h("section.card", h("div.card-head", icon("flask"), h("h3", "حسابات تجريبية")), h("p.muted.small", "كلمة المرور لكل الحسابات: Dawri-Demo-2026"),
        h("div.stack", [["barber@demo.dawri.app", "حلاق الأصيل · المتكاملة"], ["cafe@demo.dawri.app", "مقهى الركن · النمو"], ["wash@demo.dawri.app", "مغسلة اللمعة · الأساسية"], ["admin@demo.dawri.app", "مدير المنصة"]]
          .map(([em, label]) => h("button.btn.btn-block", { type: "button", "data-demo-login": em, onclick: async () => { resolve(await api.auth.signIn(em, "Dawri-Demo-2026")); } }, label)))) : null);
  });
}
