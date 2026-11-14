begin;
\ir 00_fixtures.inc
select plan(12);

create temp table fx as select gen_random_uuid() adm;
insert into auth.users(id, email) select adm, adm || '@admin.local' from fx;
insert into public.admins(user_id) select adm from fx;

create temp table c as select public.a_create_business(adm, jsonb_build_object(
  'business_name', 'صالون التجربة', 'category', 'salon', 'owner_email', 'New.Owner@Example.com', 'owner_password', 'temporary-1',
  'plan', 'growth', 'status', 'active', 'start', '2026-01-01', 'duration', 3, 'unit', 'month')) r from fx;
select ok((select r ? 'business_id' from c), 'admin adds a shop');
select is((select r ->> 'owner_created' from c), 'true', 'a new owner account is created');
select is((select (r -> 'subscription' ->> 'plan_until')::timestamptz at time zone 'Asia/Riyadh' from c)::date, '2026-04-01'::date,
  'three months from 1 January end on 1 April (end of day, Riyadh)');
select ok((select encrypted_password = extensions.crypt('temporary-1', encrypted_password) from auth.users where email = 'new.owner@example.com'),
  'the owner can sign in with the temporary password');
select is((select count(*)::int from public.branches br join public.businesses b on b.id = br.business_id where b.name = 'صالون التجربة'), 1, 'with its first branch');

select is(public.a_update_business(adm, (select (r ->> 'business_id')::uuid from c), '{"status":"trial","start":"2026-11-01","duration":14,"unit":"day"}') -> 'business' ->> 'status',
  case when now() < '2026-11-15 23:59:59+03'::timestamptz then 'trial' else 'inactive' end, 'switching to a 14-day trial') from fx;
select is((select (trial_until at time zone 'Asia/Riyadh')::date from public.businesses where name = 'صالون التجربة'), '2026-11-15'::date, 'trial end computed from start + days');
select is(public.a_update_business(adm, (select (r ->> 'business_id')::uuid from c), '{"status":"inactive"}') -> 'business' ->> 'status', 'inactive', 'stopping a client') from fx;
select is(public.a_update_business(adm, (select (r ->> 'business_id')::uuid from c), '{"status":"active","duration":0,"unit":"month"}') ->> 'error', 'invalid_input', 'duration must be positive') from fx;
select is(public.a_create_business(gen_random_uuid(), '{}') ->> 'error', 'forbidden', 'only admins add shops');

select is(public.a_delete_business(adm, (select (r ->> 'business_id')::uuid from c), true) ->> 'owner_deleted', 'true', 'delete shop and its owner') from fx;
select is((select count(*)::int from auth.users where email = 'new.owner@example.com'), 0, 'owner account removed');

select * from finish();
rollback;
