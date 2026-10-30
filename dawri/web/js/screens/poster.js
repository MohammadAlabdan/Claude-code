// Printable poster /owner/poster: logo, shop name, big QR to the shop page, three steps. A5/A4 print CSS.
import { h, icon, store, fill } from "../ui/dom.js";
import { errorText } from "../i18n.js";
import { QR } from "../ui/qr.js";
import { requireSession } from "./auth.js";

export async function render(ctx) {
  const { api, shell } = ctx;
  await requireSession(ctx);
  let ov;
  try { ov = await api.owner("overview"); } catch (e) { fill(shell.content, h("p", errorText(e))); return; }
  const branches = ov.businesses.flatMap((b) => b.branches.map((br) => ({ ...br, business: b })));
  const br = branches.find((x) => x.id === store.get("dawri.owner.branch")) ?? branches[0];
  if (!br) { fill(shell.content, h("a.btn", { href: "/start" }, "ابدأ التهيئة")); return; }
  shell.setTitle("ملصق QR");
  const url = `${location.origin}/s/${br.public_id}`;
  let size = "A5";
  const style = h("style", "@media print { @page { size: A5 portrait; margin: 10mm; } }");
  fill(shell.content, 
    h("div.row.no-print", { style: { justifyContent: "space-between" } },
      h("div.seg", { role: "group" }, ["A5", "A4"].map((s) => h("button", { type: "button", "aria-pressed": String(s === size), onclick: (e) => {
        size = s; style.textContent = `@media print { @page { size: ${s} portrait; margin: 10mm; } }`;
        e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)));
      } }, s))),
      h("button.btn.btn-primary", { type: "button", onclick: () => window.print() }, icon("printer"), "اطبع")),
    style,
    h("section.poster", { "data-testid": "poster" },
      h("img", { src: "/assets/logo.svg", alt: "دوري", width: 72, height: 72 }),
      h("div.p-name", br.business.name),
      h("div", { style: { fontSize: "1.1rem" } }, br.name),
      h("div.p-qr", QR(url, { label: url })),
      h("div.p-steps", [["scan", "امسح"], ["ticket", "خذ رقمك"], ["bell-ringing", "نبّهك قبل دورك"]].map(([ic, label]) => h("div", icon(ic), label))),
      h("div", { style: { fontSize: ".8rem", direction: "ltr", color: "#56655F" } }, url)));
}
