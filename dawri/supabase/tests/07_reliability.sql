begin;
\ir 00_fixtures.inc
select plan(8);

create temp table fx as select pg_temp.mk_branch('full') br;
alter table fx add column svc uuid, add column dev uuid;
update fx set svc = pg_temp.mk_service(br), dev = pg_temp.mk_device(br);
create temp table j as select public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-a') ->> 'ticket_token' t1,
                              public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-b') ->> 'ticket_token' t2 from fx;

-- audit log: who did what
select is((select actor from public.ticket_events e where e.ticket_id = (public.ticket_by_token(t1)).id and event = 'created'), 'customer',
  'joining is logged as the customer') from j;
select public.c_snooze(t1, 1) from j;
select is((select actor from public.ticket_events e where e.ticket_id = (public.ticket_by_token(t1)).id and event = 'moved_back'), 'customer',
  'the late button is logged as the customer') from j;
select public.s_call_next(dev, null, null) from fx;
select ok((select actor like 'device:%' from public.ticket_events e where e.ticket_id = (public.ticket_by_token(t2)).id and event = 'called'),
  'calling is logged with the staff device') from j;
select is(jsonb_array_length(public.o_ticket_events(pg_temp.owner_of(br), br)), 4, 'the owner sees the log') from fx;
select is(public.o_ticket_events(gen_random_uuid(), br) ->> 'error', 'forbidden', 'nobody else does') from fx;

-- people actually working: a provider with a fresh device counts, an idle one does not
insert into public.providers(branch_id, display_name) select br, n from fx, unnest(array['أ','ب']) n;
select is(public.service_provider_count(svc), 2, 'no device signal: every provider counts') from fx;
update public.staff_devices set provider_id = (select id from public.providers where display_name = 'أ'), last_seen_at = now() where id = (select dev from fx);
select is(public.service_provider_count(svc), 1, 'only the provider on shift counts') from fx;

-- capacity: closing in 50 minutes, 40 minutes of queue ahead + a 20-minute service → full today
create temp table fx2 as select pg_temp.mk_branch('full', (select jsonb_object_agg(d, jsonb_build_array(jsonb_build_array(
  to_char((now() at time zone 'Asia/Riyadh') - interval '1 hour', 'HH24:MI'),
  to_char((now() at time zone 'Asia/Riyadh') + interval '50 minutes', 'HH24:MI'))))
  from unnest(array['sun','mon','tue','wed','thu','fri','sat']) d)) br;
alter table fx2 add column svc uuid;
update fx2 set svc = pg_temp.mk_service(br, 'remote', 20);
select public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-' || g) from fx2, generate_series(1, 2) g;
select is(public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-late') ->> 'error', 'full_today', 'a turn that cannot be served before closing is refused') from fx2;

select * from finish();
rollback;
