// Landing inside the app: active tickets, demo shops, and the owner entry points.
import { h, icon, store } from "../ui/dom.js";
import { t } from "../i18n.js";

export async function render({ api, shell }) {
  shell.setTitle(t("app.name"));
  const active = Object.entries(localStorage).filter(([k]) => k.startsWith("dawri.ticket.")).map(([k]) => [k.slice(13), store.get(k)]);
  shell.content.append(
    h("section.card.center", { style: { justifyItems: "center" } },
      h("img.hero-logo", { src: "./assets/logo.svg", alt: "" }),
      h("h2", t("home.title")),
      h("p.muted", t("home.lead")),
      h("p.hand", t("home.hand"))),
    active.length ? h("section.card", h("div.card-head", icon("ticket"), h("h3", t("home.my_tickets"))),
      h("div.list", active.map(([pid, tok]) => h("a.list-item", { href: `./t/${tok}`, style: { color: "inherit", textDecoration: "none" } },
        icon("ticket"), h("span.grow", pid), icon("chevron-left"))))) : null,
    api.demo ? h("section.card", h("div.card-head", icon("building-store"), h("h3", t("home.demo_shops"))),
      h("div.list", [["rukn2026", "مقهى الركن", "coffee", t("mode.receipt")], ["aseel2026", "حلاق الأصيل", "scissors", t("mode.remote")], ["lamaa2026", "مغسلة اللمعة", "car", t("mode.dropoff")]]
        .map(([pid, name, ic, mode]) => h("a.list-item", { href: `./s/${pid}`, style: { color: "inherit", textDecoration: "none" } },
          icon(ic), h("div.grow", h("div.title", name), h("div.muted.small", mode)), icon("chevron-left")))),
      h("p.muted.small", t("home.demo_staff_hint")),
      h("div.chips", [["./staff/pair#demo-staff-aseel-chair1-000000000000", "كرسي ١ · حلاق الأصيل"], ["./staff/pair#demo-staff-rukn-kitchen-000000000000", "مطبخ مقهى الركن"], ["./staff/pair#demo-staff-lamaa-front-0000000000000", "استقبال المغسلة"]]
        .map(([href, label]) => h("a.chip", { href }, label)))) : null,
    h("section.card", h("div.card-head", icon("building-store"), h("h3", t("home.owner_title"))),
      h("p.muted.small", t("home.owner_lead")),
      h("div.grid2", h("a.btn.btn-primary", { href: "./start" }, t("home.start")), h("a.btn", { href: "./owner" }, t("home.login")))),
  );
}
