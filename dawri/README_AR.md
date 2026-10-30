# دوري: دليل التشغيل

«دوري» نظام انتظار رقمي للمحلات الصغيرة. هذا الدليل يشرح خطوة بخطوة كيف تشغّل الخادم (الباك إند) على Supabase، بلغة بسيطة ومن غير خبرة برمجية.

> ما تحتاج: حساب على [supabase.com](https://supabase.com)، وجهاز كمبيوتر. الأوامر مكتوبة في صناديق، انسخها كما هي.

---

## أولاً: الخادم (الباك إند)

### ١. أنشئ مشروع Supabase

1. ادخل [supabase.com/dashboard](https://supabase.com/dashboard) واضغط **New project**.
2. اختر اسماً مثل `dawri`، واكتب كلمة مرور قوية لقاعدة البيانات واحفظها عندك.
3. اختر المنطقة الأقرب (مثلاً **Frankfurt** أو **Mumbai**)، واضغط **Create new project**، وانتظر دقيقتين.
4. من **Project Settings ← General** انسخ **Reference ID** (مثل `abcdefghijklmn`). نسميه في هذا الدليل `PROJECT_REF`.

### ٢. فعّل الإضافات المطلوبة

من **Database ← Extensions** فعّل:
- `pg_cron` (المهام المجدولة)
- `pg_net` (اتصال قاعدة البيانات بالدوال)

`pgcrypto` مفعّلة من الأساس.

### ٣. شغّل ملفات قاعدة البيانات (migrations)

**الطريقة الأولى: سطر الأوامر (أسرع)**

ثبّت أداة Supabase مرة واحدة (تحتاج Node.js):

```bash
npm install -g supabase
```

ثم من داخل مجلد `dawri`:

```bash
supabase login
```

```bash
supabase link --project-ref PROJECT_REF
```

```bash
supabase db push
```

**الطريقة الثانية: من المتصفح بدون أي أداة**

1. افتح **SQL Editor** في لوحة Supabase.
2. افتح الملفات من مجلد `supabase/migrations` **بالترتيب** (الرقم في أول الاسم هو الترتيب):
   1. `20261030000100_schema.sql`
   2. `20261030000200_helpers.sql`
   3. `20261030000300_queue.sql`
   4. `20261030000400_public_owner.sql`
   5. `20261030000500_storage.sql`
   6. `20261030000700_cron.sql`
   7. `20261030000900_security.sql`
3. لكل ملف: انسخ محتواه كاملاً، الصقه في محرر SQL، واضغط **Run**. انتظر رسالة النجاح ثم انتقل للملف التالي.

**بيانات تجريبية (اختياري):** شغّل `supabase/seed.sql` بنفس الطريقة لتحصل على ثلاثة محلات تجريبية. لحذفها لاحقاً بأمر واحد:

```sql
with b as (delete from public.businesses where is_demo returning owner_user_id)
delete from auth.users where id in (select owner_user_id from b) or email like '%@demo.dawri.app';
```

### ٤. احفظ رابط المشروع والمفتاح في الخزنة (Vault)

المهام المجدولة (ملخص المساء والصيانة) تحتاج تعرف عنوان مشروعك. من **Project Settings ← API** انسخ:
- **Project URL** (مثل `https://abcdefghijklmn.supabase.co`)
- **service_role key** (سري، لا تشاركه أبداً)

ثم في **SQL Editor** شغّل (بعد استبدال القيم):

```sql
select vault.create_secret('https://PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('ضع هنا service_role key', 'service_role_key');
```

إذا شغّلت ملف `20261030000700_cron.sql` **قبل** تفعيل `pg_cron` و`pg_net`، فعّلهما ثم شغّل الملف مرة ثانية.

### ٥. أنشئ مفاتيح التنبيهات (VAPID)

التنبيهات مجانية عبر المتصفح، وتحتاج زوج مفاتيح. ثبّت [Deno](https://deno.com) ثم من مجلد `dawri`:

```bash
deno run scripts/gen-vapid.ts
```

يطبع سطرين: `VAPID_PUBLIC_KEY` و`VAPID_PRIVATE_KEY`. احفظهما.
- المفتاح **العام** يُكتب في الواجهة (`web/config.js`) وفي أسرار الدوال.
- المفتاح **الخاص** في أسرار الدوال فقط، ولا يوضع في الواجهة أبداً.

### ٦. أضف الأسرار (Secrets)

**بسطر الأوامر:**

```bash
supabase secrets set SITE_URL=https://اسم-موقعك.netlify.app VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
```

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... ANTHROPIC_MODEL_FAST=claude-haiku-5-5 ANTHROPIC_MODEL_VISION=claude-sonnet-5-5
```

**أو من المتصفح:** **Edge Functions ← Secrets ← Add new secret**، وأضف كل اسم وقيمته.

| الاسم | ما هو |
|---|---|
| `SITE_URL` | رابط الواجهة بعد رفعها على Netlify (بدون `/` في الآخر) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | من الخطوة ٥ |
| `VAPID_SUBJECT` | بريدك بصيغة `mailto:you@example.com` |
| `ANTHROPIC_API_KEY` | مفتاح Claude (اختياري؛ بدونه تتوقف ميزات الذكاء الاصطناعي فقط ويعمل الباقي) |
| `ANTHROPIC_MODEL_FAST` / `ANTHROPIC_MODEL_VISION` | أسماء النماذج (القيم الافتراضية أعلاه) |
| `AI_DAILY_CAP` | حد استخدام الذكاء الاصطناعي اليومي لكل محل (افتراضي 200) |

`SUPABASE_URL` و`SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY` تضيفها Supabase للدوال تلقائياً.

### ٧. ارفع الدوال (Edge Functions)

**بسطر الأوامر** (من مجلد `dawri`):

```bash
supabase functions deploy customer staff owner onboard ai daily-summary maintenance admin --no-verify-jwt
```

**أو من المتصفح:** **Edge Functions ← Deploy a new function ← Via Editor**. لكل دالة من الثمانية:
1. اكتب اسمها كما هو (`customer`، `staff`، ...).
2. انسخ ملف `supabase/functions/<الاسم>/index.ts`، وأضف ملفات مجلد `_shared` بنفس أسمائها، وملف `deno.json`.
3. من إعدادات الدالة أطفئ **Enforce JWT verification**.
4. اضغط **Deploy**.

### ٨. أنشئ حساب مدير المنصة

1. من **Authentication ← Users ← Add user** أنشئ مستخدماً ببريدك وكلمة مرور.
2. انسخ **User UID** من قائمة المستخدمين.
3. في **SQL Editor**:

```sql
insert into public.admins (user_id) values ('ضع هنا User UID');
```

وتأكد من **Authentication ← Providers**: البريد الإلكتروني مفعّل، و**Phone** مطفأ (دوري لا يستخدم الرسائل النصية).

### ٩. المفتاح الذي تحتاجه الواجهة (الجزء الثاني)

من **Project Settings ← API** انسخ:
- **Project URL** ← `SUPABASE_URL`
- **anon public key** (أو publishable key) ← `SUPABASE_ANON_KEY`

وضعهما مع `VAPID_PUBLIC_KEY` في `web/config.js`. هذا المفتاح آمن للواجهة لأن كل الجداول محمية.

---

## حسابات التجربة (إذا شغّلت seed.sql)

كلمة المرور لكل الحسابات: `Dawri-Demo-2026`

| الحساب | الدور |
|---|---|
| `admin@demo.dawri.app` | مدير المنصة |
| `cafe@demo.dawri.app` | صاحب «مقهى الركن» (ادفع وانتظر، باقة النمو) |
| `barber@demo.dawri.app` | صاحب «حلاق الأصيل» (احجز دورك من برّا، ٣ كراسي، الباقة المتكاملة) |
| `wash@demo.dawri.app` | صاحب «مغسلة اللمعة» (سلّم وارجع، الباقة الأساسية) |

صفحات المحلات: `/s/rukn2026` و`/s/aseel2026` و`/s/lamaa2026`.

روابط ربط أجهزة الموظفين التجريبية (افتحها على الجوال):

| الجهاز | الرابط |
|---|---|
| مطبخ مقهى الركن (عربي) | `/staff/pair#demo-staff-rukn-kitchen-000000000000` |
| كرسي ١ في حلاق الأصيل (عربي) | `/staff/pair#demo-staff-aseel-chair1-000000000000` |
| كرسي ٢ في حلاق الأصيل (أردو) | `/staff/pair#demo-staff-aseel-chair2-000000000000` |
| استقبال مغسلة اللمعة (بنغالي) | `/staff/pair#demo-staff-lamaa-front-0000000000000` |

---

## للمطوّر: الاختبارات

قاعدة البيانات (تحتاج Supabase CLI وDocker):

```bash
supabase start
```

```bash
supabase db reset
```

```bash
supabase test db
```

بدون Docker، على أي PostgreSQL 16 مع pgTAP:

```bash
scripts/local-db/reset.sh --test
```

اختبارات منطق الدوال:

```bash
cd supabase/functions && deno test _shared/
```

تفاصيل القرارات وما تم التحقق منه في `DECISIONS.md`، وعقد الواجهة الكامل في `API_CONTRACT.md`.

---

## الواجهة (تطبيق الجوال)

الواجهة موقع ثابت في مجلد `web/` يعمل كتطبيق على الجوال (PWA): الزبون يفتح الرابط، والموظف والمالك يقدرون يضيفونه للشاشة الرئيسية. ما يحتاج أي بناء أو أدوات، والملف الجاهز للرفع هو `dawri-web.zip`.

### ١. ضع مفاتيح Supabase في `web/config.js`

افتح `web/config.js` بأي محرر نصوص وغيّر القيم:

```js
window.DAWRI_CONFIG = {
  SUPABASE_URL: "https://PROJECT_REF.supabase.co",   // من Project Settings ← API
  SUPABASE_ANON_KEY: "anon public key",               // من نفس الصفحة
  VAPID_PUBLIC_KEY: "المفتاح العام من الخطوة ٥",
  DEMO_MODE: false,                                   // أطفئ الوضع التجريبي
};
```

### ٢. الوضع التجريبي

ما دام `DEMO_MODE: true` يعمل التطبيق كاملاً داخل المتصفح بثلاثة محلات تجريبية (مقهى الركن، حلاق الأصيل، مغسلة اللمعة) بدون أي خادم، ويظهر شريط «وضع تجريبي» أعلى الشاشة. الطابور يتحرك وحده كل ١٥ ثانية تقريباً. افتح صفحة المحل في تبويب وشاشة الموظف في تبويب ثاني وجرّب. لإيقافه غيّر القيمة إلى `false` بعد وضع المفاتيح.

### ٣. جهّز ملف الرفع

إذا عدّلت `config.js` أو أي ملف، أعد إنشاء الملف المضغوط (يحتاج Node.js):

```bash
node scripts/package-web.mjs
```

### ٤. ارفع على Netlify بالسحب والإفلات

1. ادخل [app.netlify.com/drop](https://app.netlify.com/drop).
2. اسحب ملف `dawri-web.zip` (أو مجلد `web` نفسه) وأفلته في الصفحة.
3. خلال ثوانٍ يعطيك رابطاً مثل `https://dawri-xxxx.netlify.app`. غيّر الاسم من **Site configuration ← Change site name**.
4. ضع هذا الرابط في سر `SITE_URL` في Supabase (الخطوة ٦ في الأعلى)، وفي **Authentication ← URL Configuration ← Site URL**، حتى تعمل روابط ربط الموظفين وروابط الدخول.

ملف `_redirects` داخل `web/` يخلي روابط مثل `/s/aseel2026` و`/staff` تفتح التطبيق مباشرة.

### ٥. جرّبه على الجوال

1. افتح الرابط على جوالك: الصفحة الرئيسية `/`، صفحة محل `/s/<رمز المحل>`، شاشة الموظف `/staff`، لوحة المالك `/owner`، التهيئة `/start`.
2. ابدأ من `/start`: أنشئ حساباً، وأجب على الأسئلة، وفي النهاية يعطيك رابط صفحة المحل وملصق QR ورمز ربط جوال الموظف.
3. امسح رمز الربط من جوال الموظف، وخذ رقم من جوال ثاني، واضغط «نادِ التالي»، وتأكد أن الجوال الثاني رنّ.

### ٦. أضفه للشاشة الرئيسية

- **أندرويد (Chrome):** القائمة ⋮ ثم «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق».
- **آيفون (Safari):** زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»، ثم افتح دوري من الأيقونة. التنبيهات على الآيفون تعمل فقط بعد هذه الخطوة، والتطبيق يشرحها للزبون بخطوتين.

### للمطوّر

```bash
npm install
```

```bash
npm run serve
```

```bash
npx playwright test
```

`npm run icons` يعيد توليد الأيقونات من `web/assets/logo.svg`، وصفحة `/dev/ui` تعرض كل المكوّنات في الوضعين الفاتح والداكن.
