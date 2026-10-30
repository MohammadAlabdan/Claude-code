import { h } from "./dom.js";

let el, timer;
export function toast(message, { error = false, ms = 2600 } = {}) {
  el ??= document.body.appendChild(h("div.toast", { role: "status", "aria-live": "polite" }));
  el.textContent = message;
  el.classList.toggle("error", error);
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove("show"), ms);
}
