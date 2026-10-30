// Pure business logic shared by the Edge Functions. No I/O here, so it is unit-tested directly.

export const RIYADH_TZ = "Asia/Riyadh";

/** Local date/time parts in Riyadh for an instant. */
export function riyadhParts(at: Date = new Date()) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: RIYADH_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday, // 0 = Sunday
  };
}

/** "HH:MM" floored to the quarter hour. */
export function quarterHour(hour: number, minute: number): string {
  const m = Math.floor(minute / 15) * 15;
  return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Round to the nearest 5 minutes, never below 5 (same rule as SQL round_estimate). */
export function roundEstimate(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/** Σ(service minutes × party size of tickets ahead) ÷ active providers, rounded. */
export function estimateMinutes(partiesAhead: number[], serviceMinutes: number, providers: number): number {
  const load = partiesAhead.reduce((a, b) => a + b, 0) * serviceMinutes;
  return roundEstimate(load / Math.max(1, providers));
}

/** Median of a list (used for service minutes). */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Rotating 4-digit redemption code: HMAC-SHA256(secret, floor(unix_minutes)) read as a
 * big-endian integer, mod 10000. Identical to SQL rotating_code_at().
 */
export async function rotatingCode(secret: string, unixMinute: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(String(unixMinute))));
  let r = 0;
  for (const b of mac) r = (r * 256 + b) % 10000;
  return String(r).padStart(4, "0");
}

export function unixMinute(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 60000);
}

/** Saudi mobile: accepts Arabic digits, spaces, +966/966 prefixes. Returns 05XXXXXXXX or null. */
export function normalizeSaudiPhone(input: string): string | null {
  const western = input.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  let digits = western.replace(/\D/g, "");
  if (/^9665\d{8}$/.test(digits)) digits = "0" + digits.slice(3);
  if (/^5\d{8}$/.test(digits)) digits = "0" + digits;
  return /^05\d{8}$/.test(digits) ? digits : null;
}

export interface QuietWindow {
  weekday: number;     // 0 = Sunday
  start_hour: number;  // window covers start_hour .. start_hour + 2
  avg_arrivals: number;
}

/**
 * Lowest-traffic 2-hour windows inside opening hours.
 * arrivals[weekday][hour] = average arrivals; open[weekday][hour] = open during that hour.
 * Returns up to `limit` windows, quietest first, at most one per weekday.
 */
export function quietWindows(arrivals: number[][], open: boolean[][], limit = 2): QuietWindow[] {
  const all: QuietWindow[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 23; h++) {
      if (!open[d]?.[h] || !open[d]?.[h + 1]) continue;
      all.push({ weekday: d, start_hour: h, avg_arrivals: Math.round(((arrivals[d][h] + arrivals[d][h + 1]) / 2) * 10) / 10 });
    }
  }
  // Opening edges are naturally empty; prefer windows with at least some traffic on that day.
  all.sort((a, b) => a.avg_arrivals - b.avg_arrivals || a.weekday - b.weekday || a.start_hour - b.start_hour);
  const out: QuietWindow[] = [];
  const days = new Set<number>();
  for (const w of all) {
    if (days.has(w.weekday)) continue;
    out.push(w);
    days.add(w.weekday);
    if (out.length === limit) break;
  }
  return out;
}

/** Busiest hour of the week (weekday, hour) by average arrivals. */
export function busiestSlot(arrivals: number[][]): { weekday: number; hour: number; avg_arrivals: number } | null {
  let best: { weekday: number; hour: number; avg_arrivals: number } | null = null;
  arrivals.forEach((row, d) => row.forEach((v, h) => {
    if (!best || v > best.avg_arrivals) best = { weekday: d, hour: h, avg_arrivals: v };
  }));
  return best;
}

export const WEEKDAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

/** 15 → "٣ العصر"-style label used in summaries: 12-hour Arabic clock. */
export function hourLabelAr(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const part = hour < 5 ? "الفجر" : hour < 12 ? "الصباح" : hour < 15 ? "الظهر" : hour < 18 ? "العصر" : "المساء";
  return `${toArabicDigits(h12)} ${part}`;
}

export function toArabicDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

export interface DayStats {
  served: number;
  avg_wait_min: number | null;
  satisfaction_pct: number | null;
  lost: number;
  lost_sar: number;
}

/** Fixed Arabic evening summary (used when AI is off or unavailable). */
export function summaryTemplate(s: DayStats, quiet: QuietWindow | null): string {
  const parts = [`ملخص اليوم: ${toArabicDigits(s.served)} زبون`];
  if (s.avg_wait_min !== null) parts.push(`انتظار ${toArabicDigits(s.avg_wait_min)} د`);
  if (s.satisfaction_pct !== null) parts.push(`${toArabicDigits(s.satisfaction_pct)}٪ راضون`);
  let text = parts.join("، ") + ".";
  if (s.lost > 0) text += ` خسرت ${toArabicDigits(s.lost)} زباين ≈ ${toArabicDigits(s.lost_sar)} ريال.`;
  if (quiet) {
    text += ` اقتراح: ${WEEKDAYS_AR[quiet.weekday]} ${hourLabelAr(quiet.start_hour)}–${toArabicDigits((quiet.start_hour + 2) % 12 || 12)} هادئ، جرّب كوبون الهدوء.`;
  }
  return text;
}

/** Prefilled quiet-coupon offer for a quiet window. */
export function quietCouponDraft(w: QuietWindow) {
  const pad = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
  return {
    kind: "quiet_coupon",
    title: "كوبون الهدوء",
    terms: `خصم ${WEEKDAYS_AR[w.weekday]} من ${hourLabelAr(w.start_hour)} لمدة ساعتين`,
    discount_text: "١٥٪",
    weekdays: [w.weekday],
    start_time: pad(w.start_hour),
    end_time: pad(w.start_hour + 2),
    label_ar: `${WEEKDAYS_AR[w.weekday]} ${hourLabelAr(w.start_hour)}–${toArabicDigits((w.start_hour + 2) % 12 || 12)} هادئ`,
  };
}

/** Image media type from base64 magic bytes; null when unsupported. */
export function imageMediaType(b64: string): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("iVBORw0KGgo")) return "image/png";
  if (b64.startsWith("UklGR")) return "image/webp";
  return null;
}
