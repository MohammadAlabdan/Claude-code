// QR codes with qrcode-generator (loaded once from the CDN). Falls back to the plain link.
import { h } from "./dom.js";

const SRC = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
let loading;
function load() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  loading ??= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = SRC; s.async = true;
    s.onload = () => res(window.qrcode); s.onerror = rej;
    document.head.append(s);
  });
  return loading;
}

export function QR(text, { label = "" } = {}) {
  const box = h("div.qr-box", { role: "img", "aria-label": label || text });
  load().then((qrcode) => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }).catch(() => box.append(h("p.small", { style: { wordBreak: "break-all", color: "#1B2725" } }, text)));
  return box;
}
