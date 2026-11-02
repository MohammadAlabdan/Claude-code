-- Demo data: three shops, their owners, one platform admin, 28 days of history and a live day.
-- Everything here is marked demo. Remove it all with ONE statement:
--   with b as (delete from public.businesses where is_demo returning owner_user_id)
--   delete from auth.users where id in (select owner_user_id from b) or email like '%@demo.dawri.app';

-- ---------- users (password for all: Dawri-Demo-2026) ----------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
                        email_change_token_new, email_change, created_at, updated_at)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email,
       extensions.crypt('Dawri-Demo-2026', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', jsonb_build_object('name', u.name), '', '', '', '', now(), now()
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin@demo.dawri.app', 'مدير المنصة'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'cafe@demo.dawri.app', 'صاحب مقهى الركن'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'barber@demo.dawri.app', 'صاحب حلاق الأصيل'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'wash@demo.dawri.app', 'صاحب مغسلة اللمعة')
) u(id, email, name)
on conflict (id) do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now()
from auth.users u where u.email like '%@demo.dawri.app'
  and not exists (select 1 from auth.identities i where i.user_id = u.id);

insert into public.admins (user_id) values ('a0000000-0000-4000-8000-000000000001') on conflict do nothing;

-- ---------- businesses and branches ----------
insert into public.businesses (id, name, slug, category, plan, plan_until, trial_until, owner_user_id, is_demo) values
  ('b0000000-0000-4000-8000-000000000001', 'مقهى الركن', 'alrukn-cafe', 'cafe', 'growth', now() + interval '1 year', null,
   'a0000000-0000-4000-8000-000000000002', true),
  ('b0000000-0000-4000-8000-000000000002', 'حلاق الأصيل', 'alaseel-barber', 'barber', 'full', now() + interval '1 year', null,
   'a0000000-0000-4000-8000-000000000003', true),
  ('b0000000-0000-4000-8000-000000000003', 'مغسلة اللمعة', 'allamaa-wash', 'carwash', 'basic', now() + interval '1 year', null,
   'a0000000-0000-4000-8000-000000000004', true)
on conflict (id) do nothing;

insert into public.branches (id, business_id, name, public_id, address, map_url, phone, google_review_url, hours, settings) values
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'مقهى الركن · الياسمين', 'rukn2026',
   'حي الياسمين، الرياض', 'https://maps.google.com/?q=Al+Yasmin+Riyadh', '0112345671', 'https://g.page/r/demo-alrukn/review',
   (select jsonb_object_agg(d, '[["06:00","01:00"]]'::jsonb) from unnest(array['sun','mon','tue','wed','thu','fri','sat']) d),
   '{"avg_ticket_value_sar": 28, "summary_time": "23:00"}'),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'حلاق الأصيل · الملقا', 'aseel2026',
   'حي الملقا، الرياض', 'https://maps.google.com/?q=Al+Malqa+Riyadh', '0112345672', 'https://g.page/r/demo-alaseel/review',
   (select jsonb_object_agg(d, '[["09:00","03:00"]]'::jsonb) from unnest(array['sun','mon','tue','wed','thu','fri','sat']) d),
   '{"avg_ticket_value_sar": 50, "staff_languages": ["ar","ur","en"], "busy_alert_threshold": 10}'),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'مغسلة اللمعة · النرجس', 'lamaa2026',
   'حي النرجس، الرياض', 'https://maps.google.com/?q=Al+Narjis+Riyadh', '0112345673', null,
   (select jsonb_object_agg(d, '[["07:00","23:59"]]'::jsonb) from unnest(array['sun','mon','tue','wed','thu','fri','sat']) d),
   '{"avg_ticket_value_sar": 45, "staff_languages": ["ar","bn","fil"]}')
on conflict (id) do nothing;

insert into public.services (id, branch_id, name, mode, avg_minutes, sort) values
  ('d0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001', 'طلبات المقهى', 'receipt', 7, 0),
  ('d0000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000002', 'حلاقة شعر', 'remote', 20, 0),
  ('d0000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000002', 'حلاقة ذقن', 'remote', 10, 1),
  ('d0000000-0000-4000-8000-000000000023', 'c0000000-0000-4000-8000-000000000002', 'شعر وذقن', 'remote', 30, 2),
  ('d0000000-0000-4000-8000-000000000031', 'c0000000-0000-4000-8000-000000000003', 'غسيل خارجي', 'dropoff', 25, 0),
  ('d0000000-0000-4000-8000-000000000032', 'c0000000-0000-4000-8000-000000000003', 'غسيل داخلي وخارجي', 'dropoff', 45, 1)
on conflict (id) do nothing;

insert into public.providers (id, branch_id, display_name) values
  ('e0000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000002', 'كرسي ١ · أبو سعد'),
  ('e0000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000002', 'كرسي ٢ · ماجد'),
  ('e0000000-0000-4000-8000-000000000023', 'c0000000-0000-4000-8000-000000000002', 'كرسي ٣ · سلطان')
on conflict (id) do nothing;

-- Staff pairing links for the demo: /staff/pair#<token>
insert into public.staff_devices (id, branch_id, label, language, provider_id, token_hash) values
  ('f0000000-0000-4000-8000-000000000011', 'c0000000-0000-4000-8000-000000000001', 'شاشة المطبخ', 'ar', null,
   public.sha256_hex('demo-staff-rukn-kitchen-000000000000')),
  ('f0000000-0000-4000-8000-000000000021', 'c0000000-0000-4000-8000-000000000002', 'كرسي ١', 'ar',
   'e0000000-0000-4000-8000-000000000021', public.sha256_hex('demo-staff-aseel-chair1-000000000000')),
  ('f0000000-0000-4000-8000-000000000022', 'c0000000-0000-4000-8000-000000000002', 'كرسي ٢', 'ur',
   'e0000000-0000-4000-8000-000000000022', public.sha256_hex('demo-staff-aseel-chair2-000000000000')),
  ('f0000000-0000-4000-8000-000000000031', 'c0000000-0000-4000-8000-000000000003', 'استقبال المغسلة', 'bn', null,
   public.sha256_hex('demo-staff-lamaa-front-0000000000000'))
on conflict (id) do nothing;

insert into public.business_pages (branch_id, bio, highlights) values
  ('c0000000-0000-4000-8000-000000000001', 'قهوة مختصة وحلا طازج كل يوم، على زاوية شارع الياسمين.', '{"قهوة مختصة","جلسات خارجية"}'),
  ('c0000000-0000-4000-8000-000000000002', 'حلاق رجالي من ٢٠١٢. ثلاثة كراسي، وأدوات معقمة لكل زبون.', '{"أدوات معقمة","حلاقة أطفال","مواقف قريبة"}'),
  ('c0000000-0000-4000-8000-000000000003', 'غسيل يدوي بمواد آمنة على الطلاء، وتسليم في نفس اليوم.', '{"غسيل يدوي","تلميع"}')
on conflict (branch_id) do nothing;

insert into public.menu_items (branch_id, category, name, description, price_sar, duration_min, sort, service_id) values
  ('c0000000-0000-4000-8000-000000000001', 'قهوة', 'قهوة اليوم', 'محصول إثيوبي، تقطير', 14, null, 0, null),
  ('c0000000-0000-4000-8000-000000000001', 'قهوة', 'لاتيه', null, 18, null, 1, null),
  ('c0000000-0000-4000-8000-000000000001', 'قهوة', 'سبانش لاتيه', null, 20, null, 2, null),
  ('c0000000-0000-4000-8000-000000000001', 'حلا', 'كيكة تمر', 'بصوص التوفي', 16, null, 3, null),
  ('c0000000-0000-4000-8000-000000000001', 'حلا', 'كوكيز', null, 9, null, 4, null),
  ('c0000000-0000-4000-8000-000000000002', 'حلاقة', 'حلاقة شعر', null, 40, 20, 0, 'd0000000-0000-4000-8000-000000000021'),
  ('c0000000-0000-4000-8000-000000000002', 'حلاقة', 'حلاقة ذقن', null, 25, 10, 1, 'd0000000-0000-4000-8000-000000000022'),
  ('c0000000-0000-4000-8000-000000000002', 'حلاقة', 'شعر وذقن', null, 60, 30, 2, 'd0000000-0000-4000-8000-000000000023'),
  ('c0000000-0000-4000-8000-000000000002', 'عناية', 'تنظيف بشرة', null, 50, 25, 3, null);

insert into public.offers (branch_id, kind, title, terms, discount_text, weekdays, start_time, end_time) values
  ('c0000000-0000-4000-8000-000000000001', 'timed', 'قهوة الصباح', 'قهوة اليوم مع أي حلا قبل ١٠ الصباح', '١٠ ر.س', '{0,1,2,3,4,5,6}', '06:00', '10:00'),
  ('c0000000-0000-4000-8000-000000000001', 'timed', 'حلا المساء', 'الحلا الثاني بنصف السعر', '٥٠٪', '{0,1,2,3,4,5,6}', '18:00', '23:59'),
  ('c0000000-0000-4000-8000-000000000002', 'quiet_coupon', 'كوبون الهدوء', 'خصم على الحلاقة وقت العصر', '٢٠٪', '{0,1,2,3,4,5,6}', '15:00', '17:00'),
  ('c0000000-0000-4000-8000-000000000002', 'timed', 'حلاقة الأطفال', 'حلاقة طفل مع كل حلاقة شعر', '١٥ ر.س', '{0,1,2,3,4,5,6}', null, null);

insert into public.news_posts (branch_id, title, body, published_at) values
  ('c0000000-0000-4000-8000-000000000002', 'وصلنا كرسي ثالث', 'صار عندنا ثلاثة كراسي، والانتظار أقصر.', now() - interval '6 days'),
  ('c0000000-0000-4000-8000-000000000002', 'دوام العيد', 'نفتح من ٢ الظهر إلى ٣ الفجر أيام العيد.', now() - interval '2 days');

-- ---------- 28 days of history (deterministic pattern: busy evenings, quiet afternoons) ----------
with plan as (
  select br.id branch_id, s.id service_id, s.mode, s.avg_minutes, d::date as day, h as hr, k,
         (array['e0000000-0000-4000-8000-000000000021','e0000000-0000-4000-8000-000000000022',
                'e0000000-0000-4000-8000-000000000023'])[1 + (k + h) % 3]::uuid provider_id
  from public.branches br
  join public.services s on s.branch_id = br.id and s.sort = 0
  cross join generate_series(public.riyadh_today() - 28, public.riyadh_today() - 1, interval '1 day') d
  cross join generate_series(9, 23) h
  cross join generate_series(1, 6) k
  where br.id in ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
                  'c0000000-0000-4000-8000-000000000003')
    -- arrivals per hour: quiet 15–17, busy 19–22, fewer on Sunday
    and k <= case when h between 15 and 16 then 1 when h between 19 and 22 then 5 else 2 end
             - case when extract(dow from d) = 0 and k > 1 then 1 else 0 end
),
rows as (
  select p.*, (row_number() over (partition by p.branch_id, p.day order by p.hr, p.k))::int n,
         ((p.day + make_time(p.hr, (p.k * 9) % 60, 0)) at time zone 'Asia/Riyadh') joined
  from plan p
)
insert into public.tickets (branch_id, service_id, provider_id, mode, day, number, party_size, source, status, stage,
                            joined_at, called_at, served_at, done_at, left_at, sort_key, receipt_code, item_label)
select branch_id, service_id, case when mode = 'remote' then provider_id end, mode, day, n,
       case when n % 11 = 0 then 2 else 1 end,
       case mode when 'receipt' then 'receipt' when 'dropoff' then 'staff' else case when n % 4 = 0 then 'walk_in' else 'remote' end end,
       case when n % 17 = 0 then 'left' when n % 23 = 0 and mode = 'remote' then 'no_show' else 'done' end,
       case when mode = 'dropoff' then 'picked_up' end,
       joined,
       case when n % 17 <> 0 then joined + make_interval(mins => 4 + (n * 7) % 14) end,
       case when n % 17 <> 0 and not (n % 23 = 0 and mode = 'remote') then joined + make_interval(mins => 5 + (n * 7) % 14) end,
       case when n % 17 <> 0 and not (n % 23 = 0 and mode = 'remote') then joined + make_interval(mins => 5 + (n * 7) % 14 + avg_minutes - 3 + n % 7) end,
       case when n % 17 = 0 then joined + interval '12 minutes' end,
       joined,
       case when mode = 'receipt' then (100 + n)::text end,
       case when mode = 'dropoff' then 'سيارة ' || (array['كامري','سوناتا','يوكن','أكسنت','لاندكروزر'])[1 + n % 5] end
from rows;

-- feedback on history: mostly positive, a few private complaints
insert into public.feedback (ticket_id, branch_id, positive, reason, note, created_at)
select t.id, t.branch_id, t.number % 27 <> 0,
       case when t.number % 27 = 0 then (array['long_wait','quality','treatment','price'])[1 + t.number % 4] end,
       case when t.number % 54 = 0 then 'الانتظار طال أكثر من المتوقع' end,
       t.done_at + interval '3 minutes'
from public.tickets t
where t.status = 'done' and t.number % 3 = 0
  and t.branch_id in ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002');

-- loyalty: regulars, plus some who stopped coming (absent customers)
insert into public.loyalty_cards (branch_id, phone, visits, goal, rewards_redeemed, last_visit_at) values
  ('c0000000-0000-4000-8000-000000000002', '0551234501', 3, 6, 0, now() - interval '2 days'),
  ('c0000000-0000-4000-8000-000000000002', '0551234502', 7, 6, 1, now() - interval '5 days'),
  ('c0000000-0000-4000-8000-000000000002', '0551234503', 4, 6, 0, now() - interval '41 days'),
  ('c0000000-0000-4000-8000-000000000002', '0551234504', 2, 6, 0, now() - interval '55 days'),
  ('c0000000-0000-4000-8000-000000000002', '0551234505', 9, 6, 1, now() - interval '34 days'),
  ('c0000000-0000-4000-8000-000000000001', '0551234506', 5, 6, 0, now() - interval '1 day')
on conflict do nothing;

-- ---------- today: a live day in mixed states ----------
-- Barber: three served, one in the chair, five waiting (one with priority), one left, one no-show.
insert into public.tickets (branch_id, service_id, provider_id, mode, day, number, party_size, source, status,
                            priority, priority_reason, joined_at, called_at, served_at, done_at, left_at, sort_key,
                            push_enabled, customer_phone, phone_consent)
select 'c0000000-0000-4000-8000-000000000002', v.svc::uuid, v.prov::uuid, 'remote', public.riyadh_today(), v.n, v.party,
       v.src, v.st, v.prio, v.reason,
       now() - make_interval(mins => v.ago),
       case when v.st in ('done','serving','called','no_show') then now() - make_interval(mins => v.ago - 12) end,
       case when v.st in ('done','serving') then now() - make_interval(mins => v.ago - 13) end,
       case when v.st = 'done' then now() - make_interval(mins => v.ago - 33) end,
       case when v.st in ('left','no_show') then now() - make_interval(mins => v.ago - 9) end,
       now() - make_interval(mins => v.ago), v.push, v.phone, v.phone is not null
from (values
  (1, 'd0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000021', 1, 'remote', 'done', false, null, 140, true, '0551234501'),
  (2, 'd0000000-0000-4000-8000-000000000023', 'e0000000-0000-4000-8000-000000000022', 1, 'walk_in', 'done', false, null, 125, false, null),
  (3, 'd0000000-0000-4000-8000-000000000022', 'e0000000-0000-4000-8000-000000000023', 1, 'remote', 'done', false, null, 100, true, null),
  (4, 'd0000000-0000-4000-8000-000000000021', null, 1, 'remote', 'left', false, null, 90, true, null),
  (5, 'd0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000021', 2, 'remote', 'serving', false, null, 60, true, null),
  (6, 'd0000000-0000-4000-8000-000000000022', null, 1, 'remote', 'no_show', false, null, 55, false, null),
  (7, 'd0000000-0000-4000-8000-000000000021', null, 1, 'remote', 'waiting', false, null, 40, true, null),
  (8, 'd0000000-0000-4000-8000-000000000021', 'e0000000-0000-4000-8000-000000000022', 1, 'walk_in', 'waiting', true, 'elderly', 30, false, null),
  (9, 'd0000000-0000-4000-8000-000000000023', null, 3, 'remote', 'waiting', false, null, 22, true, null),
  (10, 'd0000000-0000-4000-8000-000000000021', null, 1, 'remote', 'waiting', false, null, 15, false, null),
  (11, 'd0000000-0000-4000-8000-000000000022', null, 1, 'remote', 'waiting', false, null, 5, true, null)
) v(n, svc, prov, party, src, st, prio, reason, ago, push, phone);

-- Café: receipt orders, some already ready.
insert into public.tickets (branch_id, service_id, mode, day, number, receipt_code, source, status,
                            joined_at, called_at, served_at, done_at, sort_key, push_enabled)
select 'c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000011', 'receipt', public.riyadh_today(),
       v.n, v.code, 'receipt', v.st, now() - make_interval(mins => v.ago),
       case when v.st = 'done' then now() - make_interval(mins => v.ago - 6) end,
       case when v.st = 'done' then now() - make_interval(mins => v.ago - 6) end,
       case when v.st = 'done' then now() - make_interval(mins => v.ago - 6) end,
       now() - make_interval(mins => v.ago), v.st = 'waiting'
from (values (1, '41', 'done', 30), (2, '42', 'done', 24), (3, '44', 'done', 15), (4, '45', 'waiting', 6), (5, '47', 'waiting', 3)) v(n, code, st, ago);
insert into public.ready_numbers (branch_id, day, receipt_code, ready_at)
select 'c0000000-0000-4000-8000-000000000001', public.riyadh_today(), c, now() - make_interval(mins => m)
from (values ('41', 24), ('42', 18), ('43', 12), ('44', 9)) v(c, m);

-- Car wash: cars at each stage.
insert into public.tickets (branch_id, service_id, mode, day, number, item_label, source, status, stage,
                            joined_at, called_at, served_at, done_at, sort_key)
select 'c0000000-0000-4000-8000-000000000003', v.svc::uuid, 'dropoff', public.riyadh_today(), v.n, v.label, 'staff',
       v.st, v.stage, now() - make_interval(mins => v.ago),
       case when v.stage in ('ready','picked_up') then now() - make_interval(mins => v.ago - 30) end,
       case when v.stage <> 'received' then now() - make_interval(mins => v.ago - 5) end,
       case when v.stage = 'picked_up' then now() - make_interval(mins => v.ago - 40) end,
       now() - make_interval(mins => v.ago)
from (values
  (1, 'd0000000-0000-4000-8000-000000000031', 'كامري بيضاء · أ ب ج ١٢٣٤', 'done', 'picked_up', 120),
  (2, 'd0000000-0000-4000-8000-000000000032', 'يوكن سوداء · ر س ع ٥٦٧٨', 'called', 'ready', 70),
  (3, 'd0000000-0000-4000-8000-000000000031', 'أكسنت فضية · ك ل م ٩٠١٢', 'serving', 'in_progress', 35),
  (4, 'd0000000-0000-4000-8000-000000000032', 'لاندكروزر · ط ي ن ٣٤٥٦', 'waiting', 'received', 10)
) v(n, svc, label, st, stage, ago);

insert into public.daily_summaries (branch_id, day, text, stats)
select br.id, public.riyadh_today() - 1,
       'ملخص اليوم: ' || (s ->> 'served') || ' زبون، متوسط الانتظار ' || coalesce(s ->> 'avg_wait_min', '٠') || ' د.',
       s
from public.branches br, lateral public.day_stats(br.id, public.riyadh_today() - 1) s
where br.id in ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',
                'c0000000-0000-4000-8000-000000000003')
on conflict do nothing;

insert into public.ticket_counters (branch_id, day, last_number)
select branch_id, day, max(number) from public.tickets group by branch_id, day
on conflict (branch_id, day) do update set last_number = excluded.last_number;

-- ---------- «تحدّياتي»: demo challenges ----------
insert into public.quests (branch_id, kind, title, description, service_id, required_visits, reward_text, rarity, max_participants,
                           weekdays, time_start, time_end, starts_at, ends_at) values
  ('c0000000-0000-4000-8000-000000000002', 'quiet', 'تحدّي العصر الهادئ', 'احلق مرتين وقت العصر هالأسبوع', null, 2, 'خصم ٢٠٪', 'rare', 20,
   '{0,1,2,3,4,5,6}', '15:00', '17:00', now() - interval '2 days', now() + interval '5 days'),
  ('c0000000-0000-4000-8000-000000000002', 'visits', 'ثلاث حلاقات', 'ثلاث حلاقات شعر خلال أسبوعين', 'd0000000-0000-4000-8000-000000000021', 3, 'الرابعة علينا', 'common', null,
   '{0,1,2,3,4,5,6}', null, null, now() - interval '3 days', now() + interval '11 days'),
  ('c0000000-0000-4000-8000-000000000002', 'friend', 'تعال مع خويك', 'زيارتين بتذكرة لشخصين', null, 2, 'ذقن مجاناً للاثنين', 'common', null,
   '{0,1,2,3,4,5,6}', null, null, now() - interval '1 day', now() + interval '13 days'),
  ('c0000000-0000-4000-8000-000000000001', 'visits', 'قهوة الأسبوع', 'ثلاث قهاوي خلال ٧ أيام', 'd0000000-0000-4000-8000-000000000011', 3, 'خصم ١٥٪', 'common', null,
   '{0,1,2,3,4,5,6}', null, null, now() - interval '1 day', now() + interval '6 days');

insert into public.quest_progress (quest_id, branch_id, phone, visits)
select q.id, q.branch_id, p.phone, 1
from public.quests q cross join (values ('0551234501'), ('0551234502'), ('0551234503'), ('0551234504'), ('0551234505'),
  ('0551234510'), ('0551234511'), ('0551234512'), ('0551234513'), ('0551234514'), ('0551234515'), ('0551234516'),
  ('0551234517'), ('0551234518')) p(phone)
where q.title = 'تحدّي العصر الهادئ'
on conflict do nothing;
