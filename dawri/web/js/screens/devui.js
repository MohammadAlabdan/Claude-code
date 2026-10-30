// Component gallery /dev/ui: every signature component, in the current theme (toggle to see both).
import { h, card } from "../ui/dom.js";
import { TicketCard, NowServingBoard, QueueLine, BusyPill, StageTracker, LockedCard } from "../ui/components.js";
import { BarChart, LineChart, Heatmap } from "../ui/charts.js";
import { Keypad } from "../ui/keypad.js";
import { QR } from "../ui/qr.js";
import { openSheet } from "../ui/sheet.js";
import { toast } from "../ui/toast.js";
import { setTheme, currentTheme } from "../app.js";

export async function render({ shell }) {
  shell.setTitle("مكوّنات دوري");
  const board = NowServingBoard("الحين يُخدم");
  board.update(21);
  const line = QueueLine();
  line.update(3);
  const tokens = ["--paper", "--sheet", "--ink", "--muted", "--line", "--accent", "--ticket", "--board", "--led", "--danger"];
  shell.content.append(
    h("div.seg", { role: "group" }, [[null, "تلقائي"], ["light", "فاتح"], ["dark", "داكن"]].map(([v, l]) => h("button", { type: "button", "aria-pressed": String(currentTheme() === v), "data-theme-choice": v ?? "auto", onclick: () => { setTheme(v); location.reload(); } }, l))),
    card("الألوان", "palette", h("div.gallery-swatch", tokens.map((tk) => h("div", { style: { background: `var(${tk})`, color: ["--ink", "--board", "--accent", "--danger"].includes(tk) ? "var(--paper)" : "var(--ink)" } }, tk)))),
    card("الخطوط", "typography", h("div.display", { style: { fontSize: "2rem" } }, "دوري Lalezar"), h("p", "IBM Plex Sans Arabic للنصوص"), h("p.hand", "Aref Ruqaa للمسة ودّية"), h("div", { style: { font: "900 2rem var(--f-led)", direction: "ltr" } }, "0123456789")),
    board,
    TicketCard({ label: "رقمك", number: 24, status: "أمامك ٣", estimate: "حوالي ١٥ دقيقة تقريباً" }),
    TicketCard({ label: "رقمك", number: 24, status: "ارجع الآن، باقي قبلك دوران", alert: true }),
    card("QueueLine", "users", line, h("button.btn", { type: "button", onclick: () => line.update(Math.max(0, (line.querySelectorAll(".qp").length - 2))) }, "نادِ التالي")),
    card("BusyPill", "gauge", h("div.row", BusyPill("free"), BusyPill("some"), BusyPill("busy"))),
    card("StageTracker", "car", StageTracker([["received", "استلمنا"], ["in_progress", "قيد العمل"], ["ready", "جاهزة"], ["picked_up", "تم الاستلام"]].map(([key, label]) => ({ key, label })), "in_progress")),
    LockedCard("كوبون الهدوء", "full"),
    card("Charts", "chart-bar", BarChart([0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 2, 2, 2, 2, 1, 1, 2, 3, 5, 6, 5, 4, 1], { labels: [...Array(24).keys()] }), LineChart([8, 9, 7, 12, 10, 8, 6], { labels: ["٢٤", "٢٥", "٢٦", "٢٧", "٢٨", "٢٩", "٣٠"] }),
      Heatmap(Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, hr) => (hr < 9 ? 0 : hr >= 19 ? 5 : hr === 15 ? (d ? 1 : 0.2) : 2))), Array.from({ length: 7 }, () => Array.from({ length: 24 }, (_, hr) => hr >= 9)))),
    card("Keypad", "dialpad", Keypad({ enterLabel: "جاهز", onEnter: (v, reset) => { toast(`جاهز ${v}`); reset(); } })),
    card("QR", "qrcode", QR("https://dawri.app/s/aseel2026")),
    h("div.grid2", h("button.btn.btn-primary", { type: "button", onclick: () => openSheet({ title: "Bottom sheet", body: [h("p", "نموذج أو تأكيد")], actions: [{ label: "تمام", primary: true }, { label: "إلغاء", ghost: true }] }) }, "Sheet"),
      h("button.btn", { type: "button", onclick: () => toast("تم") }, "Toast")),
  );
}
