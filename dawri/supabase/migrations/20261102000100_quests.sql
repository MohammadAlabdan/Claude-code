-- «تحدّياتي»: owner-designed challenges (quests) counted automatically from finished tickets,
-- and «أبيها»: a waiting customer can ask for an extra service, shown to staff on the ticket.

-- ---------- plans: quests + upsell in growth, smart quest kinds in full ----------
create or replace function public.plan_features(p_plan text) returns text[]
language plpgsql immutable as $$
declare
  basic text[] := array['queue','fadeet','return_now','card','evening_summary','late_button',
                        'family_ticket','priority','lost_customers','staff_language'];
  growth text[] := array['menu','menu_photo_ai','timed_offers','loyalty','feedback',
                         'preferred_provider','best_time','busy_alert','quests','upsell'];
  full_ text[] := array['full_page','news','qa_assistant','quiet_coupon','peak_report','absent_customers',
                        'smart_quests'];
begin
  return case p_plan
    when 'basic' then basic
    when 'seasonal' then basic
    when 'growth' then basic || growth
    when 'full' then basic || growth || full_
    else array[]::text[]
  end;
end $$;

-- ---------- tables ----------
create table public.quests (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  -- visits: N visits · quiet: N visits inside a time window · comeback: for customers away 21+ days
  -- provider: N visits with one provider · friend: N visits with 2+ people on the ticket
  kind text not null default 'visits' check (kind in ('visits','quiet','comeback','provider','friend')),
  title text not null check (char_length(title) between 2 and 80),
  description text check (char_length(description) <= 200),
  service_id uuid references public.services(id) on delete set null,
  provider_id uuid references public.providers(id) on delete set null,
  required_visits int not null default 3 check (required_visits between 1 and 20),
  reward_text text not null check (char_length(reward_text) between 1 and 40),
  rarity text not null default 'common' check (rarity in ('common','rare')),
  max_participants int check (max_participants between 1 and 10000),
  weekdays int[] not null default '{0,1,2,3,4,5,6}',
  time_start time,
  time_end time,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null default now() + interval '7 days',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index quests_branch_idx on public.quests(branch_id, is_active, ends_at);
create trigger quests_touch before update on public.quests for each row execute function public.touch_updated_at();

create table public.quest_progress (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references public.quests(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  phone text not null check (phone ~ '^05[0-9]{8}$'),
  visits int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  redeemed_at timestamptz,
  unique (quest_id, phone)
);
create index quest_progress_phone_idx on public.quest_progress(branch_id, phone);

alter table public.redemptions add column quest_id uuid references public.quests(id) on delete set null;
alter table public.tickets add column interests uuid[] not null default '{}';
alter table public.tickets add column quest_counted uuid[] not null default '{}';

-- ---------- quest logic ----------
create or replace function public.quest_feature(p_kind text) returns text
language sql immutable as $$ select case when p_kind = 'visits' then 'quests' else 'smart_quests' end $$;

create or replace function public.quest_open(q public.quests, p_at timestamptz default now()) returns boolean
language sql stable as $$
  select q.is_active and p_at >= q.starts_at and p_at < q.ends_at
         and public.has_feature(q.branch_id, public.quest_feature(q.kind))
$$;

-- Does this finished ticket count as a visit for the quest?
create or replace function public.quest_matches(q public.quests, t public.tickets) returns boolean
language sql stable as $$
  select (q.service_id is null or q.service_id = t.service_id)
     and (q.provider_id is null or q.provider_id = t.provider_id)
     and (q.kind <> 'friend' or t.party_size >= 2)
     and (q.kind <> 'quiet' or (
           extract(dow from public.riyadh_local(t.joined_at))::int = any(q.weekdays)
           and (q.time_start is null or public.riyadh_local(t.joined_at)::time >= q.time_start)
           and (q.time_end is null or public.riyadh_local(t.joined_at)::time < q.time_end)))
     and t.joined_at >= q.starts_at and t.joined_at < q.ends_at
$$;

-- Called when a ticket is finished: one visit per matching quest the customer has started.
create or replace function public.apply_quests(p_ticket uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tickets;
  q public.quests;
begin
  select * into t from public.tickets where id = p_ticket for update;
  if t.status <> 'done' or not t.phone_consent or t.customer_phone is null then return; end if;
  for q in
    select qq.* from public.quests qq
    join public.quest_progress p on p.quest_id = qq.id and p.phone = t.customer_phone and p.completed_at is null
    where qq.branch_id = t.branch_id and not (qq.id = any(t.quest_counted))
  loop
    if public.has_feature(q.branch_id, public.quest_feature(q.kind)) and public.quest_matches(q, t) then
      update public.quest_progress
         set visits = visits + 1,
             completed_at = case when visits + 1 >= q.required_visits then now() end
       where quest_id = q.id and phone = t.customer_phone;
      update public.tickets set quest_counted = quest_counted || q.id where id = t.id;
    end if;
  end loop;
end $$;

create or replace function public.finish_ticket(p_ticket uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.tickets
     set status = 'done', done_at = now(),
         served_at = coalesce(served_at, called_at, now()),
         called_at = coalesce(called_at, now()),
         stage = case when mode = 'dropoff' then 'picked_up' else stage end
   where id = p_ticket and status not in ('done','cancelled','left','no_show');
  perform public.apply_loyalty(p_ticket);
  perform public.apply_quests(p_ticket);
end $$;

-- Quests a customer can see, with their own progress when they have a phone on the ticket.
create or replace function public.quests_view(p_branch uuid, p_phone text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id, 'kind', q.kind, 'title', q.title, 'description', q.description,
      'required_visits', q.required_visits, 'reward_text', q.reward_text, 'rarity', q.rarity,
      'ends_at', q.ends_at, 'weekdays', to_jsonb(q.weekdays), 'time_start', q.time_start, 'time_end', q.time_end,
      'service', (select name from public.services s where s.id = q.service_id),
      'provider', (select display_name from public.providers p where p.id = q.provider_id),
      'participants', (select count(*) from public.quest_progress p where p.quest_id = q.id),
      'spots_left', case when q.max_participants is null then null
                         else greatest(0, q.max_participants - (select count(*) from public.quest_progress p where p.quest_id = q.id)) end,
      'mine', (select jsonb_build_object('visits', p.visits, 'completed', p.completed_at is not null,
                                         'redeemed', p.redeemed_at is not null)
               from public.quest_progress p where p.quest_id = q.id and p.phone = p_phone))
    order by (q.rarity = 'rare') desc, q.ends_at), '[]'::jsonb)
  from public.quests q
  where q.branch_id = p_branch and public.quest_open(q)
$$;

-- Extras to showcase while waiting (up to 6): never the service already booked, add-ons first.
create or replace function public.showcase_items(p_branch uuid, p_service uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'category', m.category,
           'description', m.description, 'price_sar', m.price_sar, 'duration_min', m.duration_min)), '[]'::jsonb)
  from (select * from public.menu_items where branch_id = p_branch and is_available
          and (p_service is null or service_id is distinct from p_service)
        order by (service_id is null) desc, sort, name limit 6) m
  where public.has_feature(p_branch, 'menu')
$$;

-- ---------- extend the existing views without rewriting them ----------
alter function public.ticket_view(uuid) rename to ticket_view_base;
create or replace function public.ticket_view(p_ticket uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.ticket_view_base(t.id) || jsonb_build_object(
    'quests', case when public.has_feature(t.branch_id, 'quests') then public.quests_view(t.branch_id, t.customer_phone) else '[]'::jsonb end,
    'showcase', case when t.status in ('waiting','called','serving') or t.mode = 'dropoff' then public.showcase_items(t.branch_id, t.service_id) else '[]'::jsonb end,
    'interests', to_jsonb(t.interests))
  from public.tickets t where t.id = p_ticket
$$;

alter function public.public_branch(text) rename to public_branch_base;
create or replace function public.public_branch(p_public_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  base jsonb := public.public_branch_base(p_public_id);
  b public.branches := public.branch_by_public_id(p_public_id);
begin
  if base ? 'error' then return base; end if;
  return base || jsonb_build_object('quests',
    case when public.has_feature(b.id, 'quests') then public.quests_view(b.id) else '[]'::jsonb end);
end $$;

alter function public.s_state(uuid) rename to s_state_base;
create or replace function public.s_state(p_device uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with base as (select public.s_state_base(p_device) j)
  select jsonb_set(base.j, '{tickets}', coalesce((
    select jsonb_agg(x || jsonb_build_object('interests', coalesce((
             select jsonb_agg(m.name) from public.tickets t join public.menu_items m on m.id = any(t.interests)
             where t.id = (x ->> 'id')::uuid), '[]'::jsonb))
           order by ord)
    from jsonb_array_elements(base.j -> 'tickets') with ordinality as e(x, ord)), '[]'::jsonb))
  from base
$$;

-- ---------- customer actions ----------
create or replace function public.c_quest_start(p_token text, p_quest uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tickets := public.ticket_for_action(p_token);
  q public.quests;
  n int;
begin
  if t.id is null then return public.ticket_guard_error(t); end if;
  select * into q from public.quests where id = p_quest and branch_id = t.branch_id for update;
  if q.id is null then return public.err('quest_not_found'); end if;
  if not public.has_feature(q.branch_id, public.quest_feature(q.kind)) then return public.feature_locked(public.quest_feature(q.kind)); end if;
  if not public.quest_open(q) then return public.err('quest_ended'); end if;
  if t.customer_phone is null or not t.phone_consent then return public.err('phone_required'); end if;
  if exists (select 1 from public.quest_progress where quest_id = q.id and phone = t.customer_phone) then
    return jsonb_build_object('ok', true, 'already', true, 'quests', public.quests_view(t.branch_id, t.customer_phone));
  end if;
  select count(*) into n from public.quest_progress where quest_id = q.id;
  if q.max_participants is not null and n >= q.max_participants then return public.err('quest_full'); end if;
  -- comeback quests are for customers with no visit in the 21 days before today
  if q.kind = 'comeback' and exists (select 1 from public.tickets x where x.branch_id = q.branch_id
       and x.customer_phone = t.customer_phone and x.status = 'done'
       and x.day between public.riyadh_today() - 21 and public.riyadh_today() - 1) then
    return public.err('quest_not_eligible');
  end if;
  insert into public.quest_progress(quest_id, branch_id, phone) values (q.id, q.branch_id, t.customer_phone);
  -- a ticket already finished today counts at once
  if t.status = 'done' then perform public.apply_quests(t.id); end if;
  return public.with_effects(jsonb_build_object('ok', true, 'quests', public.quests_view(t.branch_id, t.customer_phone)), t.branch_id);
end $$;

create or replace function public.c_redeem_quest(p_token text, p_quest uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tickets := public.ticket_for_action(p_token);
  p public.quest_progress;
  q public.quests;
begin
  if t.id is null then return public.ticket_guard_error(t); end if;
  if p_code is null or p_code !~ '^[0-9]{4}$' or not public.rotating_code_valid(t.branch_id, p_code) then
    return public.err('invalid_code');
  end if;
  select * into p from public.quest_progress where quest_id = p_quest and phone = t.customer_phone for update;
  if p.id is null or p.completed_at is null then return public.err('no_reward'); end if;
  if p.redeemed_at is not null then return public.err('already_redeemed'); end if;
  select * into q from public.quests where id = p_quest;
  update public.quest_progress set redeemed_at = now() where id = p.id;
  insert into public.redemptions(branch_id, quest_id, ticket_id) values (t.branch_id, q.id, t.id);
  return public.with_effects(jsonb_build_object('ok', true, 'redeemed', 'quest', 'title', q.reward_text,
    'quests', public.quests_view(t.branch_id, t.customer_phone)), t.branch_id);
end $$;

-- «أبيها»: add / remove an extra item the customer wants; staff see it on the ticket.
create or replace function public.c_interest(p_token text, p_item uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.ticket_for_action(p_token);
begin
  if t.id is null then return public.ticket_guard_error(t); end if;
  if not public.has_feature(t.branch_id, 'upsell') then return public.feature_locked('upsell'); end if;
  if t.status not in ('waiting','called','serving') and t.mode <> 'dropoff' then return public.err('not_waiting'); end if;
  if not exists (select 1 from public.menu_items where id = p_item and branch_id = t.branch_id and is_available) then
    return public.err('invalid_input', '{"field":"item_id"}');
  end if;
  if coalesce(p_on, true) then
    if cardinality(t.interests) >= 5 and not (p_item = any(t.interests)) then return public.err('invalid_input', '{"field":"item_id"}'); end if;
    update public.tickets set interests = array(select distinct unnest(interests || p_item)) where id = t.id;
  else
    update public.tickets set interests = array_remove(interests, p_item) where id = t.id;
  end if;
  return public.with_effects(jsonb_build_object('ok', true,
    'interests', (select to_jsonb(interests) from public.tickets where id = t.id)), t.branch_id);
end $$;

-- ---------- owner ----------
create or replace function public.o_quests(p_user uuid, p_branch uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_branch(p_user, p_branch) then return public.err('forbidden'); end if;
  return jsonb_build_object('quests', (select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object(
      'open', public.quest_open(q),
      'participants', (select count(*) from public.quest_progress p where p.quest_id = q.id),
      'completed', (select count(*) from public.quest_progress p where p.quest_id = q.id and p.completed_at is not null),
      'redeemed', (select count(*) from public.quest_progress p where p.quest_id = q.id and p.redeemed_at is not null),
      'visits', (select coalesce(sum(p.visits), 0) from public.quest_progress p where p.quest_id = q.id))
    order by q.created_at desc), '[]'::jsonb) from public.quests q where q.branch_id = p_branch),
    'interests_7d', (select count(*) from public.tickets t where t.branch_id = p_branch
                     and cardinality(t.interests) > 0 and t.joined_at > now() - interval '7 days'));
end $$;

-- ---------- security for the new objects ----------
alter table public.quests enable row level security;
alter table public.quest_progress enable row level security;
revoke all on public.quests, public.quest_progress from anon, authenticated;
grant all on public.quests, public.quest_progress to service_role;
grant select, insert, update, delete on public.quests to authenticated;
grant select on public.quest_progress to authenticated;
create policy quests_owner_read on public.quests for select to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin());
create policy quests_owner_delete on public.quests for delete to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin());
create policy quests_owner_write on public.quests for insert to authenticated
  with check ((branch_id in (select public.owned_branch_ids()) or public.is_admin())
              and public.has_feature(branch_id, public.quest_feature(kind)));
create policy quests_owner_update on public.quests for update to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin())
  with check (public.has_feature(branch_id, public.quest_feature(kind)));
create policy quest_progress_owner_read on public.quest_progress for select to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin());

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
grant execute on function public.public_branch(text) to anon, authenticated;
grant execute on function public.public_ticket(text) to anon, authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.owned_branch_ids(uuid) to authenticated;
grant execute on function public.has_feature(uuid, text) to authenticated;
grant execute on function public.branch_features(uuid) to authenticated;
grant execute on function public.plan_features(text) to authenticated;
grant execute on function public.business_effective_plan(uuid) to authenticated;
grant execute on function public.feature_min_plan(text) to authenticated;
grant execute on function public.quest_feature(text) to authenticated;
