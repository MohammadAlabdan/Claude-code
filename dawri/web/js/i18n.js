// Strings from /i18n/<ns>.<lang>.json, digits per branch setting, Riyadh-time formatting.
const cache = new Map();
let current = { ns: "customer", lang: "ar", strings: {} };

export async function loadStrings(ns, lang) {
  const key = `${ns}.${lang}`;
  if (!cache.has(key)) {
    cache.set(key, fetch(`/i18n/${key}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  }
  current = { ns, lang, strings: await cache.get(key) };
  return current;
}

export function t(key, vars = {}) {
  let s = current.strings[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export const langDir = (lang) => (lang === "ar" || lang === "ur" ? "rtl" : "ltr");

let arabicDigits = true;
export function setArabicDigits(on) { arabicDigits = on !== false; }
export function num(n) {
  if (n == null) return "";
  const s = String(n);
  return arabicDigits && current.lang === "ar" ? s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]) : s;
}

const tz = "Asia/Riyadh";
export function time(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(current.lang === "ar" ? (arabicDigits ? "ar-SA-u-nu-arab-ca-gregory" : "ar-SA-u-nu-latn-ca-gregory") : "en-GB",
    { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function date(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(current.lang === "ar" ? (arabicDigits ? "ar-SA-u-nu-arab-ca-gregory" : "ar-SA-u-nu-latn-ca-gregory") : "en-GB",
    { timeZone: tz, day: "numeric", month: "short" }).format(new Date(iso));
}
export const WEEKDAYS = { ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
export function hourLabel(h) {
  if (current.lang !== "ar") return `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;
  const part = h < 5 ? "الفجر" : h < 12 ? "الصباح" : h < 15 ? "الظهر" : h < 18 ? "العصر" : "المساء";
  return `${num(h % 12 || 12)} ${part}`;
}
export function errorText(e) {
  if (!e) return t("error.generic");
  return (current.lang === "ar" ? e.message_ar : e.message_en) || e.message_ar || t("error.generic");
}
export const lang = () => current.lang;
