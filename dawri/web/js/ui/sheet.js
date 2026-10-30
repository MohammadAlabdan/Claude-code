// Bottom sheet for forms and confirmations (never alert/confirm).
import { h } from "./dom.js";

/**
 * openSheet({ title, body, actions: [{ label, primary, danger, onClick(close) -> value|Promise }] })
 * Resolves with the value passed to close(), or null when dismissed.
 */
export function openSheet({ title, body = [], actions = [], dismissible = true }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const backdrop = h("div.sheet-backdrop");
    const close = (value = null) => {
      sheet.classList.remove("open");
      backdrop.classList.remove("open");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => { sheet.remove(); backdrop.remove(); prevFocus?.focus?.(); }, 230);
      resolve(value);
    };
    const onKey = (e) => { if (e.key === "Escape" && dismissible) close(null); };
    const sheet = h("div.sheet", { role: "dialog", "aria-modal": "true", "aria-label": title, dir: document.documentElement.dir },
      h("div.sheet-handle", { "aria-hidden": "true" }),
      title ? h("h2", title) : null,
      ...[body].flat(),
      actions.length ? h("div.sheet-actions", actions.map((a) =>
        h(`button.btn.btn-block${a.primary ? ".btn-primary" : ""}${a.danger ? ".btn-danger" : ""}${a.ghost ? ".btn-ghost" : ""}`,
          { type: "button", "data-action": a.id ?? null, onclick: async (e) => {
            const btn = e.currentTarget;
            if (!a.onClick) return close(a.value ?? null);
            btn.disabled = true;
            try { await a.onClick(close); } finally { btn.disabled = false; }
          } }, a.label))) : null);
    if (dismissible) backdrop.addEventListener("click", () => close(null));
    document.addEventListener("keydown", onKey);
    document.body.append(backdrop, sheet);
    requestAnimationFrame(() => {
      backdrop.classList.add("open");
      sheet.classList.add("open");
      (sheet.querySelector("input, select, textarea, button.btn-primary") ?? sheet).focus?.();
    });
  });
}

/** Two-button confirm; resolves true/false. */
export async function confirmSheet(title, text, confirmLabel, cancelLabel, danger = false) {
  const r = await openSheet({ title, body: text ? [h("p.muted", text)] : [],
    actions: [{ id: "confirm", label: confirmLabel, primary: !danger, danger, value: true }, { id: "cancel", label: cancelLabel, ghost: true, value: false }] });
  return r === true;
}
