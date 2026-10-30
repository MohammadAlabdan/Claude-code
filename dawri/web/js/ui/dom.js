// Tiny DOM helpers: h('div.card', {onclick}, children…)
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const [tag, ...classes] = sel.split(".");
  const el = document.createElement(tag || "div");
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const icon = (name, label) =>
  h("i", { class: `ti ti-${name}`, "aria-hidden": label ? null : "true", "aria-label": label ?? null, role: label ? "img" : null });

export function clear(el) { el.replaceChildren(); return el; }

/** Replace children, skipping null/false (replaceChildren would print "null"). */
export function fill(el, ...kids) { el.replaceChildren(); return append(el, kids); }

export function card(title, iconName, ...body) {
  return h("section.card", title ? h("div.card-head", iconName ? icon(iconName) : null, h("h3", title)) : null, ...body);
}

export function empty(text, iconName = "mood-empty", action) {
  return h("div.empty", icon(iconName), h("p", text), action);
}

export function skeleton(n = 2) {
  return Array.from({ length: n }, () => h("div.skeleton", { "aria-hidden": "true" }));
}

export function vibrate(pattern) { try { navigator.vibrate?.(pattern); } catch { /* unsupported */ } }

/** localStorage wrapped for private mode / blocked storage. */
export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
