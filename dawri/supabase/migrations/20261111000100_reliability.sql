-- Reliability pass after the field review:
-- 1. ticket_events: every change to a ticket is logged (who, what, when) so disputes and abuse can be checked.
-- 2. Wait estimates count the people actually working now, not every provider on file.
-- 3. Capacity: a remote turn that cannot be served before closing is refused with «full_today».

-- ---------- 1. audit log ----------
create table public.ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  event text not null,
  actor text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index ticket_events_branch on public.ticket_events(branch_id, created_at desc);
create index ticket_events_ticket on public.ticket_events(ticket_id);
alter table public.ticket_events enable row level security;

create or replace function public.log_ticket_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor text := nullif(current_setting('dawri.actor', true), '');
  ev text;
  det jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events(ticket_id, branch_id, event, actor, detail)
    values (new.id, new.branch_id, 'created', coalesce(actor, case when new.source = 'remote' then 'customer' else 'staff' end),
            jsonb_build_object('number', new.number, 'source', new.source, 'party', new.party_size));
    return new;
  end if;
  if new.status is distinct from old.status then
    ev := new.status;
    if new.status = 'called' and new.called_by_device is not null then actor := 'device:' || new.called_by_device; end if;
  elsif new.stage is distinct from old.stage then ev := 'stage:' || new.stage;
  elsif new.priority and not old.priority then ev := 'priority'; det := jsonb_build_object('reason', new.priority_reason);
    actor := coalesce(actor, 'device:' || new.priority_by_device);
  elsif new.sort_key > old.sort_key then ev := 'moved_back';
    det := jsonb_build_object('snooze', new.snooze_count, 'push_back', new.push_back_count);
  elsif new.provider_id is distinct from old.provider_id then ev := 'provider';
  else return new;
  end if;
  insert into public.ticket_events(ticket_id, branch_id, event, actor, detail)
  values (new.id, new.branch_id, ev, coalesce(actor, 'system'), det);
  return new;
end $$;

create trigger tickets_audit after insert or update on public.tickets
  for each row execute function public.log_ticket_event();

-- who is acting: staff actions go through staff_ticket(), customer actions through ticket_for_action()
create or replace function public.staff_ticket(p_device uuid, p_ticket uuid) returns public.tickets
language plpgsql volatile security definer set search_path = public as $$
declare t public.tickets;
begin
  perform set_config('dawri.actor', 'device:' || p_device, true);
  select t2.* into t from public.tickets t2 join public.staff_devices d on d.branch_id = t2.branch_id
  where d.id = p_device and t2.id = p_ticket;
  return t;
end $$;

create or replace function public.ticket_for_action(p_token text) returns public.tickets
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.ticket_by_token(p_token);
begin
  if t.id is null then return null; end if;
  perform set_config('dawri.actor', 'customer', true);
  if not public.hit_rate_limit('tact:' || t.id, 30) then
    t.id := null; t.status := 'rate_limited';
  end if;
  return t;
end $$;

/** Owner view of the log: newest first, with ticket numbers and device labels. */
create or replace function public.o_ticket_events(p_user uuid, p_branch uuid, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_branch(p_user, p_branch) then return public.err('forbidden'); end if;
  return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select e.created_at, e.event, e.detail, t.number, t.day,
           case when e.actor like 'device:%' then coalesce((select d.label from public.staff_devices d where d.id::text = substr(e.actor, 8)), 'staff')
                else e.actor end as actor
    from public.ticket_events e join public.tickets t on t.id = e.ticket_id
    where e.branch_id = p_branch order by e.created_at desc limit least(greatest(p_limit, 1), 500)) x);
end $$;

-- ---------- 2. people actually working ----------
-- Providers count when a staff device tied to them was seen in the last 20 minutes or they are serving now;
-- with no such signal (no devices per provider), every active provider counts, as before.
create or replace function public.service_provider_count(p_service uuid) returns int
language sql stable security definer set search_path = public as $$
  with eligible as (
    select p.id from public.providers p
    join public.services s on s.branch_id = p.branch_id
    where s.id = p_service and p.is_active and (p.service_ids is null or s.id = any(p.service_ids))),
  on_shift as (
    select e.id from eligible e
    where exists (select 1 from public.staff_devices d where d.provider_id = e.id and d.revoked_at is null
                    and d.last_seen_at > now() - interval '20 minutes')
       or exists (select 1 from public.tickets t where t.provider_id = e.id and t.day = public.riyadh_today()
                    and t.status in ('called','serving')))
  select greatest(1, case when (select count(*) from on_shift) > 0 then (select count(*) from on_shift)
                          else (select count(*) from eligible) end)::int
$$;

-- ticket estimate without the per-row set-function join (load test: ~70 ms → ~1 ms per ticket view)
create or replace function public.ticket_estimate(p_ticket uuid) returns int
language sql stable security definer set search_path = public as $$
  select public.round_estimate(
    coalesce((select sum(o.party_size) from public.tickets o where o.id = any(array(select public.ticket_ahead_ids(t.id)))), 0)
    * public.service_minutes(t.service_id, t.provider_id)
    / (case when t.provider_id is null then public.service_provider_count(t.service_id) else 1 end))
  from public.tickets t where t.id = p_ticket
$$;

-- ---------- 3. capacity before closing ----------
create or replace function public.c_join(p_public_id text, p_service uuid, p_provider uuid, p_party int,
                                         p_lang text, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.branches := public.branch_by_public_id(p_public_id);
  s public.services;
  st record;
  tok text := public.new_token();
  tid uuid;
  remote_waiting int;
begin
  if b.id is null then return public.err('branch_not_found'); end if;
  if not public.has_feature(b.id, 'queue') then return public.feature_locked('queue'); end if;
  select * into s from public.services where id = p_service and branch_id = b.id and is_active;
  if s.id is null or s.mode <> 'remote' then return public.err('invalid_service'); end if;
  if p_party is null or p_party < 1 or p_party > 6 then return public.err('invalid_party_size'); end if;
  if p_party > 1 and not public.has_feature(b.id, 'family_ticket') then return public.feature_locked('family_ticket'); end if;
  if p_provider is not null then
    if not public.has_feature(b.id, 'preferred_provider') then return public.feature_locked('preferred_provider'); end if;
    if not exists (select 1 from public.providers where id = p_provider and branch_id = b.id and is_active
                   and (service_ids is null or s.id = any(service_ids))) then
      return public.err('invalid_provider');
    end if;
  end if;

  select * into st from public.branch_open_state(b.id);
  if not st.is_open then
    return public.err('closed', jsonb_build_object('next_open_at', st.next_open_at,
                                                    'busy_level', public.branch_busy_level(b.id)));
  end if;
  if st.closes_at - now() < make_interval(mins => public.setting_int(b.id, 'remote_close_minutes_before_closing')) then
    return public.err('closing_soon', jsonb_build_object('next_open_at', st.next_open_at,
                                                          'busy_level', public.branch_busy_level(b.id)));
  end if;

  -- Capacity: refuse a remote turn that cannot be served before closing (real closing only, not 24h shops).
  if st.closes_at is not null and (st.next_open_at is null or st.next_open_at > st.closes_at + interval '1 minute')
     and now() + make_interval(mins => ((public.service_join_estimate(s.id) ->> 'estimate_min')::int
                                      + ceil(public.service_minutes(s.id))::int)) > st.closes_at then
    return public.err('full_today', jsonb_build_object('next_open_at', st.next_open_at,
                                                        'busy_level', public.branch_busy_level(b.id)));
  end if;

  perform 1 from public.branches where id = b.id for update;   -- serialize joins per branch
  select count(*) into remote_waiting from public.tickets
   where branch_id = b.id and status = 'waiting' and source = 'remote';
  if remote_waiting >= public.setting_int(b.id, 'remote_join_limit') then
    return public.err('remote_limit', jsonb_build_object('busy_level', public.branch_busy_level(b.id)));
  end if;
  if p_fingerprint is not null and not public.hit_rate_limit('join:' || b.id || ':' || p_fingerprint, 3) then
    return public.err('rate_limited');
  end if;

  insert into public.tickets(branch_id, service_id, provider_id, mode, day, number, party_size, source,
                             access_token_hash, lang, fingerprint)
  values (b.id, s.id, p_provider, 'remote', public.riyadh_today(),
          public.next_ticket_number(b.id, public.riyadh_today()), p_party, 'remote',
          public.sha256_hex(tok), case when p_lang = 'en' then 'en' else 'ar' end, p_fingerprint)
  returning id into tid;

  return public.with_effects(jsonb_build_object('ticket_token', tok, 'ticket', public.ticket_view(tid)),
                             b.id, public.collect_busy_alert(b.id));
end $$;

revoke all on public.ticket_events from anon, authenticated;
grant all on public.ticket_events to service_role;
grant select on public.ticket_events to authenticated;
create policy ticket_events_owner_read on public.ticket_events for select to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin());
revoke execute on function public.log_ticket_event(), public.staff_ticket(uuid, uuid), public.ticket_for_action(text),
  public.o_ticket_events(uuid, uuid, int), public.service_provider_count(uuid), public.ticket_estimate(uuid),
  public.c_join(text, uuid, uuid, int, text, text) from public, anon, authenticated;
grant execute on function public.staff_ticket(uuid, uuid), public.ticket_for_action(text),
  public.o_ticket_events(uuid, uuid, int), public.service_provider_count(uuid), public.ticket_estimate(uuid),
  public.c_join(text, uuid, uuid, int, text, text) to service_role;
