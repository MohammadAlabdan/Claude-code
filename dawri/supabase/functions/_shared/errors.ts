// Arabic and English messages for every error code the backend returns.
export const MESSAGES: Record<string, [ar: string, en: string, status: number]> = {
  invalid_json: ["الطلب غير مفهوم", "Request body is not valid JSON", 400],
  invalid_action: ["الإجراء غير معروف", "Unknown action", 400],
  invalid_input: ["في البيانات خطأ، راجعها وحاول مرة ثانية", "Some input is invalid", 400],
  unauthorized: ["سجّل دخولك أولاً", "Sign in first", 401],
  device_unpaired: ["هذا الجهاز غير مربوط، اطلب رابط الربط من صاحب المحل", "This device is not paired. Ask the owner for a pairing link", 401],
  forbidden: ["ما عندك صلاحية لهذا", "You do not have access to this", 403],
  feature_locked: ["هذه الميزة غير متاحة في باقتك الحالية", "This feature is not in your current plan", 403],
  branch_not_found: ["ما لقينا المحل", "Shop not found", 404],
  ticket_not_found: ["ما لقينا التذكرة، يمكن انتهت", "Ticket not found or expired", 404],
  offer_not_found: ["العرض غير موجود", "Offer not found", 404],
  not_found: ["غير موجود", "Not found", 404],
  invalid_service: ["الخدمة غير متاحة", "Service not available", 400],
  invalid_provider: ["مقدّم الخدمة غير متاح", "Provider not available", 400],
  invalid_party_size: ["العدد من ١ إلى ٦ أشخاص", "Party size must be 1 to 6", 400],
  invalid_receipt_code: ["اكتب رقم الطلب كما هو في الفاتورة", "Type the order number printed on your receipt", 400],
  invalid_steps: ["اختر دور أو دورين", "Choose 1 or 2 places", 400],
  invalid_subscription: ["تعذّر تفعيل التنبيه في هذا المتصفح", "Notifications could not be enabled in this browser", 400],
  invalid_phone: ["اكتب رقم جوال سعودي يبدأ بـ 05", "Enter a Saudi mobile number starting with 05", 400],
  invalid_code: ["الرمز غير صحيح أو انتهى، اطلب الرمز الجديد من الموظف", "Wrong or expired code. Ask staff for the current code", 400],
  invalid_state: ["ما يمكن تنفيذ هذا الآن", "This cannot be done right now", 409],
  closed: ["المحل مقفل الحين", "The shop is closed now", 409],
  closing_soon: ["الحجز من برّا يقفل قبل نهاية الدوام بنص ساعة", "Remote booking closes 30 minutes before closing", 409],
  remote_limit: ["الحجوزات من برّا مكتملة الحين، تقدر تجي للمحل مباشرة", "Remote spots are full right now. You can come to the shop directly", 409],
  not_waiting: ["التذكرة ما عادت بالانتظار", "This ticket is no longer waiting", 409],
  not_done: ["التقييم بعد انتهاء الخدمة", "Feedback opens after the service is done", 409],
  snooze_limit: ["استخدمت «تأخرت شوي» بالحد الأقصى", "You have used all your delays", 409],
  feedback_exists: ["سجّلنا تقييمك من قبل، شكراً لك", "We already have your feedback, thank you", 409],
  consent_required: ["نحتاج موافقتك لحفظ الرقم", "We need your consent to save the number", 400],
  no_reward: ["المكافأة لسا ما اكتملت", "Your reward is not ready yet", 409],
  offer_inactive: ["العرض غير متاح الحين", "This offer is not active now", 409],
  already_redeemed: ["استخدمت هذا العرض من قبل", "You already used this offer", 409],
  too_many_businesses: ["وصلت الحد الأعلى للمحلات في حسابك", "Business limit reached for this account", 409],
  quest_not_found: ["التحدّي غير موجود", "Challenge not found", 404],
  quest_ended: ["انتهى هذا التحدّي", "This challenge has ended", 409],
  quest_full: ["اكتمل العدد في هذا التحدّي", "This challenge is full", 409],
  quest_not_eligible: ["هذا التحدّي للي غابوا عنّا ٣ أسابيع", "This challenge is for customers away for 3 weeks", 409],
  phone_required: ["اكتب جوالك أولاً عشان نحسب زياراتك", "Add your mobile first so we can count your visits", 400],
  rate_limited: ["محاولات كثيرة، انتظر شوي وحاول مرة ثانية", "Too many attempts. Please wait and try again", 429],
  ai_unavailable: ["خدمة الذكاء الاصطناعي غير مفعّلة حالياً، وباقي النظام يعمل عادي", "AI is not configured right now; everything else keeps working", 503],
  ai_limit: ["وصلت حد استخدام الذكاء الاصطناعي لليوم", "Daily AI limit reached", 429],
  ai_failed: ["ما قدرنا نقرأ الطلب، جرّب مرة ثانية", "The AI request failed, please try again", 502],
  image_too_large: ["الصورة كبيرة، جرّب صورة أصغر من ٤ ميغا", "Image is too large (max 4 MB)", 413],
  server_error: ["صار خطأ عندنا، حاول بعد شوي", "Something went wrong on our side", 500],
};

export function errorBody(code: string, extra: Record<string, unknown> = {}) {
  const [ar, en] = MESSAGES[code] ?? MESSAGES.server_error;
  return { error: code, message_ar: ar, message_en: en, ...extra };
}

export function errorStatus(code: string): number {
  return (MESSAGES[code] ?? MESSAGES.server_error)[2];
}
