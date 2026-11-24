begin;
\ir 00_fixtures.inc
select plan(9);

-- one chair, 20-minute haircuts: each person ahead is 20 minutes
create temp table fx as select pg_temp.mk_branch('basic', null, '{"remote_join_limit": 10}') br;
alter table fx add column svc uuid, add column dev uuid, add column far text, add column near text;
update fx set svc = pg_temp.mk_service(br, 'remote', 20), dev = pg_temp.mk_device(br);
select public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-' || g) from fx, generate_series(1, 4) g;   -- 4 ahead
update fx set far = (public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-far') ->> 'ticket_token');
update fx set near = (public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-near') ->> 'ticket_token');
update public.tickets set push_enabled = true where branch_id = (select br from fx);

select is((public.public_ticket(far) ->> 'return_now')::boolean, false, 'no travel time: two turns rule, 4 ahead is too early') from fx;
select is(public.c_set_travel(far, 7) ->> 'error', 'invalid_input', 'only the offered choices') from fx;
-- far: 80 min wait, says 45 min away → not yet; after 2 calls (40 min wait) ≤ 45+5 → due
select is((public.c_set_travel(far, 45) -> 'ticket' ->> 'return_now')::boolean, false, '80 min left, 45 away: not yet') from fx;
select public.s_call_next(dev, null, null) from fx;
select public.s_call_next(dev, null, null) from fx;
select is((public.public_ticket(far) ->> 'return_now')::boolean, true, '40 min left, 45 away: leave now') from fx;
select ok(exists (select 1 from public.tickets t where t.access_token_hash = public.sha256_hex((select far from fx)) and t.return_now_sent), 'and the alert was sent once') ;
-- near: says next door (0): only when next
select is((public.c_set_travel(near, 0) -> 'ticket' ->> 'return_now')::boolean, false, 'next door, 3 ahead: no alert yet') from fx;
-- arrival: alert stops, staff sees it
select is((public.c_arrived(far) -> 'ticket' ->> 'arrived')::boolean, true, '«وصلت» is recorded') from fx;
select is((public.public_ticket(far) ->> 'return_now')::boolean, false, 'no "head back" banner once here') from fx;
select is((select e ->> 'arrived' from fx, jsonb_array_elements(public.s_state(dev) -> 'tickets') e
           where (e ->> 'id')::uuid = (select id from public.tickets where access_token_hash = public.sha256_hex(fx.far))), 'true', 'the staff screen shows who is here') from fx;

select * from finish();
rollback;
