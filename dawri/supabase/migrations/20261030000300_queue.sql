-- Queue actions for customers (c_*) and paired staff devices (s_*).
-- Every action returns jsonb. Business failures return {"error": code, ...} instead of raising.
-- Successful results may carry "notify" (pushes for the Edge Function to send) and "broadcast" (public_id).

-- ---------- shared pieces ----------
create or replace function public.ticket_by_token(p_token text) returns public.tickets
language sql stable security definer set search_path = public as $$
  select * from public.tickets
  where p_token is not null and char_length(p_token) between 20 and 100
    and access_token_hash = public.sha256_hex(p_token)
$$;

-- Receipt tickets get a token derived from the ticket id, so re-entering the same code returns the same ticket.
create or replace function public.receipt_token(p_ticket uuid) returns text
language sql stable security definer set search_path = public as $$
  select rtrim(translate(encode(extensions.hmac(convert_to(t.id::text, 'UTF8'),
                                               convert_to(b.redemption_secret, 'UTF8'), 'sha256'), 'base64'),
                         '+/', '-_'), '=')
  from public.tickets t join public.branches b on b.id = t.branch_id where t.id = p_ticket
$$;

create or replace function public.branch_by_public_id(p_public_id text) returns public.branches
language sql stable security definer set search_path = public as $$
  select br.* from public.branches br join public.businesses b on b.id = br.business_id
  where br.public_id = lower(p_public_id) and br.is_active and b.is_active
$$;

create or replace function public.apply_loyalty(p_ticket uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tickets;
begin
  select * into t from public.tickets where id = p_ticket for update;
  if t.status <> 'done' or not t.phone_consent or t.customer_phone is null or t.loyalty_counted
     or not public.has_feature(t.branch_id, 'loyalty') then
    return;
  end if;
  insert into public.loyalty_cards(branch_id, phone, visits, goal, last_visit_at)
  values (t.branch_id, t.customer_phone, 1, public.setting_int(t.branch_id, 'loyalty_goal'), now())
  on conflict (branch_id, phone) do update
    set visits = public.loyalty_cards.visits + 1, last_visit_at = now();
  update public.tickets set loyalty_counted = true where id = p_ticket;
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
end $$;

create or replace function public.active_offers(p_branch uuid, p_at timestamptz default now()) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'kind', o.kind, 'title', o.title, 'terms', o.terms,
           'discount_text', o.discount_text, 'start_time', o.start_time, 'end_time', o.end_time)
         order by o.kind, o.created_at), '[]'::jsonb)
  from public.offers o
  where o.branch_id = p_branch and o.is_active
    and public.has_feature(p_branch, case o.kind when 'quiet_coupon' then 'quiet_coupon' else 'timed_offers' end)
    and extract(dow from public.riyadh_local(p_at))::int = any(o.weekdays)
    and (o.valid_from is null or o.valid_from <= public.riyadh_today(p_at))
    and (o.valid_to is null or o.valid_to >= public.riyadh_today(p_at))
    and (o.start_time is null or public.riyadh_local(p_at)::time >= o.start_time)
    and (o.end_time is null or public.riyadh_local(p_at)::time < o.end_time)
    and (o.max_redemptions is null
         or (select count(*) from public.redemptions r where r.offer_id = o.id) < o.max_redemptions)
$$;

create or replace function public.loyalty_view(p_branch uuid, p_phone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'visits', c.visits - c.rewards_redeemed * c.goal,
    'goal', c.goal,
    'reward_available', c.visits - c.rewards_redeemed * c.goal >= c.goal,
    'reward_text', public.branch_settings(p_branch) ->> 'loyalty_reward_text')
  from public.loyalty_cards c where c.branch_id = p_branch and c.phone = p_phone
$$;

-- What a customer may see about their own ticket.
create or replace function public.ticket_view(p_ticket uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id,
    'number', t.number,
    'mode', t.mode,
    'status', t.status,
    'stage', t.stage,
    'receipt_code', t.receipt_code,
    'item_label', t.item_label,
    'party_size', t.party_size,
    'service', jsonb_build_object('id', s.id, 'name', s.name),
    'provider', case when p.id is null then null else jsonb_build_object('id', p.id, 'name', p.display_name) end,
    'position', case when t.mode = 'remote' and t.status = 'waiting' then public.ticket_position(t.id) end,
    'estimate_min', case when t.mode = 'remote' and t.status = 'waiting' then public.ticket_estimate(t.id) end,
    'return_now', t.mode = 'remote' and t.status = 'waiting'
                  and public.ticket_position(t.id) <= public.setting_int(t.branch_id, 'return_now_threshold'),
    'called', t.status in ('called','serving') and t.mode = 'remote',
    'ready', (t.mode = 'receipt' and t.status = 'done') or (t.mode = 'dropoff' and t.stage = 'ready'),
    'now_serving', (select max(x.number) from public.tickets x
                    where x.service_id = t.service_id and x.day = t.day and x.status in ('called','serving')),
    'waiting_in_service', (select count(*) from public.tickets x
                           where x.service_id = t.service_id and x.status = 'waiting'),
    'snooze_left', greatest(0, public.setting_int(t.branch_id, 'snooze_max') - t.snooze_count),
    'push_enabled', t.push_enabled,
    'has_phone', t.customer_phone is not null,
    'lang', t.lang,
    'joined_at', t.joined_at,
    'called_at', t.called_at,
    'done_at', t.done_at,
    'feedback', (select jsonb_build_object('positive', f.positive) from public.feedback f where f.ticket_id = t.id),
    'loyalty', case when t.customer_phone is not null and public.has_feature(t.branch_id, 'loyalty')
                    then public.loyalty_view(t.branch_id, t.customer_phone) end,
    'offers', case when t.status in ('waiting','called','serving','done') then public.active_offers(t.branch_id) else '[]'::jsonb end,
    'features', to_jsonb(public.branch_features(t.branch_id)),
    'branch', jsonb_build_object('public_id', b.public_id, 'name', b.name, 'business_name', bz.name,
                                 'phone', b.phone,
                                 'show_arabic_digits', (public.branch_settings(b.id) ->> 'show_arabic_digits')::boolean))
  from public.tickets t
  join public.services s on s.id = t.service_id
  join public.branches b on b.id = t.branch_id
  join public.businesses bz on bz.id = b.business_id
  left join public.providers p on p.id = t.provider_id
  where t.id = p_ticket
$$;

create or replace function public.with_effects(p_result jsonb, p_branch uuid, p_notify jsonb default '[]'::jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select p_result || jsonb_build_object(
    'notify', coalesce(p_notify, '[]'::jsonb),
    'broadcast', (select public_id from public.branches where id = p_branch))
$$;

-- ---------- customer actions ----------
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

create or replace function public.c_join_receipt(p_public_id text, p_service uuid, p_code text,
                                                 p_lang text, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.branches := public.branch_by_public_id(p_public_id);
  s public.services;
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  tid uuid;
  is_ready boolean;
begin
  if b.id is null then return public.err('branch_not_found'); end if;
  if not public.has_feature(b.id, 'queue') then return public.feature_locked('queue'); end if;
  select * into s from public.services where id = p_service and branch_id = b.id and is_active;
  if s.id is null or s.mode <> 'receipt' then return public.err('invalid_service'); end if;
  if char_length(code) < 1 or char_length(code) > 12 then return public.err('invalid_receipt_code'); end if;

  perform 1 from public.branches where id = b.id for update;
  select id into tid from public.tickets
   where branch_id = b.id and day = public.riyadh_today() and service_id = s.id and receipt_code = code;
  if tid is null then
    if p_fingerprint is not null and not public.hit_rate_limit('join:' || b.id || ':' || p_fingerprint, 3) then
      return public.err('rate_limited');
    end if;
    is_ready := exists (select 1 from public.ready_numbers
                        where branch_id = b.id and day = public.riyadh_today() and receipt_code = code);
    insert into public.tickets(branch_id, service_id, mode, day, number, receipt_code, source, status,
                               called_at, served_at, done_at, lang, fingerprint)
    values (b.id, s.id, 'receipt', public.riyadh_today(), public.next_ticket_number(b.id, public.riyadh_today()),
            code, 'receipt', case when is_ready then 'done' else 'waiting' end,
            case when is_ready then now() end, case when is_ready then now() end, case when is_ready then now() end,
            case when p_lang = 'en' then 'en' else 'ar' end, p_fingerprint)
    returning id into tid;
    update public.tickets set access_token_hash = public.sha256_hex(public.receipt_token(tid)) where id = tid;
  end if;

  return public.with_effects(jsonb_build_object('ticket_token', public.receipt_token(tid),
                                                'ticket', public.ticket_view(tid)), b.id);
end $$;

-- Common guard for actions on an existing ticket: lookup + 30 actions per ticket per hour.
create or replace function public.ticket_for_action(p_token text) returns public.tickets
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.ticket_by_token(p_token);
begin
  if t.id is null then return null; end if;
  if not public.hit_rate_limit('tact:' || t.id, 30) then
    t.id := null; t.status := 'rate_limited';
  end if;
  return t;
end $$;

create or replace function public.ticket_guard_error(t public.tickets) returns jsonb
language sql immutable as $$
  select case when t.status = 'rate_limited' then public.err('rate_limited') else public.err('ticket_not_found') end
$$;

create or replace function public.c_subscribe_push(p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.ticket_for_action(p_token);
begin
  if t.id is null then return public.ticket_guard_error(t); end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or coalesce(char_length(p_p256dh), 0) not between 20 and 200
     or coalesce(char_length(p_auth), 0) not between 8 and 100 then
    return public.err('invalid_subscription');
  end if;
  insert into public.push_subscriptions(ticket_id, endpoint, p256dh, auth)
  values (t.id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set ticket_id = excluded.ticket_id, owner_user_id = null,
    p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  update public.tickets set push_enabled = true where id = t.id;
  return jsonb_build_object('ok', true, 'push_enabled', true);
end $$;

create or replace function public.c_snooze(p_token text, p_steps int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.ticket_for_action(p_token);
begin
  if t.id is null then return public.ticket_guard_error(t); end if;
  if not public.has_feature(t.branch_id, 'late_button') then return public.feature_locked('late_button'); end if;
  if p_steps not in (1, 2) then return public.err('invalid_steps'); end if;
  if t.mode <> 'remote' or t.status <> 'waiting' then return public.err('not_waiting'); end if;
  if t.snooze_count >= public.setting_int(t.branch_id, 'snooze_max') then return public.err('snooze_limit'); end if;
  perform public.ticket_move_back(t.id, p_steps);
  update public.tickets set snooze_count = snooze_count + 1 where id = t.id;
  return public.with_effects(jsonb_build_object('ok', true, 'ticket', public.ticket_view(t.id)),
                             t.branch_id, public.collect_return_now(t.branch_id));
end $$;

create or replace function public.c_leave(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.ticket_for_action(p_token);
begin
  if t.id is null then return public.ticket_guard_error(t); end if;
  if t.status not in ('waiting','called') then return public.err('not_waiting'); end if;
  update public.tickets set status = 'left', left_at = now() where id = t.id;
  return public.with_effects(jsonb_build_object('ok', true, 'ticket', public.ticket_view(t.id)),
                             t.branch_id, public.collect_return_now(t.branch_id));
end $$;

create or replace function public.c_feedback(p_token text, p_positive boolean, p_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.ticket_for_action(p_token);
begin
  if t.id is null then return public.ticket_guard_error(t); end if;
  if not public.has_feature(t.branch_id, 'feedback') then return public.feature_locked('feedback'); end if;
  if t.status <> 'done' then return public.err('not_done'); end if;
  if p_positive is null then return public.err('invalid_input', '{"field":"positive"}'); end if;
  if p_reason is not null and p_reason not in ('long_wait','quality','treatment','price','other') then
    return public.err('invalid_input', '{"field":"reason"}');
  end if;
  if char_length(p_note) > 280 then return public.err('invalid_input', '{"field":"note"}'); end if;
  if exists (select 1 from public.feedback where ticket_id = t.id) then return public.err('feedback_exists'); end if;
  insert into public.feedback(ticket_id, branch_id, positive, reason, note)
  values (t.id, t.branch_id, p_positive, case when p_positive then null else p_reason end,
          case when p_positive then null else nullif(trim(p_note), '') end);
  return jsonb_build_object('ok', true,
    'google_review_url', case when p_positive then (select google_review_url from public.branches where id = t.branch_id) end);
end $$;

create or replace function public.c_set_phone(p_token text, p_phone text, p_consent boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tickets := public.ticket_for_action(p_token);
  phone text := regexp_replace(translate(coalesce(p_phone, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[^0-9]', '', 'g');
begin
  if t.id is null then return public.ticket_guard_error(t); end if;
  if not public.has_feature(t.branch_id, 'loyalty') then return public.feature_locked('loyalty'); end if;
  if p_consent is not true then return public.err('consent_required'); end if;
  if phone ~ '^9665[0-9]{8}$' then phone := '0' || substr(phone, 4); end if;
  if phone !~ '^05[0-9]{8}$' then return public.err('invalid_phone'); end if;
  update public.tickets set customer_phone = phone, phone_consent = true where id = t.id;
  perform public.apply_loyalty(t.id);
  return jsonb_build_object('ok', true, 'loyalty', public.loyalty_view(t.branch_id, phone));
end $$;

create or replace function public.c_redeem(p_token text, p_offer uuid, p_loyalty boolean, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.tickets := public.ticket_for_action(p_token);
  o public.offers;
  c public.loyalty_cards;
begin
  if t.id is null then return public.ticket_guard_error(t); end if;
  if p_code is null or p_code !~ '^[0-9]{4}$' or not public.rotating_code_valid(t.branch_id, p_code) then
    return public.err('invalid_code');
  end if;
  if coalesce(p_loyalty, false) then
    if not public.has_feature(t.branch_id, 'loyalty') then return public.feature_locked('loyalty'); end if;
    select * into c from public.loyalty_cards
     where branch_id = t.branch_id and phone = t.customer_phone for update;
    if c.id is null or c.visits - c.rewards_redeemed * c.goal < c.goal then return public.err('no_reward'); end if;
    update public.loyalty_cards set rewards_redeemed = rewards_redeemed + 1 where id = c.id;
    insert into public.redemptions(branch_id, loyalty_card_id, ticket_id) values (t.branch_id, c.id, t.id);
    return public.with_effects(jsonb_build_object('ok', true, 'redeemed', 'loyalty',
      'title', public.branch_settings(t.branch_id) ->> 'loyalty_reward_text',
      'loyalty', public.loyalty_view(t.branch_id, t.customer_phone)), t.branch_id);
  end if;

  select * into o from public.offers where id = p_offer and branch_id = t.branch_id;
  if o.id is null then return public.err('offer_not_found'); end if;
  if not public.has_feature(t.branch_id, case o.kind when 'quiet_coupon' then 'quiet_coupon' else 'timed_offers' end) then
    return public.feature_locked(case o.kind when 'quiet_coupon' then 'quiet_coupon' else 'timed_offers' end);
  end if;
  if not exists (select 1 from jsonb_array_elements(public.active_offers(t.branch_id)) e
                 where (e ->> 'id')::uuid = o.id) then
    return public.err('offer_inactive');
  end if;
  if exists (select 1 from public.redemptions where offer_id = o.id and ticket_id = t.id) then
    return public.err('already_redeemed');
  end if;
  insert into public.redemptions(branch_id, offer_id, ticket_id) values (t.branch_id, o.id, t.id);
  return public.with_effects(jsonb_build_object('ok', true, 'redeemed', 'offer', 'title', o.title), t.branch_id);
end $$;

create or replace function public.c_claim_dropoff(p_claim_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tickets;
  tok text := public.new_token();
begin
  if p_claim_token is null or char_length(p_claim_token) not between 20 and 100 then
    return public.err('ticket_not_found');
  end if;
  select * into t from public.tickets where claim_token_hash = public.sha256_hex(p_claim_token) for update;
  if t.id is null then return public.err('ticket_not_found'); end if;
  update public.tickets set access_token_hash = public.sha256_hex(tok), claim_token_hash = null where id = t.id;
  return jsonb_build_object('ticket_token', tok, 'ticket', public.ticket_view(t.id));
end $$;

-- ---------- staff ----------
create or replace function public.staff_auth(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  if p_token is null or char_length(p_token) not between 20 and 100 then return null; end if;
  select sd.*, br.public_id, br.name branch_name into d
  from public.staff_devices sd join public.branches br on br.id = sd.branch_id
  join public.businesses bz on bz.id = br.business_id
  where sd.token_hash = public.sha256_hex(p_token) and sd.revoked_at is null and br.is_active and bz.is_active;
  if d.id is null then return null; end if;
  update public.staff_devices set last_seen_at = now() where id = d.id
    and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
  return jsonb_build_object('device_id', d.id, 'branch_id', d.branch_id, 'public_id', d.public_id,
                            'branch_name', d.branch_name, 'label', d.label, 'language', d.language,
                            'provider_id', d.provider_id);
end $$;

create or replace function public.staff_ticket(p_device uuid, p_ticket uuid) returns public.tickets
language sql stable security definer set search_path = public as $$
  select t.* from public.tickets t join public.staff_devices d on d.branch_id = t.branch_id
  where d.id = p_device and t.id = p_ticket
$$;

create or replace function public.s_state(p_device uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select * from public.staff_devices where id = p_device),
  b as (select br.* from public.branches br join d on d.branch_id = br.id)
  select jsonb_build_object(
    'device', (select jsonb_build_object('id', d.id, 'label', d.label, 'language', d.language,
                                         'provider_id', d.provider_id) from d),
    'branch', (select jsonb_build_object('id', b.id, 'public_id', b.public_id, 'name', b.name,
                                         'busy_level', public.branch_busy_level(b.id),
                                         'manual_busy', (select manual_level from public.branch_status bs
                                                         where bs.branch_id = b.id
                                                           and bs.updated_at > now() - interval '30 minutes'),
                                         'open', (select is_open from public.branch_open_state(b.id)),
                                         'settings', public.branch_settings(b.id),
                                         'features', to_jsonb(public.branch_features(b.id))) from b),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'mode', s.mode,
                   'avg_minutes', s.avg_minutes,
                   'now_serving', (select max(t.number) from public.tickets t where t.service_id = s.id
                                   and t.day = public.riyadh_today() and t.status in ('called','serving')),
                   'waiting', (select count(*) from public.tickets t where t.service_id = s.id and t.status = 'waiting'))
                 order by s.sort, s.name), '[]'::jsonb)
                 from public.services s join b on s.branch_id = b.id where s.is_active),
    'providers', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name,
                   'service_ids', p.service_ids) order by p.display_name), '[]'::jsonb)
                  from public.providers p join b on p.branch_id = b.id where p.is_active),
    'tickets', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', t.id, 'number', t.number, 'mode', t.mode, 'status', t.status, 'stage', t.stage,
                   'service_id', t.service_id, 'provider_id', t.provider_id, 'party_size', t.party_size,
                   'priority', t.priority, 'priority_reason', t.priority_reason, 'push_enabled', t.push_enabled,
                   'source', t.source, 'receipt_code', t.receipt_code, 'item_label', t.item_label,
                   'push_back_count', t.push_back_count, 'joined_at', t.joined_at, 'called_at', t.called_at,
                   'called_by_me', t.called_by_device = p_device,
                   'position', case when t.status = 'waiting' and t.mode = 'remote' then public.ticket_position(t.id) end)
                 order by t.priority desc, t.sort_key, t.number), '[]'::jsonb)
                 from public.tickets t join b on t.branch_id = b.id
                 where t.status in ('waiting','called','serving')
                    or (t.mode = 'dropoff' and t.status <> 'done' and t.status <> 'cancelled')),
    'ready_numbers', (select coalesce(jsonb_agg(r.receipt_code order by r.ready_at desc), '[]'::jsonb)
                      from (select rn.* from public.ready_numbers rn join b on rn.branch_id = b.id
                            where rn.day = public.riyadh_today() order by rn.ready_at desc limit 12) r),
    'server_time', now())
$$;

create or replace function public.s_call(p_device uuid, p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.staff_devices;
begin
  select * into d from public.staff_devices where id = p_device;
  -- One-button flow: whatever this device called before is finished when it calls the next one.
  perform public.finish_ticket(t.id) from public.tickets t
   where t.branch_id = d.branch_id and t.called_by_device = d.id and t.mode = 'remote'
     and t.status in ('called','serving') and t.id <> p_ticket;
  update public.tickets
     set status = 'called', called_at = now(), called_by_device = d.id,
         provider_id = coalesce(provider_id, d.provider_id)
   where id = p_ticket;
  return public.with_effects(jsonb_build_object('ok', true, 'ticket', public.ticket_view(p_ticket)),
    d.branch_id,
    jsonb_build_array(jsonb_build_object('ticket_id', p_ticket, 'kind', 'called'))
      || public.collect_return_now(d.branch_id) || public.collect_busy_alert(d.branch_id));
end $$;

create or replace function public.s_call_next(p_device uuid, p_service uuid, p_provider uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.staff_devices;
  prov uuid;
  tid uuid;
begin
  select * into d from public.staff_devices where id = p_device;
  prov := coalesce(p_provider, d.provider_id);
  select t.id into tid from public.tickets t
   where t.branch_id = d.branch_id and t.status = 'waiting' and t.mode = 'remote'
     and (p_service is null or t.service_id = p_service)
     and (prov is null or t.provider_id is null or t.provider_id = prov)
   order by t.priority desc, t.sort_key, t.number
   limit 1 for update skip locked;
  if tid is null then
    perform public.finish_ticket(t.id) from public.tickets t
     where t.branch_id = d.branch_id and t.called_by_device = d.id and t.mode = 'remote'
       and t.status in ('called','serving');
    return public.with_effects(jsonb_build_object('ok', true, 'ticket', null, 'empty', true), d.branch_id);
  end if;
  if prov is not null then update public.tickets set provider_id = prov where id = tid; end if;
  return public.s_call(p_device, tid);
end $$;

create or replace function public.s_call_ticket(p_device uuid, p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.staff_ticket(p_device, p_ticket);
begin
  if t.id is null then return public.err('ticket_not_found'); end if;
  if t.status <> 'waiting' or t.mode <> 'remote' then return public.err('not_waiting'); end if;
  return public.s_call(p_device, t.id);
end $$;

create or replace function public.s_serve(p_device uuid, p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.staff_ticket(p_device, p_ticket);
begin
  if t.id is null then return public.err('ticket_not_found'); end if;
  if t.status not in ('called','waiting') then return public.err('invalid_state'); end if;
  update public.tickets set status = 'serving', served_at = now(), called_at = coalesce(called_at, now()),
         called_by_device = coalesce(called_by_device, p_device)
   where id = t.id;
  return public.with_effects(jsonb_build_object('ok', true), t.branch_id, public.collect_return_now(t.branch_id));
end $$;

create or replace function public.s_done(p_device uuid, p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.staff_ticket(p_device, p_ticket);
begin
  if t.id is null then return public.err('ticket_not_found'); end if;
  if t.status not in ('waiting','called','serving') then return public.err('invalid_state'); end if;
  perform public.finish_ticket(t.id);
  return public.with_effects(jsonb_build_object('ok', true), t.branch_id, public.collect_return_now(t.branch_id));
end $$;

create or replace function public.s_push_back(p_device uuid, p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.staff_ticket(p_device, p_ticket);
begin
  if t.id is null then return public.err('ticket_not_found'); end if;
  if t.status not in ('waiting','called') or t.mode <> 'remote' then return public.err('invalid_state'); end if;
  if t.push_back_count >= 1 then
    update public.tickets set status = 'no_show', left_at = now() where id = t.id;
  else
    perform public.ticket_move_back(t.id, public.setting_int(t.branch_id, 'no_show_push_back'));
    update public.tickets set push_back_count = push_back_count + 1 where id = t.id;
  end if;
  return public.with_effects(jsonb_build_object('ok', true,
    'status', (select status from public.tickets where id = t.id)), t.branch_id, public.collect_return_now(t.branch_id));
end $$;

create or replace function public.s_no_show(p_device uuid, p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.staff_ticket(p_device, p_ticket);
begin
  if t.id is null then return public.err('ticket_not_found'); end if;
  if t.status not in ('waiting','called') then return public.err('invalid_state'); end if;
  update public.tickets set status = 'no_show', left_at = now() where id = t.id;
  return public.with_effects(jsonb_build_object('ok', true), t.branch_id, public.collect_return_now(t.branch_id));
end $$;

create or replace function public.s_add_walk_in(p_device uuid, p_service uuid, p_party int, p_provider uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d public.staff_devices;
  s public.services;
  tid uuid;
begin
  select * into d from public.staff_devices where id = p_device;
  if not public.has_feature(d.branch_id, 'queue') then return public.feature_locked('queue'); end if;
  select * into s from public.services where id = p_service and branch_id = d.branch_id and is_active;
  if s.id is null or s.mode <> 'remote' then return public.err('invalid_service'); end if;
  if p_party is null or p_party < 1 or p_party > 6 then return public.err('invalid_party_size'); end if;
  if p_party > 1 and not public.has_feature(d.branch_id, 'family_ticket') then return public.feature_locked('family_ticket'); end if;
  if p_provider is not null and not exists (select 1 from public.providers
       where id = p_provider and branch_id = d.branch_id and is_active) then
    return public.err('invalid_provider');
  end if;
  perform 1 from public.branches where id = d.branch_id for update;
  insert into public.tickets(branch_id, service_id, provider_id, mode, day, number, party_size, source)
  values (d.branch_id, s.id, p_provider, 'remote', public.riyadh_today(),
          public.next_ticket_number(d.branch_id, public.riyadh_today()), p_party, 'walk_in')
  returning id into tid;
  return public.with_effects(jsonb_build_object('ok', true, 'ticket_id', tid,
    'number', (select number from public.tickets where id = tid),
    'position', public.ticket_position(tid), 'estimate_min', public.ticket_estimate(tid)),
    d.branch_id, public.collect_busy_alert(d.branch_id));
end $$;

create or replace function public.s_mark_ready(p_device uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.staff_devices;
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  notify jsonb := '[]'::jsonb;
  r record;
begin
  select * into d from public.staff_devices where id = p_device;
  if char_length(code) < 1 or char_length(code) > 12 then return public.err('invalid_receipt_code'); end if;
  insert into public.ready_numbers(branch_id, day, receipt_code) values (d.branch_id, public.riyadh_today(), code)
  on conflict (branch_id, day, receipt_code) do update set ready_at = now();
  for r in select id from public.tickets
           where branch_id = d.branch_id and day = public.riyadh_today() and mode = 'receipt'
             and receipt_code = code and status = 'waiting' for update
  loop
    perform public.finish_ticket(r.id);
    notify := notify || jsonb_build_object('ticket_id', r.id, 'kind', 'ready');
  end loop;
  return public.with_effects(jsonb_build_object('ok', true, 'receipt_code', code,
                             'customer_linked', jsonb_array_length(notify) > 0), d.branch_id, notify);
end $$;

create or replace function public.s_dropoff_create(p_device uuid, p_service uuid, p_item_label text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.staff_devices;
  s public.services;
  claim text := public.new_token();
  label text := trim(coalesce(p_item_label, ''));
  tid uuid;
begin
  select * into d from public.staff_devices where id = p_device;
  if not public.has_feature(d.branch_id, 'queue') then return public.feature_locked('queue'); end if;
  select * into s from public.services where id = p_service and branch_id = d.branch_id and is_active;
  if s.id is null or s.mode <> 'dropoff' then return public.err('invalid_service'); end if;
  if char_length(label) < 1 or char_length(label) > 60 then return public.err('invalid_input', '{"field":"item_label"}'); end if;
  perform 1 from public.branches where id = d.branch_id for update;
  insert into public.tickets(branch_id, service_id, mode, day, number, item_label, source, stage, claim_token_hash)
  values (d.branch_id, s.id, 'dropoff', public.riyadh_today(),
          public.next_ticket_number(d.branch_id, public.riyadh_today()), label, 'staff', 'received',
          public.sha256_hex(claim))
  returning id into tid;
  return public.with_effects(jsonb_build_object('ok', true, 'ticket_id', tid, 'claim_token', claim,
    'number', (select number from public.tickets where id = tid)), d.branch_id);
end $$;

create or replace function public.s_dropoff_stage(p_device uuid, p_ticket uuid, p_stage text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.staff_ticket(p_device, p_ticket);
begin
  if t.id is null or t.mode <> 'dropoff' then return public.err('ticket_not_found'); end if;
  if t.status in ('done','cancelled') then return public.err('invalid_state'); end if;
  if p_stage = 'in_progress' then
    update public.tickets set stage = 'in_progress', status = 'serving', served_at = coalesce(served_at, now()) where id = t.id;
  elsif p_stage = 'ready' then
    update public.tickets set stage = 'ready', status = 'called', called_at = now(),
           served_at = coalesce(served_at, now()) where id = t.id;
  elsif p_stage = 'picked_up' then
    perform public.finish_ticket(t.id);
  elsif p_stage = 'received' then
    update public.tickets set stage = 'received', status = 'waiting' where id = t.id;
  else
    return public.err('invalid_input', '{"field":"stage"}');
  end if;
  return public.with_effects(jsonb_build_object('ok', true, 'stage', p_stage), t.branch_id,
    case when p_stage in ('in_progress','ready')
         then jsonb_build_array(jsonb_build_object('ticket_id', t.id, 'kind', 'stage', 'stage', p_stage))
         else '[]'::jsonb end);
end $$;

create or replace function public.s_set_priority(p_device uuid, p_ticket uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.tickets := public.staff_ticket(p_device, p_ticket);
begin
  if t.id is null then return public.err('ticket_not_found'); end if;
  if not public.has_feature(t.branch_id, 'priority') then return public.feature_locked('priority'); end if;
  if p_reason not in ('elderly','pregnant','disability','other') then return public.err('invalid_input', '{"field":"reason"}'); end if;
  if t.status <> 'waiting' then return public.err('not_waiting'); end if;
  update public.tickets set priority = true, priority_reason = p_reason, priority_by_device = p_device where id = t.id;
  return public.with_effects(jsonb_build_object('ok', true), t.branch_id, public.collect_return_now(t.branch_id));
end $$;

create or replace function public.s_set_busy(p_device uuid, p_level text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.staff_devices;
begin
  select * into d from public.staff_devices where id = p_device;
  if p_level is not null and p_level not in ('free','some','busy') then return public.err('invalid_input', '{"field":"level"}'); end if;
  insert into public.branch_status(branch_id, manual_level, updated_at) values (d.branch_id, p_level, now())
  on conflict (branch_id) do update set manual_level = excluded.manual_level, updated_at = now();
  return public.with_effects(jsonb_build_object('ok', true, 'busy_level', public.branch_busy_level(d.branch_id)), d.branch_id);
end $$;

create or replace function public.s_rotating_code(p_device uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', public.rotating_code_at(b.redemption_secret, public.unix_minute()),
                            'expires_in', 60 - floor(extract(epoch from now()))::int % 60)
  from public.staff_devices d join public.branches b on b.id = d.branch_id where d.id = p_device
$$;

create or replace function public.s_redeem_check(p_device uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('redemptions', coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'redeemed_at', r.redeemed_at, 'ticket_number', t.number,
           'kind', case when r.loyalty_card_id is not null then 'loyalty' else 'offer' end,
           'title', coalesce(o.title, public.branch_settings(r.branch_id) ->> 'loyalty_reward_text'))
         order by r.redeemed_at desc), '[]'::jsonb))
  from (select r.* from public.redemptions r join public.staff_devices d on d.branch_id = r.branch_id
        where d.id = p_device and r.redeemed_at > now() - interval '12 hours'
        order by r.redeemed_at desc limit 10) r
  left join public.offers o on o.id = r.offer_id
  left join public.tickets t on t.id = r.ticket_id
$$;
