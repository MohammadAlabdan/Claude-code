// Hand-drawn SVG charts (no library). All text uses theme tokens through CSS.
import { num, WEEKDAYS, lang } from "../i18n.js";

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  kids.forEach((k) => el.append(k));
  return el;
};

/** Vertical bars; labels shown every `every` items; highlights the max. */
export function BarChart(values, { labels = [], every = 3, height = 120, title = "" } = {}) {
  const w = 320, pad = 18, max = Math.max(1, ...values), bw = (w - pad) / values.length;
  const svg = s("svg", { viewBox: `0 0 ${w} ${height + 18}`, class: "chart", role: "img", "aria-label": title });
  [0.5, 1].forEach((f) => svg.append(s("line", { class: "grid", x1: pad, x2: w, y1: height - f * (height - 8), y2: height - f * (height - 8) })));
  svg.append(s("text", { x: 0, y: 12 }, document.createTextNode(num(Math.round(max)))));
  const top = values.indexOf(Math.max(...values));
  values.forEach((v, i) => {
    const bh = (v / max) * (height - 8);
    svg.append(s("rect", { class: `bar${i === top && v > 0 ? " hi" : ""}`, x: pad + i * bw + 1, y: height - bh, width: Math.max(1, bw - 2), height: bh, rx: 2 }));
    if (labels[i] != null && i % every === 0) svg.append(s("text", { x: pad + i * bw + bw / 2, y: height + 14, "text-anchor": "middle" }, document.createTextNode(labels[i])));
  });
  return svg;
}

/** Line with area fill and an emphasized last point. */
export function LineChart(points, { labels = [], height = 110, title = "" } = {}) {
  const w = 320, pad = 18, vals = points.map((p) => p ?? 0), max = Math.max(1, ...vals);
  const svg = s("svg", { viewBox: `0 0 ${w} ${height + 18}`, class: "chart", role: "img", "aria-label": title });
  const x = (i) => pad + (vals.length === 1 ? (w - pad) / 2 : (i * (w - pad - 6)) / (vals.length - 1));
  const y = (v) => height - (v / max) * (height - 10);
  svg.append(s("line", { class: "grid", x1: pad, x2: w, y1: y(max / 2), y2: y(max / 2) }));
  svg.append(s("text", { x: 0, y: 12 }, document.createTextNode(num(Math.round(max)))));
  const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  svg.append(s("path", { class: "area", d: `${d}L${x(vals.length - 1)},${height}L${x(0)},${height}Z` }), s("path", { class: "line", d }));
  if (vals.length) svg.append(s("circle", { class: "dot", cx: x(vals.length - 1), cy: y(vals[vals.length - 1]), r: 4 }));
  const step = Math.max(1, Math.ceil(labels.length / 6));
  labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) svg.append(s("text", { x: x(i), y: height + 14, "text-anchor": "middle" }, document.createTextNode(l))); });
  return svg;
}

/** Weekday × hour heatmap; closed hours are blank. Only open hours are shown as columns. */
export function Heatmap(matrix, open, { title = "" } = {}) {
  const hours = [...Array(24).keys()].filter((hr) => open?.some((row) => row[hr]) ?? true);
  const max = Math.max(0.1, ...matrix.flat());
  const wrap = document.createElement("div");
  wrap.className = "heat";
  wrap.style.gridTemplateColumns = `auto repeat(${hours.length}, minmax(0, 1fr))`;
  wrap.setAttribute("role", "img");
  wrap.setAttribute("aria-label", title);
  const names = WEEKDAYS[lang()] ?? WEEKDAYS.ar;
  wrap.append(document.createElement("span"));
  hours.forEach((hr) => { const c = document.createElement("span"); c.textContent = hr % 3 === 0 ? num(hr) : ""; c.style.textAlign = "center"; wrap.append(c); });
  matrix.forEach((row, d) => {
    const lab = document.createElement("span"); lab.className = "d"; lab.textContent = names[d]; wrap.append(lab);
    hours.forEach((hr) => {
      const c = document.createElement("span"); c.className = "c";
      const isOpen = open ? open[d][hr] : true;
      const v = row[hr] / max;
      c.style.background = isOpen ? `color-mix(in srgb, var(--accent) ${Math.round(8 + v * 92)}%, var(--paper))` : "transparent";
      c.title = `${names[d]} ${hr}:00 — ${row[hr]}`;
      wrap.append(c);
    });
  });
  return wrap;
}
