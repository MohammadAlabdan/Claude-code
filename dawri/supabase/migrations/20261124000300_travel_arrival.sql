-- «كم تبعد عن المحل؟»: the customer picks how far away they are, and "return now" fires when the expected wait
-- comes down to their travel time plus a 5-minute margin, instead of always at two turns.
-- «وصلت»: the customer taps it at the shop; the staff screen shows who is here and who is on the way.
-- Also: return-now reaches customers who only linked WhatsApp (it used to require web push).

alter table public.tickets
  add column travel_min int check (travel_min between 0 and 90),
  add column arrived_at timestamptz;

/** Is it time to tell this customer to head back? */
create or replace function public.return_now_due(p_ticket uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select t.status = 'waiting' and t.mode = 'remote' and t.arrived_at is null and (
    case when t.travel_min is null
      then public.ticket_position(t.id) <= public.setting_int(t.branch_id, 'return_now_threshold')
      else public.ticket_position(t.id) = 0 or public.ticket_estimate(t.id) <= t.travel_min + 5 end)
  from public.tickets t where t.id = p_ticket
$$;

create or replace function public.collect_return_now(p_branch uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  out jsonb := '[]'::jsonb;
  r record;
begin
  if not public.has_feature(p_branch, 'return_now') then return out; end if;
  for r in
    select t.id from public.tickets t
    where t.branch_id = p_branch and t.status = 'waiting' and t.mode = 'remote' and not t.return_now_sent
      and t.arrived_at is null
      and (t.push_enabled or exists (select 1 from public.whatsapp_links l where l.ticket_id = t.id))
      and public.return_now_due(t.id)
    for update
  loop
    update public.tickets set return_now_sent = true where id = r.id;
    out := out || jsonb_build_object('ticket_id', r.id, 'kind', 'return_now');
  end loop;
  return out;
end $$;

-- ticket page: travel choice, arrival, and "return now" by time when a travel time is set
alter function public.ticket_view(uuid) rename to ticket_view_q;
create or replace function public.ticket_view(p_ticket uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.ticket_view_q(t.id) || jsonb_build_object(
    'travel_min', t.travel_min,
    'arrived', t.arrived_at is not null,
    'return_now', coalesce(public.return_now_due(t.id), false),
    'category', (select bz.category from public.branches b join public.businesses bz on bz.id = b.business_id where b.id = t.branch_id),
    'whatsapp_linked', exists (select 1 from public.whatsapp_links l where l.ticket_id = t.id))
  from public.tickets t where t.id = p_ticket
$$;

-- staff screen: who is here, who is on the way, who can be reached
alter function public.s_state(uuid) rename to s_state_q;
create or replace function public.s_state(p_device uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with base as (select public.s_state_q(p_device) j)
  select jsonb_set(base.j, '{tickets}', coalesce((
    select jsonb_agg(x || (select jsonb_build_object(
             'arrived', t.arrived_at is not null,
             'on_way', t.arrived_at is null and t.return_now_sent and t.status = 'waiting',
             'travel_min', t.travel_min,
             'whatsapp', exists (select 1 from public.whatsapp_links l where l.ticket_id = t.id))
           from public.tickets t where t.id = (x ->> 'id')::uuid)
           order by ord)
    from jsonb_array_elements(base.j -> 'tickets') with ordinality as e(x, ord)), '[]'::jsonb))
  from base
$$;

/** «كم تبعد؟» 0 = already here or next door. Changing it to a longer trip re-arms the alert if it is not due yet. */
create or replace function public.c_set_travel(p_token text, p_minutes int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.ticket_by_token(p_token);
begin
  if t.id is null then return public.err('ticket_not_found'); end if;
  if t.status <> 'waiting' or t.mode <> 'remote' then return public.err('not_waiting'); end if;
  if p_minutes is null or p_minutes not in (0, 5, 10, 15, 20, 30, 45, 60) then return public.err('invalid_input'); end if;
  update public.tickets set travel_min = p_minutes, updated_at = now() where id = t.id;
  if not public.return_now_due(t.id) then update public.tickets set return_now_sent = false where id = t.id; end if;
  return public.with_effects(jsonb_build_object('ticket', public.ticket_view(t.id)), t.branch_id, public.collect_return_now(t.branch_id));
end $$;

/** «وصلت»: the customer is at the shop. */
create or replace function public.c_arrived(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.ticket_by_token(p_token);
begin
  if t.id is null then return public.err('ticket_not_found'); end if;
  if t.status not in ('waiting','called') or t.mode <> 'remote' then return public.err('not_waiting'); end if;
  update public.tickets set arrived_at = coalesce(arrived_at, now()), updated_at = now() where id = t.id;
  return public.with_effects(jsonb_build_object('ticket', public.ticket_view(t.id)), t.branch_id, '[]'::jsonb);
end $$;

-- WhatsApp texts can say "leave now, about N minutes" when a travel time is set
create or replace function public.wa_ticket_facts(p_ticket uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ticket_id', t.id, 'number', t.number, 'lang', t.lang, 'status', t.status,
    'shop', coalesce(nullif(bz.name, ''), br.name), 'public_id', br.public_id, 'branch_id', br.id,
    'travel_min', t.travel_min,
    'position', case when t.status = 'waiting' and t.mode = 'remote' then public.ticket_position(t.id) end,
    'estimate_min', case when t.status = 'waiting' and t.mode = 'remote' then public.ticket_estimate(t.id) end)
  from public.tickets t join public.branches br on br.id = t.branch_id join public.businesses bz on bz.id = br.business_id
  where t.id = p_ticket
$$;

revoke execute on function public.return_now_due(uuid), public.ticket_view_q(uuid), public.s_state_q(uuid),
  public.c_set_travel(text, int), public.c_arrived(text) from public, anon, authenticated;
grant execute on function public.return_now_due(uuid), public.ticket_view_q(uuid), public.s_state_q(uuid),
  public.c_set_travel(text, int), public.c_arrived(text) to service_role;
