begin;
\ir 00_fixtures.inc
select plan(12);

create temp table fx as select pg_temp.mk_branch('basic') br;
alter table fx add column svc uuid, add column tok text, add column tok2 text, add column admin uuid;
update fx set svc = pg_temp.mk_service(br, 'remote', 20);
update fx set tok = (public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-w1') ->> 'ticket_token'),
              tok2 = (public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-w2') ->> 'ticket_token');
insert into auth.users(id, email) values ('c0000000-0000-4000-8000-0000000000c1', 'wa-admin@test.local');
insert into public.admins(user_id) values ('c0000000-0000-4000-8000-0000000000c1');
update fx set admin = 'c0000000-0000-4000-8000-0000000000c1';

select is(public.c_whatsapp_code(tok) ->> 'error', 'whatsapp_off', 'off until the admin enters the keys') from fx;
select is(public.a_whatsapp_save(admin, '{"display_number":"0551234567","phone_number_id":"123456789","access_token":"t","app_secret":"s","enabled":true}') ->> 'display_number',
          '966551234567', 'a local 05 number is stored in international form') from fx;
select is(public.a_whatsapp_save(admin, '{"display_number":"966551234567","phone_number_id":"123456789","access_token":"","app_secret":""}') ->> 'has_token',
          'true', 'empty token field keeps the stored token') from fx;
select ok(public.whatsapp_ready(), 'ready once number, id, token and secret are there');

create temp table c as select public.c_whatsapp_code(tok) r from fx;
select ok((select r ->> 'code' from c) ~ '^J[A-Z0-9]{6}$', 'a short code for the message');
select is((select public.c_whatsapp_code(tok) ->> 'code' from fx), (select r ->> 'code' from c), 'the same ticket keeps its code');
select is((select (r ->> 'linked')::boolean from c), false, 'not linked yet');

select is(public.wa_inbound('966500000001', 'نبّهني على دوري 🔔 رمز: ' || lower(r ->> 'code')) ->> 'kind', 'linked', 'the code links the WhatsApp number (any letter case)') from c;
select is((select public.c_whatsapp_code(tok) ->> 'linked' from fx), 'true', 'the ticket page sees the link');
select is((select jsonb_array_length(public.wa_targets(array[(select ticket_id from public.whatsapp_codes limit 1)]))), 1, 'the linked ticket is a target');
select is(public.wa_inbound('966500000001', 'JZZZZZZ') ->> 'kind', 'unknown_code', 'unknown code');
select public.wa_inbound('966500000001', 'إيقاف');
select is((select count(*)::int from public.whatsapp_links), 0, '«إيقاف» forgets the number');

select * from finish();
rollback;
