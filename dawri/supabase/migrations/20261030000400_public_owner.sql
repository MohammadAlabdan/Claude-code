-- Public read RPCs (anonymous), owner/admin functions, onboarding, analytics, maintenance.

-- ---------- analytics building blocks ----------
-- Average arrivals per weekday (0=Sun) × hour over the last p_days days, Riyadh time.
create or replace function public.arrivals_matrix(p_branch uuid, p_days int default 28) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select extract(dow from public.riyadh_local(joined_at))::int dow,
           extract(hour from public.riyadh_local(joined_at))::int hr, count(*) n
    from public.tickets
    where branch_id = p_branch and joined_at > now() - make_interval(days => p_days)
      and status <> 'cancelled'
    group by 1, 2
  )
  select jsonb_agg(row_vals order by dow)
  from (
    select d.dow, jsonb_agg(round(coalesce(c.n, 0)::numeric / greatest(1, p_days / 7.0), 1) order by h.hr) row_vals
    from generate_series(0, 6) d(dow) cross join generate_series(0, 23) h(hr)
    left join c on c.dow = d.dow and c.hr = h.hr
    group by d.dow
  ) x
$$;

-- 7×24 booleans: is the branch open during (most of) that hour.
create or replace function public.open_matrix(p_branch uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_agg(row_vals order by dow) from (
    select d.dow, jsonb_agg(exists (
      select 1 from jsonb_array_elements(coalesce(b.hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[d.dow + 1], '[]'::jsonb)) iv
      where case when (iv->>1)::time > (iv->>0)::time
                 then make_time(h.hr, 30, 0) >= (iv->>0)::time and make_time(h.hr, 30, 0) < (iv->>1)::time
                 else make_time(h.hr, 30, 0) >= (iv->>0)::time end
    ) or exists (
      -- the after-midnight tail of the previous day's overnight interval
      select 1 from jsonb_array_elements(coalesce(b.hours -> (array['sun','mon','tue','wed','thu','fri','sat'])[((d.dow + 6) % 7) + 1], '[]'::jsonb)) iv
      where (iv->>1)::time <= (iv->>0)::time and make_time(h.hr, 30, 0) < (iv->>1)::time
    ) order by h.hr) row_vals
    from public.branches b cross join generate_series(0, 6) d(dow) cross join generate_series(0, 23) h(hr)
    where b.id = p_branch
    group by d.dow
  ) x
$$;

-- Lost customers: left after waiting ≥ 5 minutes, or no-show.
create or replace function public.lost_count(p_branch uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.tickets
  where branch_id = p_branch and day between p_from and p_to
    and (status = 'no_show' or (status = 'left' and left_at - joined_at >= interval '5 minutes'))
$$;

create or replace function public.day_stats(p_branch uuid, p_day date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'day', p_day,
    'served', (select count(*) from public.tickets where branch_id = p_branch and day = p_day and status = 'done'),
    'joined', (select count(*) from public.tickets where branch_id = p_branch and day = p_day),
    'avg_wait_min', (select round(avg(extract(epoch from called_at - joined_at) / 60)) from public.tickets
                     where branch_id = p_branch and day = p_day and mode = 'remote' and called_at is not null),
    'satisfaction_pct', (select round(100.0 * count(*) filter (where positive) / nullif(count(*), 0))
                         from public.feedback f join public.tickets t on t.id = f.ticket_id
                         where f.branch_id = p_branch and t.day = p_day),
    'lost', public.lost_count(p_branch, p_day, p_day),
    'lost_sar', public.lost_count(p_branch, p_day, p_day) * public.setting_int(p_branch, 'avg_ticket_value_sar'),
    'busiest_hour', (select extract(hour from public.riyadh_local(joined_at))::int from public.tickets
                     where branch_id = p_branch and day = p_day group by 1 order by count(*) desc, 1 limit 1))
$$;

-- ---------- public RPCs (anonymous) ----------
create or replace function public.public_branch(p_public_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b public.branches := public.branch_by_public_id(p_public_id);
  f text[];
  st record;
  bz public.businesses;
begin
  if b.id is null then return public.err('branch_not_found'); end if;
  f := public.branch_features(b.id);
  select * into st from public.branch_open_state(b.id);
  select * into bz from public.businesses where id = b.business_id;
  return jsonb_build_object(
    'branch', jsonb_build_object(
      'public_id', b.public_id, 'name', b.name, 'business_name', bz.name, 'category', bz.category,
      'address', b.address, 'map_url', b.map_url, 'phone', b.phone, 'hours', b.hours,
      'open', st.is_open, 'closes_at', st.closes_at, 'next_open_at', st.next_open_at,
      'busy_level', public.branch_busy_level(b.id), 'waiting', public.branch_waiting_count(b.id),
      'show_arabic_digits', (public.branch_settings(b.id) ->> 'show_arabic_digits')::boolean,
      'remote_join_limit', public.setting_int(b.id, 'remote_join_limit')),
    'features', to_jsonb(f),
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', s.id, 'name', s.name, 'mode', s.mode, 'avg_minutes', s.avg_minutes,
                   'now_serving', (select max(t.number) from public.tickets t where t.service_id = s.id
                                   and t.day = public.riyadh_today() and t.status in ('called','serving')))
                   || public.service_join_estimate(s.id) order by s.sort, s.name), '[]'::jsonb)
                 from public.services s where s.branch_id = b.id and s.is_active),
    'providers', case when 'preferred_provider' = any(f) then
                   (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name,
                      'service_ids', p.service_ids) order by p.display_name), '[]'::jsonb)
                    from public.providers p where p.branch_id = b.id and p.is_active) else '[]'::jsonb end,
    'ready_numbers', (select coalesce(jsonb_agg(r.receipt_code order by r.ready_at desc), '[]'::jsonb)
                      from (select * from public.ready_numbers where branch_id = b.id
                            and day = public.riyadh_today() order by ready_at desc limit 20) r),
    'page', case when 'full_page' = any(f) then
              (select jsonb_build_object('bio', p.bio, 'photos', to_jsonb(p.photos), 'highlights', to_jsonb(p.highlights))
               from public.business_pages p where p.branch_id = b.id and p.is_published) end,
    'menu', case when 'menu' = any(f) then
              (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'category', m.category, 'name', m.name,
                 'description', m.description, 'price_sar', m.price_sar, 'duration_min', m.duration_min)
                 order by m.category nulls last, m.sort, m.name), '[]'::jsonb)
               from public.menu_items m where m.branch_id = b.id and m.is_available) else '[]'::jsonb end,
    'offers', public.active_offers(b.id),
    'best_time', case when 'best_time' = any(f) then jsonb_build_object(
                   'arrivals', public.arrivals_matrix(b.id, 28), 'open', public.open_matrix(b.id)) end,
    'news', case when 'news' = any(f) then
              (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body,
                 'published_at', n.published_at) order by n.published_at desc), '[]'::jsonb)
               from (select * from public.news_posts where branch_id = b.id and published_at <= now()
                     order by published_at desc limit 10) n) else '[]'::jsonb end,
    'server_time', now());
end $$;

create or replace function public.public_ticket(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t public.tickets := public.ticket_by_token(p_token);
begin
  if t.id is null then return public.err('ticket_not_found'); end if;
  return public.ticket_view(t.id);
end $$;

-- ---------- owner ----------
create or replace function public.is_admin(p_user uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = p_user)
$$;

create or replace function public.owned_branch_ids(p_user uuid default auth.uid()) returns setof uuid
language sql stable security definer set search_path = public as $$
  select br.id from public.branches br join public.businesses b on b.id = br.business_id
  where b.owner_user_id = p_user
$$;

create or replace function public.can_manage_branch(p_user uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_branch in (select public.owned_branch_ids(p_user)) or public.is_admin(p_user)
$$;

create or replace function public.o_overview(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'is_admin', public.is_admin(p_user),
    'businesses', coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.name, 'slug', b.slug, 'category', b.category, 'plan', b.plan,
      'effective_plan', public.business_effective_plan(b.id),
      'plan_until', b.plan_until, 'trial_until', b.trial_until,
      'trial_days_left', greatest(0, ceil(extract(epoch from b.trial_until - now()) / 86400))::int,
      'is_active', b.is_active,
      'branches', (select coalesce(jsonb_agg(jsonb_build_object(
         'id', br.id, 'name', br.name, 'public_id', br.public_id, 'address', br.address, 'map_url', br.map_url,
         'phone', br.phone, 'google_review_url', br.google_review_url, 'hours', br.hours,
         'settings', public.branch_settings(br.id), 'features', to_jsonb(public.branch_features(br.id)))
         order by br.created_at), '[]'::jsonb) from public.branches br where br.business_id = b.id))
      order by b.created_at), '[]'::jsonb))
  from public.businesses b where b.owner_user_id = p_user
$$;

create or replace function public.o_dashboard(p_user uuid, p_branch uuid, p_range text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  today date := public.riyadh_today();
  from_day date := today - case p_range when '7d' then 6 when '30d' then 29 else 0 end;
  f text[];
  avg_val int;
begin
  if not public.can_manage_branch(p_user, p_branch) then return public.err('forbidden'); end if;
  if p_range not in ('today','7d','30d') then return public.err('invalid_input', '{"field":"range"}'); end if;
  f := public.branch_features(p_branch);
  avg_val := public.setting_int(p_branch, 'avg_ticket_value_sar');
  return jsonb_build_object(
    'range', p_range, 'from', from_day, 'to', today, 'features', to_jsonb(f),
    'served', (select count(*) from public.tickets where branch_id = p_branch and day between from_day and today and status = 'done'),
    'joined', (select count(*) from public.tickets where branch_id = p_branch and day between from_day and today),
    'avg_wait_min', (select round(avg(extract(epoch from called_at - joined_at) / 60)) from public.tickets
                     where branch_id = p_branch and day between from_day and today and mode = 'remote' and called_at is not null),
    'satisfaction_pct', (select round(100.0 * count(*) filter (where f2.positive) / nullif(count(*), 0))
                         from public.feedback f2 where f2.branch_id = p_branch
                           and public.riyadh_today(f2.created_at) between from_day and today),
    'lost', case when 'lost_customers' = any(f) then jsonb_build_object(
              'count', public.lost_count(p_branch, from_day, today),
              'sar', public.lost_count(p_branch, from_day, today) * avg_val,
              'avg_ticket_value_sar', avg_val) end,
    'lost_trend', case when 'lost_customers' = any(f) then
              (select jsonb_agg(jsonb_build_object('day', d::date, 'count', public.lost_count(p_branch, d::date, d::date)) order by d)
               from generate_series(from_day, today, interval '1 day') d) end,
    'arrivals_by_hour', (select jsonb_agg(coalesce(c.n, 0) order by h.hr)
                         from generate_series(0, 23) h(hr)
                         left join (select extract(hour from public.riyadh_local(joined_at))::int hr, count(*) n
                                    from public.tickets where branch_id = p_branch and day between from_day and today
                                    group by 1) c on c.hr = h.hr),
    'wait_trend', (select jsonb_agg(jsonb_build_object('day', d::date, 'avg_wait_min',
                     (select round(avg(extract(epoch from t.called_at - t.joined_at) / 60)) from public.tickets t
                      where t.branch_id = p_branch and t.day = d::date and t.mode = 'remote' and t.called_at is not null))
                     order by d)
                   from generate_series(from_day, today, interval '1 day') d),
    'heatmap', case when 'peak_report' = any(f) then jsonb_build_object(
                 'arrivals', public.arrivals_matrix(p_branch, 28), 'open', public.open_matrix(p_branch)) end,
    'provider_times', case when 'peak_report' = any(f) then
                 (select coalesce(jsonb_agg(jsonb_build_object('provider_id', p.id, 'name', p.display_name,
                    'served', x.n, 'avg_service_min', x.m) order by p.display_name), '[]'::jsonb)
                  from public.providers p
                  join (select provider_id, count(*) n,
                               round(avg(extract(epoch from done_at - served_at) / 60), 1) m
                        from public.tickets where branch_id = p_branch and day between from_day and today
                          and status = 'done' and served_at is not null and done_at > served_at
                        group by provider_id) x on x.provider_id = p.id) end,
    'negative_feedback', case when 'feedback' = any(f) then
                 (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'reason', x.reason, 'note', x.note,
                    'created_at', x.created_at, 'ticket_number', x.number) order by x.created_at desc), '[]'::jsonb)
                  from (select fb.id, fb.reason, fb.note, fb.created_at, t.number
                        from public.feedback fb join public.tickets t on t.id = fb.ticket_id
                        where fb.branch_id = p_branch and not fb.positive
                          and public.riyadh_today(fb.created_at) between from_day and today
                        order by fb.created_at desc limit 50) x) end,
    'absent', case when 'absent_customers' = any(f) then public.absent_customers(p_branch) end,
    'redemptions', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'redeemed_at', r.redeemed_at,
                      'kind', case when r.loyalty_card_id is not null then 'loyalty' else 'offer' end,
                      'title', coalesce(o.title, public.branch_settings(p_branch) ->> 'loyalty_reward_text'))
                      order by r.redeemed_at desc), '[]'::jsonb)
                    from (select * from public.redemptions where branch_id = p_branch
                          and public.riyadh_today(redeemed_at) between from_day and today
                          order by redeemed_at desc limit 30) r
                    left join public.offers o on o.id = r.offer_id),
    'live', jsonb_build_object('waiting', public.branch_waiting_count(p_branch),
                               'busy_level', public.branch_busy_level(p_branch),
                               'busy_alert', (select jsonb_build_object('armed', busy_alert_armed,
                                               'last_alert_at', last_busy_alert_at)
                                              from public.branch_status where branch_id = p_branch)),
    'latest_summary', (select jsonb_build_object('day', s.day, 'text', s.text, 'stats', s.stats)
                       from public.daily_summaries s where s.branch_id = p_branch order by s.day desc limit 1));
end $$;

create or replace function public.absent_customers(p_branch uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('phone', c.phone, 'visits', c.visits,
           'last_visit_at', c.last_visit_at,
           'days_since', (public.riyadh_today() - public.riyadh_today(c.last_visit_at)))
         order by c.last_visit_at desc), '[]'::jsonb)
  from public.loyalty_cards c
  where c.branch_id = p_branch and c.visits >= 2
    and c.last_visit_at between now() - interval '90 days' and now() - interval '30 days'
$$;

create or replace function public.o_queue(p_user uuid, p_branch uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_branch(p_user, p_branch) then return public.err('forbidden'); end if;
  return jsonb_build_object(
    'busy_level', public.branch_busy_level(p_branch),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'mode', s.mode,
                   'now_serving', (select max(t.number) from public.tickets t where t.service_id = s.id
                                   and t.day = public.riyadh_today() and t.status in ('called','serving')))
                   || public.service_join_estimate(s.id) order by s.sort, s.name), '[]'::jsonb)
                 from public.services s where s.branch_id = p_branch and s.is_active),
    'providers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name,
                    'waiting', (select count(*) from public.tickets t where t.provider_id = p.id and t.status = 'waiting'),
                    'serving', (select max(t.number) from public.tickets t where t.provider_id = p.id
                                and t.day = public.riyadh_today() and t.status in ('called','serving')))
                    order by p.display_name), '[]'::jsonb)
                  from public.providers p where p.branch_id = p_branch and p.is_active),
    'tickets', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'mode', t.mode,
                   'status', t.status, 'stage', t.stage, 'service_id', t.service_id, 'provider_id', t.provider_id,
                   'party_size', t.party_size, 'priority', t.priority, 'receipt_code', t.receipt_code,
                   'item_label', t.item_label, 'joined_at', t.joined_at,
                   'position', case when t.status = 'waiting' and t.mode = 'remote' then public.ticket_position(t.id) end)
                   order by t.priority desc, t.sort_key, t.number), '[]'::jsonb)
                from public.tickets t where t.branch_id = p_branch and t.status in ('waiting','called','serving')));
end $$;

create or replace function public.o_set_busy(p_user uuid, p_branch uuid, p_level text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_branch(p_user, p_branch) then return public.err('forbidden'); end if;
  if p_level is not null and p_level not in ('free','some','busy') then return public.err('invalid_input', '{"field":"level"}'); end if;
  insert into public.branch_status(branch_id, manual_level, updated_at) values (p_branch, p_level, now())
  on conflict (branch_id) do update set manual_level = excluded.manual_level, updated_at = now();
  return public.with_effects(jsonb_build_object('ok', true, 'busy_level', public.branch_busy_level(p_branch)), p_branch);
end $$;

create or replace function public.o_create_device(p_user uuid, p_branch uuid, p_label text, p_language text,
                                                  p_provider uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tok text := public.new_token();
  did uuid;
begin
  if not public.can_manage_branch(p_user, p_branch) then return public.err('forbidden'); end if;
  if coalesce(char_length(trim(p_label)), 0) not between 1 and 40 then return public.err('invalid_input', '{"field":"label"}'); end if;
  if p_language not in ('ar','en','ur','bn','fil') then return public.err('invalid_input', '{"field":"language"}'); end if;
  if p_language <> 'ar' and not public.has_feature(p_branch, 'staff_language') then
    return public.feature_locked('staff_language');
  end if;
  if p_provider is not null and not exists (select 1 from public.providers where id = p_provider and branch_id = p_branch) then
    return public.err('invalid_provider');
  end if;
  insert into public.staff_devices(branch_id, label, language, provider_id, token_hash)
  values (p_branch, trim(p_label), p_language, p_provider, public.sha256_hex(tok)) returning id into did;
  return jsonb_build_object('ok', true, 'device_id', did, 'pairing_token', tok);
end $$;

create or replace function public.o_revoke_device(p_user uuid, p_device uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare br uuid;
begin
  select branch_id into br from public.staff_devices where id = p_device;
  if br is null or not public.can_manage_branch(p_user, br) then return public.err('forbidden'); end if;
  update public.staff_devices set revoked_at = now() where id = p_device and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- Only known keys with the right type are accepted.
create or replace function public.o_settings_update(p_user uuid, p_branch uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k text;
  v jsonb;
  ints text[] := array['return_now_threshold','remote_join_limit','remote_close_minutes_before_closing',
                       'avg_ticket_value_sar','busy_alert_threshold','snooze_max','no_show_push_back','loyalty_goal'];
  clean jsonb := '{}'::jsonb;
begin
  if not public.can_manage_branch(p_user, p_branch) then return public.err('forbidden'); end if;
  if jsonb_typeof(p_settings) <> 'object' then return public.err('invalid_input', '{"field":"settings"}'); end if;
  for k, v in select * from jsonb_each(p_settings) loop
    if k = any(ints) then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 10000 then
        return public.err('invalid_input', jsonb_build_object('field', k));
      end if;
      clean := clean || jsonb_build_object(k, (v #>> '{}')::numeric::int);
    elsif k = 'summary_time' then
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        return public.err('invalid_input', jsonb_build_object('field', k));
      end if;
      clean := clean || jsonb_build_object(k, v);
    elsif k = 'show_arabic_digits' then
      if jsonb_typeof(v) <> 'boolean' then return public.err('invalid_input', jsonb_build_object('field', k)); end if;
      clean := clean || jsonb_build_object(k, v);
    elsif k = 'loyalty_reward_text' then
      if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') not between 2 and 80 then
        return public.err('invalid_input', jsonb_build_object('field', k));
      end if;
      clean := clean || jsonb_build_object(k, v);
    elsif k = 'staff_languages' then
      if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements_text(v) l
                                               where l not in ('ar','en','ur','bn','fil')) then
        return public.err('invalid_input', jsonb_build_object('field', k));
      end if;
      clean := clean || jsonb_build_object(k, v);
    else
      return public.err('invalid_input', jsonb_build_object('field', k));
    end if;
  end loop;
  update public.branches set settings = coalesce(settings, '{}'::jsonb) || clean where id = p_branch;
  return jsonb_build_object('ok', true, 'settings', public.branch_settings(p_branch));
end $$;

create or replace function public.o_subscribe_push(p_user uuid, p_endpoint text, p_p256dh text, p_auth text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 20 and 200
     or coalesce(char_length(p_auth), 0) not between 8 and 100 then
    return public.err('invalid_subscription');
  end if;
  insert into public.push_subscriptions(owner_user_id, endpoint, p256dh, auth)
  values (p_user, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set owner_user_id = excluded.owner_user_id, ticket_id = null,
    p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.o_devices(p_user uuid, p_branch uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_branch(p_user, p_branch) then return public.err('forbidden'); end if;
  return jsonb_build_object('devices', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label,
    'language', d.language, 'provider_id', d.provider_id, 'last_seen_at', d.last_seen_at,
    'revoked_at', d.revoked_at, 'created_at', d.created_at) order by d.created_at), '[]'::jsonb)
    from public.staff_devices d where d.branch_id = p_branch));
end $$;

create or replace function public.o_quiet_data(p_user uuid, p_branch uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_manage_branch(p_user, p_branch) then return public.err('forbidden'); end if;
  return jsonb_build_object('arrivals', public.arrivals_matrix(p_branch, 28), 'open', public.open_matrix(p_branch));
end $$;

-- ---------- onboarding ----------
create or replace function public.onboard(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cat text := coalesce(p ->> 'category', 'other');
  bname text := trim(coalesce(p ->> 'business_name', ''));
  bid uuid;
  brid uuid;
  slug text;
  svc jsonb;
  n int := 0;
  dev jsonb;
  default_mode text;
begin
  if p_user is null then return public.err('unauthorized'); end if;
  if char_length(bname) not between 2 and 80 then return public.err('invalid_input', '{"field":"business_name"}'); end if;
  if cat not in ('cafe','restaurant','bakery','barber','salon','clinic','lab','carwash','phone_repair','other') then
    return public.err('invalid_input', '{"field":"category"}');
  end if;
  if jsonb_typeof(p -> 'services') <> 'array' or jsonb_array_length(p -> 'services') not between 1 and 20 then
    return public.err('invalid_input', '{"field":"services"}');
  end if;
  if (select count(*) from public.businesses where owner_user_id = p_user) >= 5 then
    return public.err('too_many_businesses');
  end if;
  default_mode := case when cat in ('cafe','restaurant','bakery') then 'receipt'
                       when cat in ('carwash','phone_repair') then 'dropoff' else 'remote' end;

  slug := 'd-' || lower(substr(encode(extensions.gen_random_bytes(5), 'hex'), 1, 8));
  insert into public.businesses(name, slug, category, plan, trial_until, owner_user_id)
  values (bname, slug, cat, 'basic', now() + interval '14 days', p_user) returning id into bid;

  insert into public.branches(business_id, name, address, phone, hours, settings)
  values (bid, coalesce(nullif(trim(p ->> 'branch_name'), ''), bname),
          nullif(left(trim(coalesce(p ->> 'district', '')), 200), ''),
          nullif(left(regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9+]', '', 'g'), 20), ''),
          coalesce(p -> 'hours', '{}'::jsonb),
          jsonb_build_object('staff_languages', jsonb_build_array(coalesce(p ->> 'staff_language', 'ar'))))
  returning id into brid;

  for svc in select * from jsonb_array_elements(p -> 'services') loop
    if char_length(trim(coalesce(svc ->> 'name', ''))) not between 1 and 60 then
      raise exception 'invalid service name' using errcode = '22023';
    end if;
    insert into public.services(branch_id, name, mode, avg_minutes, sort)
    values (brid, trim(svc ->> 'name'), coalesce(svc ->> 'mode', default_mode),
            greatest(1, least(600, coalesce((svc ->> 'avg_minutes')::int, 15))), n);
    n := n + 1;
  end loop;

  insert into public.business_pages(branch_id) values (brid);
  dev := public.o_create_device(p_user, brid, 'جهاز الكاشير', coalesce(p ->> 'staff_language', 'ar'));
  return jsonb_build_object('ok', true, 'business_id', bid, 'slug', slug, 'branch_id', brid,
                            'public_id', (select public_id from public.branches where id = brid),
                            'trial_until', now() + interval '14 days',
                            'pairing_token', dev ->> 'pairing_token');
exception when invalid_parameter_value or check_violation or invalid_text_representation then
  return public.err('invalid_input', jsonb_build_object('field', 'services'));
end $$;

-- ---------- AI usage cap ----------
create or replace function public.ai_calls_today(p_business uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.ai_usage
  where business_id = p_business and public.riyadh_today(created_at) = public.riyadh_today()
$$;

-- ---------- admin ----------
create or replace function public.a_businesses(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  return jsonb_build_object('businesses', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'name', b.name, 'slug', b.slug, 'category', b.category, 'plan', b.plan,
    'effective_plan', public.business_effective_plan(b.id), 'plan_until', b.plan_until,
    'trial_until', b.trial_until, 'is_active', b.is_active, 'is_demo', b.is_demo, 'created_at', b.created_at,
    'owner_email', (select email from auth.users u where u.id = b.owner_user_id),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', br.id, 'name', br.name, 'public_id', br.public_id)), '[]'::jsonb)
                 from public.branches br where br.business_id = b.id),
    'usage', jsonb_build_object(
      'tickets_30d', (select count(*) from public.tickets t join public.branches br on br.id = t.branch_id
                      where br.business_id = b.id and t.joined_at > now() - interval '30 days'),
      'ai_calls_30d', (select count(*) from public.ai_usage a where a.business_id = b.id
                       and a.created_at > now() - interval '30 days'),
      'devices', (select count(*) from public.staff_devices d join public.branches br on br.id = d.branch_id
                  where br.business_id = b.id and d.revoked_at is null)))
    order by b.created_at desc), '[]'::jsonb) from public.businesses b));
end $$;

create or replace function public.a_update_business(p_user uuid, p_business uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  if p ? 'plan' and (p ->> 'plan') not in ('basic','growth','full','seasonal') then
    return public.err('invalid_input', '{"field":"plan"}');
  end if;
  update public.businesses set
    plan = coalesce(p ->> 'plan', plan),
    plan_until = case when p ? 'plan_until' then (p ->> 'plan_until')::timestamptz else plan_until end,
    trial_until = case when p ? 'trial_until' then (p ->> 'trial_until')::timestamptz else trial_until end,
    is_active = coalesce((p ->> 'is_active')::boolean, is_active)
  where id = p_business;
  if not found then return public.err('not_found'); end if;
  return jsonb_build_object('ok', true);
exception when invalid_datetime_format or invalid_text_representation then
  return public.err('invalid_input', '{"field":"date"}');
end $$;

-- ---------- scheduled work ----------
create or replace function public.summary_due(p_at timestamptz default now()) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('branch_id', br.id, 'public_id', br.public_id,
           'business_id', b.id, 'owner_user_id', b.owner_user_id, 'name', br.name)), '[]'::jsonb)
  from public.branches br join public.businesses b on b.id = br.business_id
  where br.is_active and public.has_feature(br.id, 'evening_summary')
    and to_char(date_trunc('hour', public.riyadh_local(p_at))
                + floor(extract(minute from public.riyadh_local(p_at)) / 15) * interval '15 minutes', 'HH24:MI')
        = to_char(date_trunc('hour', ('2000-01-01 ' || (public.branch_settings(br.id) ->> 'summary_time'))::timestamp)
                  + floor(extract(minute from ('2000-01-01 ' || (public.branch_settings(br.id) ->> 'summary_time'))::timestamp) / 15)
                    * interval '15 minutes', 'HH24:MI')
    and not exists (select 1 from public.daily_summaries s where s.branch_id = br.id and s.day = public.riyadh_today(p_at))
$$;

create or replace function public.save_summary(p_branch uuid, p_day date, p_text text, p_stats jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.daily_summaries(branch_id, day, text, stats) values (p_branch, p_day, left(p_text, 600), p_stats)
  on conflict (branch_id, day) do update set text = excluded.text, stats = excluded.stats
$$;

create or replace function public.maintenance_run(p_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cancelled int;
  phones int;
  subs int;
  touched jsonb;
begin
  with c as (
    update public.tickets t set status = 'cancelled', updated_at = p_at
    where t.status in ('waiting','called','serving')
      and ((t.mode <> 'dropoff' and (t.day < public.riyadh_today(p_at) - 1
            or p_at > coalesce(public.branch_day_close(t.branch_id, t.day), (t.day + 1)::timestamp at time zone 'Asia/Riyadh')
                       + interval '60 minutes'))
           or (t.mode = 'dropoff' and t.day < public.riyadh_today(p_at) - 7))
    returning t.branch_id
  )
  select count(*), coalesce(jsonb_agg(distinct b.public_id), '[]'::jsonb) into cancelled, touched
  from c join public.branches b on b.id = c.branch_id;

  update public.tickets set customer_phone = null
   where customer_phone is not null and day < public.riyadh_today(p_at) - 90;
  get diagnostics phones = row_count;

  delete from public.push_subscriptions ps using public.tickets t
   where ps.ticket_id = t.id and t.status in ('done','cancelled','left','no_show')
     and t.updated_at < p_at - interval '24 hours';
  get diagnostics subs = row_count;

  delete from public.rate_limits where bucket < p_at - interval '2 hours';

  update public.branch_status bs set busy_alert_armed = true
   where not bs.busy_alert_armed
     and public.branch_waiting_count(bs.branch_id) < public.setting_int(bs.branch_id, 'busy_alert_threshold');

  return jsonb_build_object('cancelled', cancelled, 'phones_cleared', phones, 'subscriptions_deleted', subs,
                            'broadcast', touched);
end $$;
