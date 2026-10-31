# تثبيت دوري على VPS (هوستنقر أو غيره)

يثبّت هذا السكربت على السيرفر: Supabase (نسخة ذاتية مجانية)، وقاعدة بيانات دوري، والدوال، والتطبيق، مع شهادة HTTPS تلقائية.

## المتطلبات
- سيرفر Ubuntu 22.04 أو 24.04، رام ٤ جيجا أو أكثر (KVM 4 ممتاز).
- المنافذ 80 و443 و8443 مفتوحة في جدار حماية هوستنقر (VPS ← Security ← Firewall).
- المنفذان 80 و443 غير مستخدمين في برنامج آخر على السيرفر.

## التثبيت (أمر واحد)
1. من لوحة هوستنقر افتح **Browser terminal** (أو اتصل بـ SSH كمستخدم root).
2. الصق هذا الأمر واضغط Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/MohammadAlabdan/Claude-code/claude/new-session-kshbvu/dawri/deploy/vps/install.sh | bash
```

3. انتظر ١٠–١٥ دقيقة. في النهاية يطبع الروابط وكلمات المرور.

بالدومين الخاص (اختياري، بعد توجيه سجل A للدومين إلى IP السيرفر):

```bash
curl -fsSL https://raw.githubusercontent.com/MohammadAlabdan/Claude-code/claude/new-session-kshbvu/dawri/deploy/vps/install.sh | DOMAIN=dawri.example.com bash
```

## بعد التثبيت
- التطبيق: `https://اسم-السيرفر` — المحلات التجريبية وحساباتها تعمل مباشرة.
- لوحة Supabase (Studio): `https://اسم-السيرفر:8443` باسم المستخدم وكلمة المرور المطبوعة.
- الأسرار في `/opt/dawri/supabase/.env` و`/opt/dawri/dawri.env`. لا تشاركها.
- لتفعيل الذكاء الاصطناعي: أضف `ANTHROPIC_API_KEY` في `/opt/dawri/dawri.env` ثم:

```bash
cd /opt/dawri/supabase && docker compose up -d functions
```

- للتحديث بعد أي تعديل في الكود: أعد تشغيل نفس أمر التثبيت. البيانات والأسرار تبقى.
- لحذف البيانات التجريبية: أمر الحذف في أول ملف `supabase/seed.sql`.
