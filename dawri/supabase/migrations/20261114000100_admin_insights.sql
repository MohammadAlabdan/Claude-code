-- Platform insights for the admin dashboard: KPIs, revenue, trends, customers, engagement, risk and trial lists.
-- One call, read-only, admins only. Demo businesses are counted apart and left out of revenue.

create or replace function public.plan_price_sar(p_plan text) returns int
language sql immutable as $$
  select case p_plan when 'basic' then 199 when 'growth' then 399 when 'full' then 699 when 'seasonal' then 199 else 0 end
$$;

create or replace function public.a_insights(p_user uuid, p_days int default 30, p_demo boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d int := least(greatest(coalesce(p_days, 30), 7), 180);
  since timestamptz := now() - make_interval(days => d);
  prev timestamptz := now() - make_interval(days => 2 * d);
  out jsonb;
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;

  with biz as (
    select b.*, public.business_effective_plan(b.id) as eff,
           (b.trial_until is not null and b.trial_until > now()) as on_trial
    from public.businesses b where p_demo or not b.is_demo),
  t as (
    select t.*, br.business_id from public.tickets t join public.branches br on br.id = t.branch_id
    where t.joined_at > prev and br.business_id in (select id from biz)),
  cur as (select * from t where joined_at > since),
  phones as (
    select customer_phone, count(*) filter (where status = 'done') as visits
    from t where customer_phone is not null and phone_consent and joined_at > since
    group by customer_phone),
  per_biz as (
    select b.id, b.name, b.category, b.plan, b.eff, b.on_trial, b.trial_until, b.is_active, b.is_demo, b.created_at,
           (select email from auth.users u where u.id = b.owner_user_id) as owner_email,
           count(t.id) filter (where t.joined_at > since) as tickets,
           count(t.id) filter (where t.joined_at <= since) as tickets_prev,
           count(t.id) filter (where t.joined_at > now() - interval '7 days') as last7,
           count(t.id) filter (where t.joined_at between now() - interval '14 days' and now() - interval '7 days') as prev7,
           max(t.joined_at) as last_ticket_at
    from biz b left join t on t.business_id = b.id
    group by b.id, b.name, b.category, b.plan, b.eff, b.on_trial, b.trial_until, b.is_active, b.is_demo, b.created_at, b.owner_user_id)
  select jsonb_build_object(
    'days', d,
    'kpi', jsonb_build_object(
      'businesses', (select count(*) from biz),
      'demo', (select count(*) from public.businesses where is_demo),
      'includes_demo', p_demo,
      'active', (select count(*) from biz where eff is not null),
      'trials', (select count(*) from biz where on_trial and is_active),
      'paying', (select count(*) from biz where eff is not null and not on_trial),
      'trials_ending_7d', (select count(*) from biz where on_trial and trial_until < now() + interval '7 days'),
      'mrr_sar', (select coalesce(sum(public.plan_price_sar(plan)), 0) from biz where eff is not null and not on_trial),
      'mrr_potential_sar', (select coalesce(sum(public.plan_price_sar(plan)), 0) from biz where on_trial),
      'new_businesses', (select count(*) from biz where created_at > since),
      'branches', (select count(*) from public.branches),
      'devices_active', (select count(*) from public.staff_devices where revoked_at is null and last_seen_at > now() - interval '7 days'),
      'tickets', (select count(*) from cur),
      'tickets_prev', (select count(*) from t where joined_at <= since),
      'tickets_today', (select count(*) from cur where day = public.riyadh_today()),
      'served', (select count(*) from cur where status = 'done'),
      'no_show_pct', (select round(100.0 * count(*) filter (where status = 'no_show') / nullif(count(*) filter (where status in ('done','no_show')), 0)) from cur),
      'left_pct', (select round(100.0 * count(*) filter (where status = 'left') / nullif(count(*), 0)) from cur where mode = 'remote'),
      'avg_wait_min', (select round(avg(extract(epoch from (called_at - joined_at)) / 60.0)) from cur where mode = 'remote' and called_at is not null),
      'satisfaction_pct', (select round(100.0 * count(*) filter (where f.positive) / nullif(count(*), 0))
                           from public.feedback f where f.created_at > since),
      'push_pct', (select round(100.0 * count(*) filter (where push_enabled) / nullif(count(*), 0)) from cur where mode <> 'receipt'),
      'remote_pct', (select round(100.0 * count(*) filter (where source = 'remote') / nullif(count(*), 0)) from cur),
      'customers_known', (select count(*) from phones),
      'returning_pct', (select round(100.0 * count(*) filter (where visits >= 2) / nullif(count(*), 0)) from phones)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g::date, 'tickets', coalesce(x.n, 0), 'served', coalesce(x.s, 0)) order by g), '[]'::jsonb)
              from generate_series(public.riyadh_today() - (d - 1), public.riyadh_today(), interval '1 day') g
              left join (select day, count(*) n, count(*) filter (where status = 'done') s from cur group by day) x on x.day = g::date),
    'hourly', (select jsonb_agg(coalesce(x.n, 0) order by h) from generate_series(0, 23) h
               left join (select extract(hour from joined_at at time zone 'Asia/Riyadh')::int hr, count(*) n from cur group by 1) x on x.hr = h),
    'weekday', (select jsonb_agg(coalesce(x.n, 0) order by w) from generate_series(0, 6) w
                left join (select extract(dow from joined_at at time zone 'Asia/Riyadh')::int dw, count(*) n from cur group by 1) x on x.dw = w),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('plan', plan, 'count', n, 'mrr', mrr) order by mrr desc, n desc), '[]'::jsonb) from (
                select plan, count(*) n, sum(case when not on_trial then public.plan_price_sar(plan) else 0 end) mrr
                from biz where eff is not null group by plan) p),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'businesses', n, 'tickets', tk) order by tk desc), '[]'::jsonb) from (
                     select category, count(*) n, sum(tickets) tk from per_biz group by category) c),
    'feedback', (select jsonb_build_object(
                   'positive', count(*) filter (where positive), 'negative', count(*) filter (where not positive),
                   'reasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', n) order by n desc), '[]'::jsonb) from (
                                 select coalesce(reason, 'other') reason, count(*) n from public.feedback
                                 where created_at > since and not positive group by 1) r))
                 from public.feedback where created_at > since),
    'engagement', jsonb_build_object(
      'quests_started', (select count(*) from public.quest_progress where started_at > since),
      'quests_completed', (select count(*) from public.quest_progress where completed_at > since),
      'quests_redeemed', (select count(*) from public.quest_progress where redeemed_at > since),
      'upsell_interests', (select coalesce(sum(cardinality(interests)), 0) from cur),
      'offer_redemptions', (select count(*) from public.redemptions where redeemed_at > since),
      'quiet_watches', (select count(*) from public.quiet_watches)),
    'top', (select coalesce(jsonb_agg(x order by (x ->> 'tickets')::int desc), '[]'::jsonb) from (
              select jsonb_build_object('id', id, 'name', name, 'category', category, 'plan', plan, 'tickets', tickets,
                       'growth_pct', case when tickets_prev > 0 then round(100.0 * (tickets - tickets_prev) / tickets_prev) end, 'is_demo', is_demo) x
              from per_biz where tickets > 0 order by tickets desc limit 6) s),
    'at_risk', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                  select jsonb_build_object('id', id, 'name', name, 'owner_email', owner_email, 'plan', plan, 'last7', last7, 'prev7', prev7,
                           'last_ticket_at', last_ticket_at,
                           'reason', case when last7 = 0 then 'idle' else 'drop' end) x
                  from per_biz
                  where eff is not null and is_active and created_at < now() - interval '7 days'
                    and (last7 = 0 or (prev7 >= 10 and last7 < prev7 * 0.6))
                  order by last7, prev7 desc limit 12) s),
    'trials_ending', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                        select jsonb_build_object('id', id, 'name', name, 'owner_email', owner_email, 'trial_until', trial_until,
                                 'days_left', greatest(0, ceil(extract(epoch from (trial_until - now())) / 86400))::int,
                                 'tickets', tickets, 'engaged', tickets >= 20) x
                        from per_biz where on_trial and is_active
                        order by trial_until limit 12) s),
    'signups_weekly', (select jsonb_agg(coalesce(x.n, 0) order by w) from generate_series(7, 0, -1) w
                       left join (select floor(extract(epoch from (now() - created_at)) / 604800)::int wk, count(*) n
                                  from biz group by 1) x on x.wk = w)
  ) into out;
  return out;
end $$;

revoke execute on function public.a_insights(uuid, int, boolean), public.plan_price_sar(text) from public, anon, authenticated;
grant execute on function public.a_insights(uuid, int, boolean), public.plan_price_sar(text) to service_role;
