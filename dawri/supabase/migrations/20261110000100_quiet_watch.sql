-- «نبّهني لما تهدأ»: a visitor of the shop page asks to be pushed once the queue drops to a threshold.
-- No ticket and no phone number: only the browser's push subscription, kept for 4 hours at most.
-- Every queue action already returns its effects through with_effects(), so that is the single hook
-- that checks the watches of the branch and hands due ones to the Edge Function as "notify" entries.

create table public.quiet_watches (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  threshold int not null check (threshold between 0 and 10),
  lang text not null default 'ar' check (lang in ('ar', 'en')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '4 hours'
);
create index quiet_watches_branch on public.quiet_watches(branch_id, expires_at);
alter table public.quiet_watches enable row level security;
-- no policies: only the security-definer functions below touch it

/** Removes and returns the watches of a branch that are due now, as push "notify" entries. */
create or replace function public.quiet_due(p_branch uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  w int;
  b public.branches;
  out jsonb;
begin
  delete from public.quiet_watches where branch_id = p_branch and expires_at <= now();
  if not exists (select 1 from public.quiet_watches where branch_id = p_branch) then return '[]'::jsonb; end if;
  if not (select is_open from public.branch_open_state(p_branch)) then return '[]'::jsonb; end if;
  w := public.branch_waiting_count(p_branch);
  select * into b from public.branches where id = p_branch;
  with due as (
    delete from public.quiet_watches where branch_id = p_branch and threshold >= w
    returning endpoint, p256dh, auth, lang)
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'quiet', 'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth,
           'lang', lang, 'count', w, 'shop', b.name, 'public_id', b.public_id)), '[]'::jsonb)
    into out from due;
  return out;
end $$;

-- Same contract as before; now also appends the branch's due quiet watches to "notify".
create or replace function public.with_effects(p_result jsonb, p_branch uuid, p_notify jsonb default '[]'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  return p_result || jsonb_build_object(
    'notify', coalesce(p_notify, '[]'::jsonb) || public.quiet_due(p_branch),
    'broadcast', (select public_id from public.branches where id = p_branch));
end $$;

create or replace function public.c_quiet_watch(p_public_id text, p_endpoint text, p_p256dh text, p_auth text,
                                                p_threshold int, p_lang text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  b public.branches := public.branch_by_public_id(p_public_id);
  w int;
  exp timestamptz := now() + interval '4 hours';
begin
  if b.id is null then return public.err('branch_not_found'); end if;
  if not public.has_feature(b.id, 'fadeet') then return public.feature_locked('fadeet'); end if;
  if p_threshold is null or p_threshold not between 0 and 10 then return public.err('invalid_input', '{"field":"threshold"}'); end if;
  if not (select is_open from public.branch_open_state(b.id)) then return public.err('closed'); end if;
  w := public.branch_waiting_count(b.id);
  if w <= p_threshold then
    return jsonb_build_object('ok', true, 'already_quiet', true, 'waiting', w);
  end if;
  delete from public.quiet_watches where expires_at <= now();
  if (select count(*) from public.quiet_watches where branch_id = b.id) >= 300 then return public.err('rate_limited'); end if;
  insert into public.quiet_watches(branch_id, endpoint, p256dh, auth, threshold, lang, expires_at)
  values (b.id, p_endpoint, p_p256dh, p_auth, p_threshold, case when p_lang = 'en' then 'en' else 'ar' end, exp)
  on conflict (endpoint) do update set branch_id = excluded.branch_id, p256dh = excluded.p256dh, auth = excluded.auth,
    threshold = excluded.threshold, lang = excluded.lang, created_at = now(), expires_at = excluded.expires_at;
  return jsonb_build_object('ok', true, 'already_quiet', false, 'waiting', w, 'threshold', p_threshold, 'expires_at', exp);
end $$;

create or replace function public.c_quiet_unwatch(p_endpoint text) returns jsonb
language sql volatile security definer set search_path = public as $$
  with d as (delete from public.quiet_watches where endpoint = p_endpoint returning 1)
  select jsonb_build_object('ok', true, 'removed', (select count(*) from d) > 0)
$$;

revoke all on public.quiet_watches from anon, authenticated;
grant all on public.quiet_watches to service_role;
revoke execute on function public.quiet_due(uuid), public.with_effects(jsonb, uuid, jsonb),
  public.c_quiet_watch(text, text, text, text, int, text), public.c_quiet_unwatch(text) from public, anon, authenticated;
grant execute on function public.quiet_due(uuid), public.with_effects(jsonb, uuid, jsonb),
  public.c_quiet_watch(text, text, text, text, int, text), public.c_quiet_unwatch(text) to service_role;
