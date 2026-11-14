begin;
\ir 00_fixtures.inc
select plan(5);

create temp table fx as select pg_temp.mk_branch('full') br;
alter table fx add column svc uuid, add column item uuid;
update fx set svc = pg_temp.mk_service(br, 'remote', 10);
insert into public.menu_items(branch_id, name, price_sar, duration_min, service_id) select br, 'خدمة', 25, 10, svc from fx;
update fx set item = (select id from public.menu_items where service_id = fx.svc);

update public.menu_items set name = 'حلاقة دقن', duration_min = 15 where id = (select item from fx);
select is((select name from public.services where id = (select svc from fx)), 'حلاقة دقن', 'renaming the menu item renames the queue service');
select is((select avg_minutes from public.services where id = (select svc from fx)), 15, 'and carries the duration');
update public.services set name = 'حلاقة لحية' where id = (select svc from fx);
select is((select name from public.menu_items where id = (select item from fx)), 'حلاقة لحية', 'renaming the service renames the menu item');
update public.menu_items set price_sar = 30 where id = (select item from fx);
select is((select name from public.services where id = (select svc from fx)), 'حلاقة لحية', 'a price change leaves the service alone');
insert into public.menu_items(branch_id, name) select br, 'صنف بلا خدمة' from fx;
select is((select count(*)::int from public.services where branch_id = (select br from fx)), 1, 'unlinked items create nothing');

select * from finish();
rollback;
