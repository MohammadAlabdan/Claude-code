// Platform admin /admin: businesses, plans and dates, active state, usage, read-only branch view.
import { h, icon, card, skeleton, fill } from "../ui/dom.js";
import { num, date, errorText } from "../i18n.js";
import { openSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { requireSession } from "./auth.js";

const PLAN_AR = { basic: "الأساسية", growth: "النمو", full: "المتكاملة", seasonal: "المواسم" };

export async function render(ctx) {
  const { api, shell } = ctx;
  await requireSession(ctx, { title: "لوحة الإدارة", lead: "للمسؤول عن منصة دوري فقط.", redirect: "/admin" });
  shell.setTitle("لوحة الإدارة");
  fill(shell.content, ...skeleton(2));
  let list;
  try { list = (await api.admin("list")).businesses; } catch (e) {
    fill(shell.content, h("div.empty", icon("shield-off"), h("p", errorText(e)), h("button.btn", { type: "button", onclick: async () => { await api.auth.signOut(); ctx.rerender(); } }, "دخول بحساب آخر")));
    return;
  }
  const draw = () => fill(shell.content, 
    h("div.grid2", h("div.stat", h("span.label", "المحلات"), h("span.value", num(list.length))), h("div.stat", h("span.label", "نشطة"), h("span.value", num(list.filter((b) => b.effective_plan).length)))),
    card("المحلات", "building-store", h("div.table-wrap", h("table.simple", { "data-testid": "admin-table" },
      h("thead", h("tr", ["المحل", "الباقة", "ينتهي", "الحالة", "تذاكر ٣٠ يوم", ""].map((x) => h("th", x)))),
      h("tbody", list.map((b) => h("tr",
        h("td", h("div", b.name), h("div.muted.small", b.owner_email ?? "")),
        h("td", PLAN_AR[b.plan], b.trial_until && Date.parse(b.trial_until) > Date.now() ? h("div.badge.warn", "تجربة") : null),
        h("td.num", b.plan_until ? date(b.plan_until) : b.trial_until ? date(b.trial_until) : "—"),
        h("td", b.is_active ? h("span.badge", "نشط") : h("span.badge.danger", "موقوف")),
        h("td.num", num(b.usage.tickets_30d)),
        h("td", h("button.btn", { type: "button", onclick: () => edit(b) }, "إدارة")))))))));
  async function edit(b) {
    const plan = h("select", Object.entries(PLAN_AR).map(([k, v]) => h("option", { value: k, selected: k === b.plan }, v)));
    const until = h("input", { type: "date", value: b.plan_until?.slice(0, 10) ?? "" });
    const trial = h("input", { type: "date", value: b.trial_until?.slice(0, 10) ?? "" });
    const active = h("input", { type: "checkbox", checked: b.is_active });
    await openSheet({ title: b.name, body: [
      h("label.field", h("span", "الباقة"), plan), h("label.field", h("span", "الاشتراك حتى"), until), h("label.field", h("span", "التجربة حتى"), trial),
      h("label.check", active, h("span", "الحساب نشط")),
      h("div.list", b.branches.map((br) => h("div.list-item", h("span.grow", br.name), h("a.btn", { href: `/s/${br.public_id}`, target: "_blank", rel: "noopener" }, "الصفحة"),
        h("button.btn", { type: "button", onclick: () => view(br) }, "الأرقام"))))],
      actions: [{ label: "احفظ", primary: true, onClick: async (close) => {
        try {
          await api.admin("update_business", { business_id: b.id, changes: { plan: plan.value, plan_until: until.value ? `${until.value}T23:59:59+03:00` : null, trial_until: trial.value ? `${trial.value}T23:59:59+03:00` : null, is_active: active.checked } });
          close(); toast("تم الحفظ"); list = (await api.admin("list")).businesses; draw();
        } catch (e) { toast(errorText(e), { error: true }); }
      } }, { label: "إغلاق", ghost: true }] });
  }
  async function view(br) {
    const d = await api.admin("branch_dashboard", { branch_id: br.id, range: "7d" });
    openSheet({ title: `${br.name} · ٧ أيام`, body: [h("div.grid2",
      ...[["خدمت", d.served], ["انضموا", d.joined], ["متوسط الانتظار", d.avg_wait_min != null ? `${num(d.avg_wait_min)} د` : "—"], ["راضون", d.satisfaction_pct != null ? `${num(d.satisfaction_pct)}٪` : "—"]]
        .map(([l, v]) => h("div.stat", h("span.label", l), h("span.value", typeof v === "number" ? num(v) : v))))], actions: [{ label: "إغلاق", primary: true }] });
  }
  draw();
}
