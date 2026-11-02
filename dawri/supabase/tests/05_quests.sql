begin;
\ir 00_fixtures.inc
select plan(14);

create temp table fx as select pg_temp.mk_branch('full') br, pg_temp.mk_branch('growth') gr, pg_temp.mk_branch('basic') bs;
alter table fx add column svc uuid, add column dev uuid, add column q uuid, add column quiet uuid, add column rare uuid, add column item uuid;
update fx set svc = pg_temp.mk_service(br), dev = pg_temp.mk_device(br);
insert into public.quests(branch_id, kind, title, required_visits, reward_text) select br, 'visits', 'زيارتين', 2, 'خصم ١٥٪' from fx;
update fx set q = (select id from public.quests where title = 'زيارتين');
insert into public.quests(branch_id, kind, title, required_visits, reward_text, time_start, time_end)
  select br, 'quiet', 'وقت مستحيل', 1, 'هدية', '03:00', '03:01' from fx;
insert into public.quests(branch_id, kind, title, required_visits, reward_text, rarity, max_participants)
  select br, 'visits', 'نادر', 1, 'هدية', 'rare', 1 from fx;
insert into public.menu_items(branch_id, name, price_sar) select br, 'تنظيف بشرة', 50 from fx;

-- a visit = join, add phone, start, staff finishes
create or replace function pg_temp.visit(p_phone text, p_start boolean default false) returns text language plpgsql as $$
declare tok text; f record;
begin
  select * into f from fx;
  tok := public.c_join(pg_temp.pid(f.br), f.svc, null, 1, 'ar', null) ->> 'ticket_token';
  perform public.c_set_phone(tok, p_phone, true);
  if p_start then perform public.c_quest_start(tok, f.q); end if;
  perform public.s_done(f.dev, (public.ticket_by_token(tok)).id);
  return tok;
end $$;

create temp table v as select pg_temp.visit('0550000001', true) t1;
select is((select visits from public.quest_progress where phone = '0550000001' and quest_id = (select q from fx)), 1, 'a finished visit counts');
select is((select count(*)::int from public.quest_progress where phone = '0550000001'), 1, 'only the started challenge has progress');
select is((select (e -> 'mine' ->> 'visits')::int from jsonb_array_elements(public.public_ticket(t1) -> 'quests') e
           where e ->> 'title' = 'زيارتين'), 1, 'ticket view shows my progress') from v;
alter table v add column t2 text;
update v set t2 = pg_temp.visit('0550000001');
select ok((select completed_at is not null from public.quest_progress where phone = '0550000001' and quest_id = (select q from fx)), 'second visit completes it');
select is(public.c_redeem_quest(t2, (select q from fx), '0000') ->> 'error', 'invalid_code', 'redeeming needs the staff code') from v;
select is(public.c_redeem_quest(t2, (select q from fx), public.s_rotating_code((select dev from fx)) ->> 'code') ->> 'redeemed', 'quest', 'reward redeemed with the code') from v;
select is(public.c_redeem_quest(t2, (select q from fx), public.s_rotating_code((select dev from fx)) ->> 'code') ->> 'error', 'already_redeemed', 'only once') from v;

-- time window: a visit outside the quiet hours does not count
create temp table w as select public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', null) ->> 'ticket_token' tok from fx;
select public.c_set_phone(tok, '0550000002', true) from w;
select is(public.c_quest_start(tok, (select id from public.quests where title = 'وقت مستحيل')) ->> 'ok', 'true', 'quiet challenge started') from w;
select public.s_done((select dev from fx), (public.ticket_by_token(tok)).id) from w;
select is((select visits from public.quest_progress where phone = '0550000002'), 0, 'visit outside the window is not counted');

-- rare: limited spots
select is(public.c_quest_start(tok, (select id from public.quests where title = 'نادر')) ->> 'ok', 'true', 'first person takes the rare spot') from w;
select is(public.c_quest_start(t1, (select id from public.quests where title = 'نادر')) ->> 'error', 'quest_full', 'rare challenge is full') from v;

-- phone needed, plan gating
create temp table nophone as select public.c_join(pg_temp.pid(br), svc, null, 1, 'ar', null) ->> 'ticket_token' tok from fx;
select is(public.c_quest_start(tok, (select q from fx)) ->> 'error', 'phone_required', 'starting needs a phone with consent') from nophone;
insert into public.quests(branch_id, kind, title, reward_text) select gr, 'visits', 'عادي', 'هدية' from fx;
select is(jsonb_array_length(public.quests_view((select gr from fx))), 1, 'growth sees simple challenges');

-- «أبيها»: staff see what the waiting customer wants
select public.c_interest(tok, (select id from public.menu_items where name = 'تنظيف بشرة' and branch_id = (select br from fx)), true) from nophone;
select ok((select public.s_state(dev) -> 'tickets') @> '[{"interests": ["تنظيف بشرة"]}]', 'staff see the requested extra') from fx;

select * from finish();
rollback;
