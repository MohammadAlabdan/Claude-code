// Push notification texts (customers: ar/en; owners: ar) and staff status labels in five languages.
import { toArabicDigits } from "./logic.ts";

type Lang = "ar" | "en";

export function customerPush(kind: string, lang: Lang, t: { number?: number; stage?: string; receipt_code?: string; shop?: string }) {
  const n = lang === "ar" ? toArabicDigits(t.number ?? "") : String(t.number ?? "");
  const shop = t.shop ?? (lang === "ar" ? "دوري" : "Dawri");
  const texts: Record<string, [string, string]> = {
    return_now: ["ارجع الآن، باقي قبلك دوران", "Head back now, two turns before you"],
    called: [`حان دورك، تفضّل (رقم ${n})`, `It's your turn, number ${n}`],
    ready: ["طلبك جاهز", "Your order is ready"],
    stage_in_progress: ["بدأنا الشغل على طلبك", "We started working on your order"],
    stage_ready: ["جاهزة للاستلام", "Ready for pickup"],
  };
  const key = kind === "stage" ? `stage_${t.stage}` : kind;
  const [ar, en] = texts[key] ?? texts.called;
  return { title: shop, body: lang === "ar" ? ar : en };
}

export function ownerBusyAlert(count: number) {
  return { title: "إنذار الزحمة", body: `الطابور وصل ${toArabicDigits(count)}، فيه زبائن ممكن يطلعون` };
}

export const STAFF_LABELS: Record<string, Record<string, string>> = {
  ar: { waiting: "بالانتظار", called: "تم النداء", serving: "يُخدم الآن", done: "تم", no_show: "لم يحضر",
        cancelled: "ملغي", left: "خرج", received: "استلمنا", in_progress: "قيد العمل", ready: "جاهزة", picked_up: "تم الاستلام" },
  en: { waiting: "Waiting", called: "Called", serving: "Serving", done: "Done", no_show: "No-show",
        cancelled: "Cancelled", left: "Left", received: "Received", in_progress: "In progress", ready: "Ready", picked_up: "Picked up" },
  ur: { waiting: "انتظار میں", called: "بلایا گیا", serving: "خدمت جاری", done: "مکمل", no_show: "نہیں آیا",
        cancelled: "منسوخ", left: "چلا گیا", received: "وصول کیا", in_progress: "کام جاری", ready: "تیار", picked_up: "لے لیا" },
  bn: { waiting: "অপেক্ষমাণ", called: "ডাকা হয়েছে", serving: "সেবা চলছে", done: "সম্পন্ন", no_show: "আসেনি",
        cancelled: "বাতিল", left: "চলে গেছে", received: "গ্রহণ করা হয়েছে", in_progress: "কাজ চলছে", ready: "প্রস্তুত", picked_up: "নিয়ে গেছে" },
  fil: { waiting: "Naghihintay", called: "Tinawag na", serving: "Sineserbisyuhan", done: "Tapos", no_show: "Hindi dumating",
         cancelled: "Kinansela", left: "Umalis", received: "Natanggap", in_progress: "Ginagawa", ready: "Handa na", picked_up: "Nakuha na" },
};
