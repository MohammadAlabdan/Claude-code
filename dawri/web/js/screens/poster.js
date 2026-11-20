// QR print kit for a shop: door poster (A4/A5), counter/mirror card (A6) and a square glass sticker (10×10 cm).
// /poster/<public_id> is public (it only shows what the shop page already shows), so the platform admin can print
// a kit for every new client. /owner/poster opens the kit of the owner's current branch.
import { h, icon, store, fill } from "../ui/dom.js";
import { errorText } from "../i18n.js";
import { QR } from "../ui/qr.js";
import { requireSession } from "./auth.js";

const DESIGNS = [
  ["door", "ملصق الباب", "A4 أو A5 · عند المدخل"],
  ["card", "بطاقة المرآة", "A6 · ١٠٫٥×١٤٫٨ سم · عند الكرسي أو الكاشير"],
  ["sticker", "ستيكر الزجاج", "١٠×١٠ سم · على باب المحل"],
];
const PAGE = { door: { A4: "A4 portrait", A5: "A5 portrait" }, card: "A6 portrait", sticker: "100mm 100mm" };

/** Wording per sector: barbers and salons choose a chair or a specialist. */
function steps(category) {
  const pick = category === "salon" ? "اختر الخدمة والمختصة" : category === "barber" ? "اختر الخدمة والكرسي" : "اختر الخدمة";
  return [["scan", "امسح الكود", "بكاميرا جوالك"], ["armchair-2", pick, "تشوف مين فاضي الحين"], ["bell-ringing", "خذ رقمك", "ونبّهك قبل دورك"]];
}

const Full = (dark = false, cls = "") => h(`img.pk-full${cls}`, { src: `./assets/logo-full${dark ? "-dark" : ""}.svg`, alt: "جاي · دورك جاي.. وأنت مرتاح" });
const Mark = () => h("img.pk-mark", { src: "./assets/logo.svg", alt: "جاي" });
const Code = (url) => h("div.pk-qr", h("span.pk-notch.l"), h("span.pk-notch.r"), QR(url, { label: url }));

function door(b, url) {
  return h("section.pk.pk-door", { "data-testid": "poster" },
    h("header.pk-band", Full(true)),
    h("div.pk-body",
      h("div.pk-kicker", "لا تنتظر واقف"),
      h("h2.pk-name", b.business_name),
      b.name && b.name !== b.business_name ? h("div.pk-branch", b.name) : null,
      Code(url),
      h("ol.pk-steps", steps(b.category).map(([ic, t1, t2], i) => h("li", h("span.pk-n", String(i + 1).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d])), icon(ic), h("b", t1), h("span", t2)))),
      h("div.pk-free", "بدون تطبيق · بدون تسجيل · مجاناً للزبون")),
    h("footer.pk-url", { dir: "ltr" }, url.replace(/^https?:\/\//, "")));
}

function card(b, url) {
  return h("section.pk.pk-card", { "data-testid": "poster" },
    h("div.pk-top", Full(false, ".sm")),
    h("h2.pk-name", b.business_name),
    h("div.pk-kicker", "امسح وخذ رقمك من مكانك"),
    Code(url),
    h("div.pk-line", steps(b.category).map(([ic, t1]) => h("span", icon(ic), t1))),
    h("footer.pk-url", { dir: "ltr" }, url.replace(/^https?:\/\//, "")));
}

function sticker(b, url) {
  return h("section.pk.pk-sticker", { "data-testid": "poster" },
    h("div.pk-ring", h("div.pk-kicker", "امسح · خذ رقمك"), Code(url), h("div.pk-stk-foot", Mark(), h("b", "دورك جاي.. وأنت مرتاح"))),
    h("div.pk-stk-name", b.business_name));
}

export async function render(ctx) {
  const { api, shell, params, nav } = ctx;
  let publicId = params?.[0];
  if (!publicId) {
    // /owner/poster → the owner's current branch
    await requireSession(ctx);
    let ov;
    try { ov = await api.owner("overview"); } catch (e) { fill(shell.content, h("p", errorText(e))); return; }
    const branches = ov.businesses.flatMap((b) => b.branches);
    const br = branches.find((x) => x.id === store.get("dawri.owner.branch")) ?? branches[0];
    if (!br) { fill(shell.content, h("a.btn", { href: "./start" }, "ابدأ التهيئة")); return; }
    return nav(`./poster/${br.public_id}`, { replace: true });
  }
  shell.setTitle("ملصقات QR");
  let data;
  try { data = await api.publicBranch(publicId); } catch (e) { fill(shell.content, h("div.empty", icon("qrcode-off"), h("p", errorText(e)))); return; }
  const b = data.branch;
  const url = `${new URL(".", document.baseURI).href}s/${b.public_id}`;

  let design = store.get("dawri.poster.design") ?? "door", size = store.get("dawri.poster.size") ?? "A4";
  const style = h("style");
  const stage = h("div.pk-stage");
  const sizeSeg = h("div.seg", { role: "group", "aria-label": "المقاس" });
  const paint = () => {
    const page = design === "door" ? PAGE.door[size] : PAGE[design];
    style.textContent = `@media print { @page { size: ${page}; margin: 0; } }`;
    stage.dataset.design = design; stage.dataset.size = size;
    fill(stage, (design === "door" ? door : design === "card" ? card : sticker)(b, url));
    sizeSeg.hidden = design !== "door";
    fill(sizeSeg, ...["A4", "A5"].map((s) => h("button", { type: "button", "aria-pressed": String(s === size), onclick: () => { size = s; store.set("dawri.poster.size", s); paint(); } }, s)));
    document.querySelectorAll("[data-design]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.design === design)));
  };

  fill(shell.content,
    h("div.pk-tools.no-print",
      h("div.pk-choices", DESIGNS.map(([k, t1, t2]) => h("button.pk-choice", { type: "button", "data-design": k, onclick: () => { design = k; store.set("dawri.poster.design", k); paint(); } },
        h("b", t1), h("span", t2)))),
      h("div.row", { style: { gap: "8px", flexWrap: "wrap" } },
        sizeSeg,
        h("button.btn.btn-primary", { type: "button", "data-testid": "print", onclick: () => window.print() }, icon("printer"), "اطبع أو احفظ PDF")),
      h("p.muted.small", "للمطبعة: اختر «حفظ كـ PDF» من نافذة الطباعة، وأرسل الملف للمطبعة. الورق المقوّى المطفي (٣٠٠ جرام) أفضل للباب والمرآة، والستيكر على فينيل شفاف أو أبيض.")),
    style, stage);
  paint();
}
