-- Helper functions: time, plans and features, settings, tokens, queue ordering and estimates.

-- ---------- time (all business rules use Asia/Riyadh) ----------
create or replace function public.riyadh_local(p_at timestamptz default now()) returns timestamp
language sql stable as $$ select p_at at time zone 'Asia/Riyadh' $$;

create or replace function public.riyadh_today(p_at timestamptz default now()) returns date
language sql stable as $$ select (p_at at time zone 'Asia/Riyadh')::date $$;

create or replace function public.weekday_key(p_day date) returns text
language sql immutable as $$
  select (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from p_day)::int + 1]
$$;

-- Every opening interval that touches the window [p_from_day - 1, p_from_day + p_days].
create or replace function public.branch_intervals(p_branch uuid, p_from_day date, p_days int default 1)
returns table(day date, open_at timestamptz, close_at timestamptz)
language sql stable as $$
  select d::date,
         ((d::date + (iv->>0)::time) at time zone b.timezone),
         (((case when (iv->>1)::time <= (iv->>0)::time then d::date + 1 else d::date end)
            + (iv->>1)::time) at time zone b.timezone)
  from public.branches b,
       generate_series(p_from_day - 1, p_from_day + p_days, interval '1 day') d,
       jsonb_array_elements(coalesce(b.hours -> public.weekday_key(d::date), '[]'::jsonb)) iv
  where b.id = p_branch
$$;

create or replace function public.branch_open_state(p_branch uuid, p_at timestamptz default now())
returns table(is_open boolean, closes_at timestamptz, next_open_at timestamptz)
language sql stable as $$
  with iv as (select * from public.branch_intervals(p_branch, public.riyadh_today(p_at), 7)),
  cur as (select max(close_at) c from iv where p_at >= open_at and p_at < close_at)
  select (select c from cur) is not null,
         (select c from cur),
         (select min(open_at) from iv where open_at > p_at)
$$;

-- Latest closing time of the opening intervals that start on p_day (local).
create or replace function public.branch_day_close(p_branch uuid, p_day date) returns timestamptz
language sql stable as $$
  select max(close_at) from public.branch_intervals(p_branch, p_day, 0) where day = p_day
$$;

-- ---------- plans and features ----------
create or replace function public.plan_features(p_plan text) returns text[]
language plpgsql immutable as $$
declare
  basic text[] := array['queue','fadeet','return_now','card','evening_summary','late_button',
                        'family_ticket','priority','lost_customers','staff_language'];
  growth text[] := array['menu','menu_photo_ai','timed_offers','loyalty','feedback',
                         'preferred_provider','best_time','busy_alert'];
  full_ text[] := array['full_page','news','qa_assistant','quiet_coupon','peak_report','absent_customers'];
begin
  return case p_plan
    when 'basic' then basic
    when 'seasonal' then basic
    when 'growth' then basic || growth
    when 'full' then basic || growth || full_
    else array[]::text[]
  end;
end $$;

create or replace function public.feature_min_plan(p_feature text) returns text
language sql immutable as $$
  select case
    when p_feature = any(public.plan_features('basic')) then 'basic'
    when p_feature = any(public.plan_features('growth')) then 'growth'
    when p_feature = any(public.plan_features('full')) then 'full'
  end
$$;

-- Plan in force right now: trial = full; an expired or inactive account has no features.
create or replace function public.business_effective_plan(p_business uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not b.is_active then null
    when b.trial_until is not null and b.trial_until > now() then 'full'
    when b.plan_until is not null and b.plan_until <= now() then null
    else b.plan
  end
  from public.businesses b where b.id = p_business
$$;

create or replace function public.branch_features(p_branch uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select public.plan_features(public.business_effective_plan(br.business_id))
  from public.branches br where br.id = p_branch
$$;

create or replace function public.has_feature(p_branch uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_feature = any(public.branch_features(p_branch)), false)
$$;

create or replace function public.feature_locked(p_feature text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('error','feature_locked','feature',p_feature,
                            'required_plan',public.feature_min_plan(p_feature))
$$;

-- ---------- settings ----------
create or replace function public.default_branch_settings() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'return_now_threshold', 2,
    'remote_join_limit', 5,
    'remote_close_minutes_before_closing', 30,
    'avg_ticket_value_sar', 50,
    'busy_alert_threshold', 10,
    'snooze_max', 2,
    'no_show_push_back', 2,
    'staff_languages', jsonb_build_array('ar'),
    'summary_time', '22:00',
    'show_arabic_digits', true,
    'loyalty_goal', 6,
    'loyalty_reward_text', 'الزيارة السادسة علينا')
$$;

create or replace function public.branch_settings(p_branch uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.default_branch_settings() || coalesce(b.settings, '{}'::jsonb)
  from public.branches b where b.id = p_branch
$$;

create or replace function public.setting_int(p_branch uuid, p_key text) returns int
language sql stable as $$ select (public.branch_settings(p_branch) ->> p_key)::int $$;

-- ---------- errors ----------
create or replace function public.err(p_code text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql immutable as $$ select jsonb_build_object('error', p_code) || p_extra $$;

-- ---------- tokens ----------
create or replace function public.sha256_hex(p text) returns text
language sql immutable as $$ select encode(extensions.digest(convert_to(p, 'UTF8'), 'sha256'), 'hex') $$;

create or replace function public.new_token() returns text
language sql volatile as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

-- 4-digit code = HMAC-SHA256(secret, floor(unix_minutes)) taken as a big-endian integer, mod 10000.
create or replace function public.rotating_code_at(p_secret text, p_minute bigint) returns text
language plpgsql immutable as $$
declare
  mac bytea := extensions.hmac(convert_to(p_minute::text, 'UTF8'), convert_to(p_secret, 'UTF8'), 'sha256');
  r int := 0;
  i int;
begin
  for i in 0 .. length(mac) - 1 loop
    r := (r * 256 + get_byte(mac, i)) % 10000;
  end loop;
  return lpad(r::text, 4, '0');
end $$;

create or replace function public.unix_minute(p_at timestamptz default now()) returns bigint
language sql stable as $$ select floor(extract(epoch from p_at) / 60)::bigint $$;

create or replace function public.rotating_code_valid(p_branch uuid, p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.branches b
    where b.id = p_branch
      and p_code in (public.rotating_code_at(b.redemption_secret, public.unix_minute()),
                     public.rotating_code_at(b.redemption_secret, public.unix_minute() - 1)))
$$;

-- ---------- rate limiting (fixed one-hour buckets) ----------
create or replace function public.hit_rate_limit(p_key text, p_max int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.rate_limits(key, bucket, hits) values (p_key, date_trunc('hour', now()), 1)
  on conflict (key, bucket) do update set hits = public.rate_limits.hits + 1
  returning hits into n;
  return n <= p_max;
end $$;

-- ---------- queue ordering and estimates ----------
-- Queue order inside a service: priority first, then sort_key, then number.
-- A ticket with a chosen provider only competes with tickets for that provider or for "any".
create or replace function public.ticket_ahead_ids(p_ticket uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select o.id
  from public.tickets t
  join public.tickets o on o.service_id = t.service_id and o.status = 'waiting' and o.id <> t.id
  where t.id = p_ticket
    and t.status = 'waiting'
    and (t.provider_id is null or o.provider_id is null or o.provider_id = t.provider_id)
    and ((o.priority and not t.priority)
         or (o.priority = t.priority and (o.sort_key, o.number) < (t.sort_key, t.number)))
$$;

create or replace function public.ticket_position(p_ticket uuid) returns int
language sql stable as $$ select count(*)::int from public.ticket_ahead_ids(p_ticket) $$;

-- Median minutes of the last 30 completed tickets, falling back to services.avg_minutes.
create or replace function public.service_minutes(p_service uuid, p_provider uuid default null) returns numeric
language sql stable security definer set search_path = public as $$
  with recent as (
    select extract(epoch from (t.done_at - t.served_at)) / 60.0 m
    from public.tickets t
    where t.service_id = p_service and t.status = 'done'
      and t.served_at is not null and t.done_at > t.served_at
      and (p_provider is null or t.provider_id = p_provider)
    order by t.done_at desc limit 30
  )
  select coalesce(
    (select greatest(1, least(600, percentile_cont(0.5) within group (order by m)))::numeric
     from recent having count(*) >= 3),
    (select avg_minutes::numeric from public.services where id = p_service))
$$;

create or replace function public.service_provider_count(p_service uuid) returns int
language sql stable security definer set search_path = public as $$
  select greatest(1, count(*)::int) from public.providers p
  join public.services s on s.branch_id = p.branch_id
  where s.id = p_service and p.is_active and (p.service_ids is null or s.id = any(p.service_ids))
$$;

-- Round to the nearest 5 minutes, never below 5.
create or replace function public.round_estimate(p_minutes numeric) returns int
language sql immutable as $$ select greatest(5, (round(p_minutes / 5.0) * 5)::int) $$;

create or replace function public.ticket_estimate(p_ticket uuid) returns int
language sql stable security definer set search_path = public as $$
  select public.round_estimate(
    coalesce(sum(o.party_size), 0) * public.service_minutes(t.service_id, t.provider_id)
    / (case when t.provider_id is null then public.service_provider_count(t.service_id) else 1 end))
  from public.tickets t
  left join public.tickets o on o.id in (select public.ticket_ahead_ids(t.id))
  where t.id = p_ticket
  group by t.id, t.service_id, t.provider_id
$$;

-- Estimate for someone joining a service right now (used on the shop page).
create or replace function public.service_join_estimate(p_service uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'waiting', count(t.id),
    'estimate_min', public.round_estimate(coalesce(sum(t.party_size), 0)
                     * public.service_minutes(p_service) / public.service_provider_count(p_service)))
  from public.tickets t where t.service_id = p_service and t.status = 'waiting'
$$;

create or replace function public.branch_waiting_count(p_branch uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.tickets where branch_id = p_branch and status = 'waiting'
    and mode <> 'dropoff'
$$;

-- free (≤2 waiting), some (≤6), busy (more); a manual level set within 30 minutes wins.
create or replace function public.branch_busy_level(p_branch uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select manual_level from public.branch_status
      where branch_id = p_branch and manual_level is not null and updated_at > now() - interval '30 minutes'),
    case when public.branch_waiting_count(p_branch) <= 2 then 'free'
         when public.branch_waiting_count(p_branch) <= 6 then 'some'
         else 'busy' end)
$$;

-- Move a ticket behind p_steps waiting tickets of its service (it stays or becomes waiting).
create or replace function public.ticket_move_back(p_ticket uuid, p_steps int) returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tickets;
  behind timestamptz[];
  new_key timestamptz;
begin
  select * into t from public.tickets where id = p_ticket for update;
  select array_agg(o.sort_key order by o.priority desc, o.sort_key, o.number) into behind
  from public.tickets o
  where o.service_id = t.service_id and o.status = 'waiting' and o.id <> t.id
    and not o.priority
    and (t.status <> 'waiting' or t.priority or (o.sort_key, o.number) > (t.sort_key, t.number));

  if behind is null or array_length(behind, 1) = 0 then
    new_key := t.sort_key;
  elsif array_length(behind, 1) <= p_steps then
    new_key := behind[array_length(behind, 1)] + interval '1 millisecond';
  else
    new_key := behind[p_steps] + (behind[p_steps + 1] - behind[p_steps]) / 2;
    if new_key <= behind[p_steps] then new_key := behind[p_steps] + interval '1 microsecond'; end if;
  end if;

  update public.tickets
     set sort_key = new_key, priority = false, status = 'waiting', called_at = null,
         return_now_sent = false
   where id = p_ticket;
end $$;

-- Tickets that just came within the return-now threshold; marks them so each is notified once.
create or replace function public.collect_return_now(p_branch uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  thr int := public.setting_int(p_branch, 'return_now_threshold');
  out jsonb := '[]'::jsonb;
  r record;
begin
  if not public.has_feature(p_branch, 'return_now') then return out; end if;
  for r in
    select t.id from public.tickets t
    where t.branch_id = p_branch and t.status = 'waiting' and t.mode = 'remote'
      and t.push_enabled and not t.return_now_sent and public.ticket_position(t.id) <= thr
    for update
  loop
    update public.tickets set return_now_sent = true where id = r.id;
    out := out || jsonb_build_object('ticket_id', r.id, 'kind', 'return_now');
  end loop;
  return out;
end $$;

-- Owner busy alert when the waiting count crosses the threshold upwards (at most once an hour).
create or replace function public.collect_busy_alert(p_branch uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  thr int := public.setting_int(p_branch, 'busy_alert_threshold');
  n int := public.branch_waiting_count(p_branch);
  s public.branch_status;
begin
  insert into public.branch_status(branch_id) values (p_branch) on conflict do nothing;
  select * into s from public.branch_status where branch_id = p_branch for update;
  if n < thr then
    if not s.busy_alert_armed then
      update public.branch_status set busy_alert_armed = true where branch_id = p_branch;
    end if;
    return '[]'::jsonb;
  end if;
  if not public.has_feature(p_branch, 'busy_alert') or not s.busy_alert_armed
     or (s.last_busy_alert_at is not null and s.last_busy_alert_at > now() - interval '1 hour') then
    return '[]'::jsonb;
  end if;
  update public.branch_status set busy_alert_armed = false, last_busy_alert_at = now()
   where branch_id = p_branch;
  return jsonb_build_array(jsonb_build_object('owner_branch_id', p_branch, 'kind', 'busy_alert', 'count', n));
end $$;

create or replace function public.next_ticket_number(p_branch uuid, p_day date) returns int
language sql security definer set search_path = public as $$
  insert into public.ticket_counters(branch_id, day, last_number) values (p_branch, p_day, 1)
  on conflict (branch_id, day) do update set last_number = public.ticket_counters.last_number + 1
  returning last_number
$$;
