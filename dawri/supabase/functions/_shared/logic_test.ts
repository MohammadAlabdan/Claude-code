import { assertEquals } from "jsr:@std/assert@1.0.13";
import {
  busiestSlot, estimateMinutes, hourLabelAr, imageMediaType, median, normalizeSaudiPhone, quarterHour,
  questSuggestions, quietCouponDraft, quietWindows, riyadhParts, rotatingCode, roundEstimate, summaryTemplate, toArabicDigits, unixMinute,
} from "./logic.ts";

Deno.test("estimate: rounds to nearest 5, never below 5", () => {
  assertEquals(roundEstimate(0), 5);
  assertEquals(roundEstimate(13), 15);
  assertEquals(roundEstimate(12.4), 10);
  assertEquals(roundEstimate(47.5), 50);
});

Deno.test("estimate: party sizes and providers", () => {
  // 3 people ahead (1 + 2) × 20 min ÷ 3 chairs = 20
  assertEquals(estimateMinutes([1, 2], 20, 3), 20);
  // nobody ahead
  assertEquals(estimateMinutes([], 20, 3), 5);
  // zero providers is treated as one
  assertEquals(estimateMinutes([1, 1], 10, 0), 20);
});

Deno.test("median", () => {
  assertEquals(median([]), null);
  assertEquals(median([30, 10, 20]), 20);
  assertEquals(median([10, 20, 30, 40]), 25);
});

Deno.test("rotating code matches the SQL test vector", async () => {
  // Same vector as supabase/tests/04_features_loyalty.sql and an independent Node HMAC check.
  assertEquals(await rotatingCode("dawri-test-secret", 29000000), "1815");
});

Deno.test("rotating code: 4 digits, changes per minute", async () => {
  const a = await rotatingCode("s", 1), b = await rotatingCode("s", 2);
  assertEquals(/^\d{4}$/.test(a) && /^\d{4}$/.test(b), true);
  assertEquals(unixMinute(new Date(120_000)), 2);
});

Deno.test("Riyadh time is UTC+3 with no DST", () => {
  // 2026-10-30T21:30Z = Saturday 00:30 in Riyadh
  assertEquals(riyadhParts(new Date("2026-10-30T21:30:00Z")), { date: "2026-10-31", hour: 0, minute: 30, weekday: 6 });
  assertEquals(riyadhParts(new Date("2026-06-15T09:05:00Z")).hour, 12);
  assertEquals(quarterHour(22, 14), "22:00");
  assertEquals(quarterHour(9, 59), "09:45");
});

Deno.test("Saudi phone validation", () => {
  assertEquals(normalizeSaudiPhone("0551234567"), "0551234567");
  assertEquals(normalizeSaudiPhone("٠٥٥١٢٣٤٥٦٧"), "0551234567");
  assertEquals(normalizeSaudiPhone("+966 55 123 4567"), "0551234567");
  assertEquals(normalizeSaudiPhone("551234567"), "0551234567");
  assertEquals(normalizeSaudiPhone("0112345678"), null);
  assertEquals(normalizeSaudiPhone("12345"), null);
});

const open = Array.from({ length: 7 }, () => Array.from({ length: 24 }, (_, h) => h >= 9 && h < 23));
const arrivals = Array.from({ length: 7 }, (_, d) =>
  Array.from({ length: 24 }, (_, h) => (h < 9 || h >= 23 ? 0 : h >= 19 ? 5 : h === 15 || h === 16 ? (d === 0 ? 0.2 : 1) : 2)));

Deno.test("quiet hours: lowest 2-hour windows inside opening hours", () => {
  const w = quietWindows(arrivals, open, 2);
  assertEquals(w[0], { weekday: 0, start_hour: 15, avg_arrivals: 0.2 });
  assertEquals(w[1].start_hour, 15);
  assertEquals(w.length, 2);
  assertEquals(new Set(w.map((x) => x.weekday)).size, 2, "one window per weekday");
});

Deno.test("quiet hours: closed days produce nothing", () => {
  const closed = Array.from({ length: 7 }, () => Array(24).fill(false));
  assertEquals(quietWindows(arrivals, closed), []);
});

Deno.test("busiest slot", () => {
  assertEquals(busiestSlot(arrivals)?.hour, 19);
});

Deno.test("Arabic labels and summary template", () => {
  assertEquals(toArabicDigits(38), "٣٨");
  assertEquals(hourLabelAr(15), "٣ العصر");
  const text = summaryTemplate({ served: 38, avg_wait_min: 12, satisfaction_pct: 95, lost: 7, lost_sar: 350 },
    { weekday: 0, start_hour: 15, avg_arrivals: 0.2 });
  assertEquals(text, "ملخص اليوم: ٣٨ زبون، انتظار ١٢ د، ٩٥٪ راضون. خسرت ٧ زباين ≈ ٣٥٠ ريال. اقتراح: الأحد ٣ العصر–٥ هادئ، جرّب كوبون الهدوء.");
});

Deno.test("quiet coupon draft", () => {
  const d = quietCouponDraft({ weekday: 0, start_hour: 15, avg_arrivals: 0.2 });
  assertEquals([d.kind, d.start_time, d.end_time, d.weekdays], ["quiet_coupon", "15:00", "17:00", [0]]);
});

Deno.test("image media type sniffing", () => {
  assertEquals(imageMediaType("/9j/4AAQ"), "image/jpeg");
  assertEquals(imageMediaType("iVBORw0KGgoAAA"), "image/png");
  assertEquals(imageMediaType("UklGRiQAAABXRUJQ"), "image/webp");
  assertEquals(imageMediaType("R0lGOD"), null);
});

Deno.test("quest suggestions come from the shop's numbers", () => {
  const s = questSuggestions({ quiet: { weekday: 0, start_hour: 15, avg_arrivals: 0.2 }, absent: 3,
    providers: [{ provider_id: "a", name: "كرسي ١", served: 70 }, { provider_id: "b", name: "كرسي ٣", served: 40 }] });
  assertEquals(s.map((x) => x.kind), ["quiet", "visits", "comeback", "provider", "friend"]);
  assertEquals([s[0].time_start, s[0].time_end, s[0].rarity], ["15:00", "17:00", "rare"]);
  assertEquals(s[3].provider_id, "b");
  assertEquals(questSuggestions({ quiet: null, absent: 0, providers: [] }).map((x) => x.kind), ["visits", "friend"]);
});
