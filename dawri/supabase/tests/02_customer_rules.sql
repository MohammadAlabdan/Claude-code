begin;
\ir 00_fixtures.inc
select plan(23);

create temp table fx as select pg_temp.mk_branch('full', null, '{"remote_join_limit": 2}') br;
alter table fx add column svc uuid, add column dev uuid;
update fx set svc = pg_temp.mk_service(br), dev = pg_temp.mk_device(br);

-- joining and the remote limit
create temp table j as
  select public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', null) r1,
         public.c_join(pg_temp.pid(br), svc, null, 2, 'ar', null) r2,
         public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', null) r3 from fx;
select ok((r1 ->> 'ticket_token') is not null, 'join returns a token') from j;
select is((r2 -> 'ticket' ->> 'position')::int, 1, 'second joiner has one ahead') from j;
select is(r3 ->> 'error', 'remote_limit', 'remote joins stop at remote_join_limit') from j;
select ok((public.ticket_by_token(r1 ->> 'ticket_token')).id is not null, 'token resolves') from j;
select is((select count(*)::int from public.tickets where access_token_hash = r1 ->> 'ticket_token'), 0,
          'only the hash of the token is stored') from j;

-- snooze (late button): moves back, limited by snooze_max
select is(public.c_snooze(r1 ->> 'ticket_token', 1) -> 'ticket' ->> 'position', '1', 'late button moves back one') from j;
select is((public.c_snooze(r1 ->> 'ticket_token', 3)) ->> 'error', 'invalid_steps', 'only 1 or 2 steps') from j;
select is((public.c_snooze(r1 ->> 'ticket_token', 1)) ->> 'ok', 'true', 'second snooze allowed') from j;
select is((public.c_snooze(r1 ->> 'ticket_token', 1)) ->> 'error', 'snooze_limit', 'third snooze refused') from j;

-- return-now push goes once to tickets within the threshold that enabled push
update public.tickets set push_enabled = true, return_now_sent = false where branch_id = (select br from fx);
select is(jsonb_array_length(public.collect_return_now(br)), 2, 'both waiting tickets are within 2') from fx;
select is(jsonb_array_length(public.collect_return_now(br)), 0, 'and are notified only once') from fx;

-- leaving
select is(public.c_leave(r2 ->> 'ticket_token') ->> 'ok', 'true', 'customer can leave') from j;
select is((public.public_ticket(r2 ->> 'ticket_token')) ->> 'status', 'left', 'left status visible') from j;

-- rate limit by fingerprint: 3 joins per hour per branch
update fx set br = br;
select is((select count(*)::int from generate_series(1, 3) g
           where public.hit_rate_limit('join:test:fp', 3)), 3, 'three joins allowed');
select is(public.hit_rate_limit('join:test:fp', 3), false, 'fourth join in the hour refused');

-- closed branch and closing soon
create temp table closed as select pg_temp.mk_branch('basic', '{}'::jsonb) br;
alter table closed add column svc uuid;
update closed set svc = pg_temp.mk_service(br);
select is(public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', null) ->> 'error', 'closed', 'closed branch refuses joins') from closed;
create temp table soon as select pg_temp.mk_branch('basic',
  (select jsonb_object_agg(d, jsonb_build_array(jsonb_build_array(
     to_char(public.riyadh_local() - interval '2 hours', 'HH24:MI'),
     to_char(public.riyadh_local() + interval '10 minutes', 'HH24:MI'))))
   from unnest(array['sun','mon','tue','wed','thu','fri','sat']) d)) br;
alter table soon add column svc uuid;
update soon set svc = pg_temp.mk_service(br);
select is(public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', null) ->> 'error', 'closing_soon',
          'remote joins stop 30 minutes before closing') from soon;

-- receipt mode: idempotent per code, ready before scan
create temp table rc as select pg_temp.mk_branch('basic') br;
alter table rc add column svc uuid, add column dev uuid;
update rc set svc = pg_temp.mk_service(br, 'receipt'), dev = pg_temp.mk_device(br);
select is(public.c_join_receipt(pg_temp.pid(br), svc, '47', 'ar', null) ->> 'ticket_token',
          public.c_join_receipt(pg_temp.pid(br), svc, ' 47 ', 'ar', null) ->> 'ticket_token',
          'same receipt code gives the same ticket') from rc;
select is(jsonb_array_length(public.s_mark_ready(dev, '47') -> 'notify'), 1, 'mark_ready notifies the scanned ticket') from rc;
select is(public.s_mark_ready(dev, '50') ->> 'customer_linked', 'false', 'kitchen can mark a number before the scan') from rc;
select is(public.c_join_receipt(pg_temp.pid(br), svc, '50', 'ar', null) -> 'ticket' ->> 'ready', 'true',
          'scanning a ready number shows it ready at once') from rc;

-- dropoff: claim link works once
create temp table dr as select pg_temp.mk_branch('basic') br;
alter table dr add column svc uuid, add column dev uuid, add column claim text;
update dr set svc = pg_temp.mk_service(br, 'dropoff'), dev = pg_temp.mk_device(br);
update dr set claim = public.s_dropoff_create(dev, svc, 'كامري بيضاء') ->> 'claim_token';
select ok((public.c_claim_dropoff(claim) ->> 'ticket_token') is not null, 'claim link gives a ticket token') from dr;
select is(public.c_claim_dropoff(claim) ->> 'error', 'ticket_not_found', 'claim link is one-time') from dr;

select * from finish();
rollback;
