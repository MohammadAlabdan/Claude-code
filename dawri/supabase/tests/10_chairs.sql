begin;
\ir 00_fixtures.inc
select plan(7);

create temp table fx as select pg_temp.mk_branch('basic') br;
alter table fx add column svc uuid, add column dev uuid, add column p1 uuid, add column p2 uuid;
update fx set svc = pg_temp.mk_service(br, 'remote', 20), dev = pg_temp.mk_device(br);
insert into public.providers(branch_id, display_name) select br, n from fx, unnest(array['كرسي ١','كرسي ٢']) n;
update fx set p1 = (select id from public.providers where display_name = 'كرسي ١' and branch_id = fx.br),
              p2 = (select id from public.providers where display_name = 'كرسي ٢' and branch_id = fx.br);

select is(public.feature_min_plan('preferred_provider'), 'basic', 'choosing a chair is in every plan');
-- two people want chair 1, one takes any chair
select public.c_join(pg_temp.pid(br), svc, p1, 1, 'ar', 'fp-a'), public.c_join(pg_temp.pid(br), svc, p1, 1, 'ar', 'fp-b'),
       public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', 'fp-c') from fx;
create temp table ch as select e from fx, jsonb_array_elements(public.public_branch(pg_temp.pid(br)) -> 'chairs') e;
select is((select count(*)::int from ch), 2, 'both chairs are listed');
select is((select (e ->> 'waiting')::int from ch where e ->> 'name' = 'كرسي ١'), 2, 'chair 1 has its own two');
select is((select (e ->> 'ahead')::int from ch where e ->> 'name' = 'كرسي ١'), 3, 'joining chair 1: its two + a share of «any»');
select is((select (e ->> 'ahead')::int from ch where e ->> 'name' = 'كرسي ٢'), 1, 'joining chair 2: only the share of «any»');

-- chair 1's device calls: it becomes busy with that number
update public.staff_devices set provider_id = (select p1 from fx), last_seen_at = now() where id = (select dev from fx);
select public.s_call_next(dev, null, null) from fx;
select is((select e ->> 'status' from fx, jsonb_array_elements(public.public_branch(pg_temp.pid(br)) -> 'chairs') e where e ->> 'name' = 'كرسي ١'), 'busy', 'chair 1 shows busy');
select is((select e ->> 'status' from fx, jsonb_array_elements(public.public_branch(pg_temp.pid(br)) -> 'chairs') e where e ->> 'name' = 'كرسي ٢'), 'free', 'chair 2 shows free');

select * from finish();
rollback;
