// Subscription end date: start + n days / months / years, month-end clamped like Postgres
// (31 Jan + 1 month = 28/29 Feb), ending at 23:59:59 Riyadh time. Same rule as public.a_update_business.
export function subscriptionEnd(start, n, unit) {
  const r = new Date(start.getTime() + 3 * 3600000);
  let y = r.getUTCFullYear(), m = r.getUTCMonth(), d = r.getUTCDate();
  if (unit === "day") { const t = new Date(Date.UTC(y, m, d + n)); y = t.getUTCFullYear(); m = t.getUTCMonth(); d = t.getUTCDate(); }
  else { const tm = m + (unit === "year" ? 12 * n : n); y += Math.floor(tm / 12); m = ((tm % 12) + 12) % 12; d = Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()); }
  return new Date(Date.UTC(y, m, d, 23, 59, 59) - 3 * 3600000);
}
/** "YYYY-MM-DD" for today in Riyadh. */
export const riyadhToday = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
