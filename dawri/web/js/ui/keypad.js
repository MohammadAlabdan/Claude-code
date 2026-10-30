import { h } from "./dom.js";

/** Numeric keypad for order numbers. onChange(value), onEnter(value). */
export function Keypad({ max = 6, onEnter, enterLabel }) {
  let value = "";
  const display = h("div.keypad-display.num", { "aria-live": "polite" }, "");
  const set = (v) => { value = v.slice(0, max); display.textContent = value || "—"; enter.disabled = !value; };
  const enter = h("button.btn.btn-primary.btn-xl.btn-block", { type: "button", onclick: () => value && onEnter(value, () => set("")) }, enterLabel);
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "C"].map((k) =>
    h("button", { type: "button", "aria-label": k === "⌫" ? "delete" : k === "C" ? "clear" : k,
      onclick: () => set(k === "⌫" ? value.slice(0, -1) : k === "C" ? "" : value + k) }, k));
  set("");
  return h("div.stack", display, h("div.keypad", keys), enter);
}
