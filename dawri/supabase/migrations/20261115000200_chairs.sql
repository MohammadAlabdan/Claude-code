-- «الكراسي الحين»: the shop page shows every chair / stylist live (free, busy with which number, away),
-- how many are waiting for each, and the wait for joining that one. Picking a chair is now in every plan
-- (it was in growth): in barbershops and salons choosing who serves you is basic, not an extra.

create or replace function public.plan_features(p_plan text) returns text[]
language plpgsql immutable as $$
declare
  basic text[] := array['queue','fadeet','return_now','card','evening_summary','late_button',
                        'family_ticket','priority','lost_customers','staff_language','preferred_provider'];
  growth text[] := array['menu','menu_photo_ai','timed_offers','loyalty','feedback',
                         'best_time','busy_alert','quests','upsell'];
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

/**
 * One entry per active provider (chair or stylist):
 * status free | busy | away, the number being served, people ahead when joining this chair
 * (their own queue + a fair share of the «any chair» queue), the estimate, and the services they do.
 */
create or replace function public.branch_chairs(p_branch uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with prov as (
    select p.* from public.providers p where p.branch_id = p_branch and p.is_active),
  remote_svc as (
    select s.id from public.services s where s.branch_id = p_branch and s.is_active and s.mode = 'remote'),
  waiting as (
    select t.* from public.tickets t
    where t.branch_id = p_branch and t.status = 'waiting' and t.mode = 'remote'),
  per as (
    select p.id, p.display_name, p.service_ids,
      (select t.number from public.tickets t where t.provider_id = p.id and t.day = public.riyadh_today()
         and t.status in ('called','serving') order by t.called_at desc limit 1) as serving_number,
      (select t.called_at from public.tickets t where t.provider_id = p.id and t.day = public.riyadh_today()
         and t.status in ('called','serving') order by t.called_at desc limit 1) as serving_since,
      exists (select 1 from public.staff_devices d where d.provider_id = p.id and d.revoked_at is null) as has_device,
      exists (select 1 from public.staff_devices d where d.provider_id = p.id and d.revoked_at is null
                and d.last_seen_at > now() - interval '20 minutes') as device_seen,
      (select count(*) from waiting w where w.provider_id = p.id) as own_waiting,
      (select count(*) from waiting w where w.provider_id is null and (p.service_ids is null or w.service_id = any(p.service_ids))) as any_waiting,
      (select greatest(1, count(*)) from prov q where q.service_ids is null or p.service_ids is null or q.service_ids && p.service_ids) as peers,
      (select coalesce(round(avg(public.service_minutes(s.id, p.id))), 15)
         from remote_svc s where p.service_ids is null or s.id = any(p.service_ids)) as minutes
    from prov p)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', display_name,
      'status', case when serving_number is not null then 'busy' when has_device and not device_seen then 'away' else 'free' end,
      'serving_number', serving_number,
      'serving_minutes', case when serving_since is not null then floor(extract(epoch from (now() - serving_since)) / 60)::int end,
      'waiting', own_waiting,
      'ahead', own_waiting + ceil(any_waiting::numeric / peers)::int,
      'estimate_min', public.round_estimate((own_waiting + ceil(any_waiting::numeric / peers)) * minutes
                        + case when serving_number is not null then minutes / 2 else 0 end),
      'service_ids', service_ids)
    order by display_name), '[]'::jsonb)
  from per
$$;

create or replace function public.public_branch(p_public_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  base jsonb := public.public_branch_base(p_public_id);
  b public.branches := public.branch_by_public_id(p_public_id);
begin
  if base ? 'error' then return base; end if;
  return base || jsonb_build_object(
    'quests', case when public.has_feature(b.id, 'quests') then public.quests_view(b.id) else '[]'::jsonb end,
    'chairs', case when public.has_feature(b.id, 'preferred_provider') then public.branch_chairs(b.id) else '[]'::jsonb end);
end $$;

revoke execute on function public.branch_chairs(uuid) from public, anon, authenticated;
grant execute on function public.branch_chairs(uuid) to service_role;
grant execute on function public.public_branch(text) to anon, authenticated, service_role;
grant execute on function public.plan_features(text) to authenticated, service_role;
