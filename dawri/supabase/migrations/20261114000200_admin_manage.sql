-- Admin client management: add a shop with its owner account, edit it, delete it, and set the subscription
-- by type (trial / active / inactive) + start date + duration (the end date is computed here, not typed).

alter table public.businesses add column if not exists plan_started_at timestamptz;
alter table public.businesses add column if not exists admin_note text check (char_length(admin_note) <= 500);

/** Status the admin sees: trial (temporary), active (paid), inactive (stopped or expired). */
create or replace function public.business_status(b public.businesses) returns text
language sql stable as $$
  select case
    when not b.is_active then 'inactive'
    when b.trial_until is not null and b.trial_until > now() then 'trial'
    when b.plan_until is null or b.plan_until > now() then 'active'
    else 'inactive' end
$$;

/** End date from a start and a duration: unit day | month | year. */
create or replace function public.subscription_end(p_start timestamptz, p_n int, p_unit text) returns timestamptz
language sql immutable as $$
  select p_start + case p_unit when 'day' then make_interval(days => p_n) when 'year' then make_interval(years => p_n)
                                else make_interval(months => p_n) end
$$;

create or replace function public.a_businesses(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  return jsonb_build_object('businesses', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'name', b.name, 'slug', b.slug, 'category', b.category, 'plan', b.plan,
    'effective_plan', public.business_effective_plan(b.id), 'status', public.business_status(b),
    'plan_started_at', b.plan_started_at, 'plan_until', b.plan_until, 'trial_until', b.trial_until,
    'is_active', b.is_active, 'is_demo', b.is_demo, 'created_at', b.created_at, 'admin_note', b.admin_note,
    'owner_email', (select email from auth.users u where u.id = b.owner_user_id),
    'phone', (select br.phone from public.branches br where br.business_id = b.id order by br.created_at limit 1),
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

/**
 * Edit a shop. Subscription by type: {status: trial|active|inactive, start: date, duration: n, unit: day|month|year}.
 * Also: name, category, plan, admin_note, phone (first branch). Old keys plan_until / trial_until / is_active still work.
 */
create or replace function public.a_update_business(p_user uuid, p_business uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st text := p ->> 'status';
  start_at timestamptz;
  n int;
  unit text := coalesce(p ->> 'unit', 'month');
  end_at timestamptz;
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  if not exists (select 1 from public.businesses where id = p_business) then return public.err('not_found'); end if;
  if p ? 'plan' and (p ->> 'plan') not in ('basic','growth','full','seasonal') then return public.err('invalid_input', '{"field":"plan"}'); end if;
  if p ? 'name' and char_length(trim(p ->> 'name')) not between 2 and 80 then return public.err('invalid_input', '{"field":"name"}'); end if;
  if p ? 'category' and (p ->> 'category') not in ('cafe','restaurant','bakery','barber','salon','clinic','lab','carwash','phone_repair','other') then
    return public.err('invalid_input', '{"field":"category"}');
  end if;

  update public.businesses set
    name = coalesce(nullif(trim(p ->> 'name'), ''), name),
    category = coalesce(p ->> 'category', category),
    plan = coalesce(p ->> 'plan', plan),
    admin_note = case when p ? 'admin_note' then nullif(left(trim(p ->> 'admin_note'), 500), '') else admin_note end,
    plan_until = case when p ? 'plan_until' then (p ->> 'plan_until')::timestamptz else plan_until end,
    trial_until = case when p ? 'trial_until' then (p ->> 'trial_until')::timestamptz else trial_until end,
    is_active = coalesce((p ->> 'is_active')::boolean, is_active)
  where id = p_business;

  if p ? 'phone' then
    update public.branches set phone = nullif(left(regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9+]', '', 'g'), 20), '')
    where id = (select id from public.branches where business_id = p_business order by created_at limit 1);
  end if;

  if st is not null then
    if st not in ('trial','active','inactive') then return public.err('invalid_input', '{"field":"status"}'); end if;
    if st = 'inactive' then
      update public.businesses set is_active = false where id = p_business;
    else
      start_at := coalesce((p ->> 'start')::date::timestamptz, now());
      n := coalesce((p ->> 'duration')::int, case when st = 'trial' then 14 else 1 end);
      if unit not in ('day','month','year') then return public.err('invalid_input', '{"field":"unit"}'); end if;
      if n < 1 or (unit = 'day' and n > 3650) or (unit = 'month' and n > 120) or (unit = 'year' and n > 10) then
        return public.err('invalid_input', '{"field":"duration"}');
      end if;
      -- the subscription ends at the end of its last day, Riyadh time
      end_at := (public.subscription_end(start_at, n, unit)::date + time '23:59:59') at time zone 'Asia/Riyadh';
      if st = 'trial' then
        update public.businesses set is_active = true, plan_started_at = start_at, trial_until = end_at, plan_until = null where id = p_business;
      else
        update public.businesses set is_active = true, plan_started_at = start_at, plan_until = end_at, trial_until = null where id = p_business;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'business', (
    select jsonb_build_object('status', public.business_status(b), 'plan_started_at', b.plan_started_at,
                              'plan_until', b.plan_until, 'trial_until', b.trial_until, 'is_active', b.is_active)
    from public.businesses b where b.id = p_business));
exception when invalid_datetime_format or invalid_text_representation or datetime_field_overflow then
  return public.err('invalid_input', '{"field":"date"}');
end $$;

/**
 * Add a shop for an owner: an existing account by e-mail, or a new one with the temporary password the admin gives.
 * p: {business_name, category, owner_email, owner_password?, phone?, district?, services?: [{name}], plan, status, start, duration, unit, admin_note?}
 */
create or replace function public.a_create_business(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(p ->> 'owner_email', '')));
  pass text := coalesce(p ->> 'owner_password', '');
  owner uuid;
  created_owner boolean := false;
  r jsonb;
  u jsonb;
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 200 then return public.err('invalid_input', '{"field":"owner_email"}'); end if;
  select id into owner from auth.users where lower(auth.users.email) = v_email;
  if owner is null then
    if char_length(pass) < 8 then return public.err('invalid_input', '{"field":"owner_password"}'); end if;
    owner := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
                            email_change_token_new, email_change, created_at, updated_at)
    values (owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email,
            extensions.crypt(pass, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', now(), now());
    insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), owner::text, owner, jsonb_build_object('sub', owner::text, 'email', v_email), 'email', now(), now(), now());
    created_owner := true;
  end if;

  r := public.onboard(owner, jsonb_build_object(
    'business_name', p ->> 'business_name', 'category', coalesce(p ->> 'category', 'other'),
    'phone', p ->> 'phone', 'district', p ->> 'district', 'staff_language', coalesce(p ->> 'staff_language', 'ar'),
    'hours', coalesce(p -> 'hours', (select jsonb_object_agg(d, '[["09:00","23:00"]]'::jsonb)
                                     from unnest(array['sun','mon','tue','wed','thu','fri','sat']) d)),
    'services', case when jsonb_typeof(p -> 'services') = 'array' and jsonb_array_length(p -> 'services') > 0
                     then p -> 'services' else '[{"name":"الخدمة الأساسية"}]'::jsonb end));
  if r ? 'error' then
    if created_owner then delete from auth.users where id = owner; end if;
    return r;
  end if;

  u := public.a_update_business(p_user, (r ->> 'business_id')::uuid, jsonb_strip_nulls(jsonb_build_object(
    'plan', coalesce(p ->> 'plan', 'basic'), 'status', coalesce(p ->> 'status', 'trial'),
    'start', p ->> 'start', 'duration', p -> 'duration', 'unit', p ->> 'unit', 'admin_note', p ->> 'admin_note')));
  if u ? 'error' then raise exception 'subscription: %', u ->> 'error' using errcode = '22023'; end if;

  return r || jsonb_build_object('owner_created', created_owner, 'owner_email', v_email, 'subscription', u -> 'business');
exception when invalid_parameter_value then
  return public.err('invalid_input', '{"field":"subscription"}');
end $$;

/** Delete a shop with all its branches, queue history and settings. Optionally its owner, if they own nothing else. */
create or replace function public.a_delete_business(p_user uuid, p_business uuid, p_delete_owner boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
  owner_deleted boolean := false;
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  delete from public.businesses where id = p_business returning owner_user_id into owner;
  if not found then return public.err('not_found'); end if;
  if p_delete_owner and owner is not null and owner <> p_user
     and not exists (select 1 from public.businesses where owner_user_id = owner)
     and not exists (select 1 from public.admins where user_id = owner) then
    delete from auth.users where id = owner;
    owner_deleted := true;
  end if;
  return jsonb_build_object('ok', true, 'owner_deleted', owner_deleted);
end $$;

revoke execute on function public.a_businesses(uuid), public.a_update_business(uuid, uuid, jsonb), public.a_create_business(uuid, jsonb),
  public.a_delete_business(uuid, uuid, boolean), public.business_status(public.businesses), public.subscription_end(timestamptz, int, text)
  from public, anon, authenticated;
grant execute on function public.a_businesses(uuid), public.a_update_business(uuid, uuid, jsonb), public.a_create_business(uuid, jsonb),
  public.a_delete_business(uuid, uuid, boolean), public.business_status(public.businesses), public.subscription_end(timestamptz, int, text)
  to service_role;
