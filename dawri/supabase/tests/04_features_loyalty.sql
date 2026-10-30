begin;
\ir 00_fixtures.inc
select plan(15);

create temp table fx as select pg_temp.mk_branch('basic') basic, pg_temp.mk_branch('growth') growth;
alter table fx add column svc uuid, add column gsvc uuid, add column gdev uuid;
update fx set svc = pg_temp.mk_service(basic), gsvc = pg_temp.mk_service(growth), gdev = pg_temp.mk_device(growth);

select ok(public.has_feature(basic, 'queue'), 'basic has the queue') from fx;
select ok(not public.has_feature(basic, 'loyalty'), 'basic has no loyalty') from fx;
select ok(public.has_feature(growth, 'loyalty') and not public.has_feature(growth, 'news'), 'growth has loyalty, not news') from fx;
select is(public.feature_min_plan('quiet_coupon'), 'full', 'quiet_coupon needs full');
select is(public.c_join(pg_temp.pid(basic), svc, null, 1, 'ar', null) ->> 'ticket_token' is not null, true, 'basic can join') from fx;

-- locked feature answer
create temp table tb as select public.c_join(pg_temp.pid(basic), svc, null, 1, 'ar', null) ->> 'ticket_token' tok from fx;
select is(public.c_set_phone(tok, '0551112222', true), '{"error":"feature_locked","feature":"loyalty","required_plan":"growth"}'::jsonb,
          'locked features answer with the required plan') from tb;

-- trial means full; expired plan means nothing
update public.businesses set trial_until = now() + interval '3 days'
 where id = (select business_id from public.branches where id = (select basic from fx));
select ok(public.has_feature(basic, 'news'), 'trial unlocks the full plan') from fx;
update public.businesses set trial_until = null, plan_until = now() - interval '1 day'
 where id = (select business_id from public.branches where id = (select basic from fx));
select ok(not public.has_feature(basic, 'queue'), 'expired plan locks everything') from fx;

-- loyalty: consent required, visit counted once on done
create temp table tg as select public.c_join(pg_temp.pid(growth), gsvc, null, 1, 'ar', null) ->> 'ticket_token' tok from fx;
select is(public.c_set_phone(tok, '0551112222', false) ->> 'error', 'consent_required', 'phone needs explicit consent') from tg;
select is(public.c_set_phone(tok, '12345', true) ->> 'error', 'invalid_phone', 'Saudi mobile format only') from tg;
select is(public.c_set_phone(tok, '٠٥٥١١١٢٢٢٢', true) ->> 'ok', 'true', 'Arabic digits are accepted') from tg;
select public.s_done(gdev, (public.ticket_by_token(tok)).id) from fx, tg;
select public.s_done(gdev, (public.ticket_by_token(tok)).id) from fx, tg;
select is((select visits from public.loyalty_cards where phone = '0551112222'), 1, 'a visit is counted once');

-- rotating code: 4 digits, current and previous minute only
select is(public.rotating_code_at('dawri-test-secret', 29000000), '1815', 'matches the shared test vector');
select ok(public.rotating_code_valid(growth, public.s_rotating_code(gdev) ->> 'code'), 'current code is valid') from fx;
select ok(not public.rotating_code_valid(growth,
          public.rotating_code_at((select redemption_secret from public.branches where id = growth), public.unix_minute() - 2)),
          'a code from two minutes ago is rejected') from fx;

select * from finish();
rollback;
