begin;
\ir 00_fixtures.inc
select plan(9);

create temp table fx as select pg_temp.mk_branch('basic') br;
alter table fx add column svc uuid, add column dev uuid;
update fx set svc = pg_temp.mk_service(br), dev = pg_temp.mk_device(br);
-- four people waiting
create temp table tk as select public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-' || g) ->> 'ticket_token' tok, g from fx, generate_series(1, 4) g;

select is((public.c_quiet_watch(pg_temp.pid(br), 'https://push.example/a', 'k', 'a', 5, 'ar') ->> 'already_quiet')::boolean, true,
  'already quiet: no watch is stored') from fx;
select is((select count(*)::int from public.quiet_watches), 0, 'nothing stored when already quiet');
select is((public.c_quiet_watch(pg_temp.pid(br), 'https://push.example/a', 'k', 'a', 2, 'ar') ->> 'already_quiet')::boolean, false,
  'busy: the watch is stored') from fx;
select is(public.c_quiet_watch(pg_temp.pid(br), 'https://push.example/b', 'k', 'a', 11, 'ar') ->> 'error', 'invalid_input', 'threshold is 0..10') from fx;

-- one served: 3 waiting, still above 2
select is((select count(*)::int from jsonb_array_elements(public.s_done(dev, (public.ticket_by_token((select tok from tk where g = 1))).id) -> 'notify') e where e ->> 'kind' = 'quiet'), 0,
  'not yet quiet: no push') from fx;
-- second served: 2 waiting → due
create temp table r as select public.s_done(dev, (public.ticket_by_token((select tok from tk where g = 2))).id) res from fx;
select is((select count(*)::int from jsonb_array_elements(res -> 'notify') e where e ->> 'kind' = 'quiet'), 1, 'quiet push handed to the edge function') from r;
select is((select (e ->> 'count')::int from r, jsonb_array_elements(res -> 'notify') e where e ->> 'kind' = 'quiet'), 2, 'carries the waiting count');
select is((select count(*)::int from public.quiet_watches), 0, 'a watch fires only once');

select is(public.c_quiet_watch('nope', 'https://push.example/c', 'k', 'a', 2, 'ar') ->> 'error', 'branch_not_found', 'unknown shop');

select * from finish();
rollback;
