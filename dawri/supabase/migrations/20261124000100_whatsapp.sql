-- WhatsApp alerts, customer-initiated: the ticket page opens WhatsApp with a short code, the customer sends it to the
-- platform number, the webhook links that WhatsApp number to the ticket, and "return now" / "your turn" go out as
-- replies inside the 24-hour window the customer opened. No phone field anywhere in the app; the number is deleted
-- a day after the ticket ends. Keys live in whatsapp_config, entered by the platform admin, never sent to browsers.

create table public.whatsapp_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  display_number text check (display_number ~ '^[0-9]{8,15}$'),      -- 9665xxxxxxxx, for wa.me links
  phone_number_id text check (phone_number_id ~ '^[0-9]{5,30}$'),
  access_token text,
  app_secret text,
  verify_token text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  updated_at timestamptz not null default now()
);
insert into public.whatsapp_config(id) values (true) on conflict do nothing;

create table public.whatsapp_codes (
  code text primary key,
  ticket_id uuid not null unique references public.tickets(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.whatsapp_links (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  wa_id text not null check (wa_id ~ '^[0-9]{8,15}$'),
  linked_at timestamptz not null default now(),
  last_inbound_at timestamptz not null default now()
);
create index whatsapp_links_wa_idx on public.whatsapp_links(wa_id);

-- what was sent (no phone numbers): usage and cost in the admin dashboard
create table public.whatsapp_log (
  id bigserial primary key,
  branch_id uuid references public.branches(id) on delete set null,
  kind text not null,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create index whatsapp_log_time_idx on public.whatsapp_log(created_at);

alter table public.whatsapp_config enable row level security;
alter table public.whatsapp_codes enable row level security;
alter table public.whatsapp_links enable row level security;
alter table public.whatsapp_log enable row level security;
revoke all on public.whatsapp_config, public.whatsapp_codes, public.whatsapp_links, public.whatsapp_log from anon, authenticated;

create or replace function public.whatsapp_ready() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select enabled and display_number is not null and phone_number_id is not null
                          and access_token is not null and app_secret is not null from public.whatsapp_config), false)
$$;

-- forget numbers a day after their ticket ended (called from the WhatsApp paths, so it runs whenever they are used)
create or replace function public.whatsapp_forget() returns void
language sql security definer set search_path = public as $$
  delete from public.whatsapp_links l using public.tickets t
   where t.id = l.ticket_id and t.status not in ('waiting','called','serving') and t.updated_at < now() - interval '1 day';
  delete from public.whatsapp_links where last_inbound_at < now() - interval '2 days';
  delete from public.whatsapp_codes c using public.tickets t
   where t.id = c.ticket_id and t.status not in ('waiting','called','serving') and t.updated_at < now() - interval '1 day';
$$;

-- ---------- customer ----------
/** The code the ticket page puts in the WhatsApp message, and whether this ticket is already linked. */
create or replace function public.c_whatsapp_code(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.tickets := public.ticket_by_token(p_token);
  c text;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  i int;
begin
  if t.id is null then return public.err('ticket_not_found'); end if;
  if not public.whatsapp_ready() then return public.err('whatsapp_off'); end if;
  if t.status not in ('waiting','called','serving') then return public.err('not_waiting'); end if;
  select code into c from public.whatsapp_codes where ticket_id = t.id;
  while c is null loop
    c := 'J';
    for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    begin
      insert into public.whatsapp_codes(code, ticket_id) values (c, t.id);
    exception when unique_violation then
      select code into c from public.whatsapp_codes where ticket_id = t.id;   -- a parallel call won, or a code clash
    end;
  end loop;
  return jsonb_build_object('code', c, 'number', (select display_number from public.whatsapp_config),
                            'linked', exists (select 1 from public.whatsapp_links where ticket_id = t.id));
end $$;

-- ---------- webhook (service role) ----------
create or replace function public.wa_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ready', public.whatsapp_ready(), 'enabled', enabled, 'phone_number_id', phone_number_id,
                            'access_token', access_token, 'app_secret', app_secret, 'verify_token', verify_token,
                            'display_number', display_number)
    from public.whatsapp_config
$$;

/** A ticket's facts for a WhatsApp text. */
create or replace function public.wa_ticket_facts(p_ticket uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ticket_id', t.id, 'number', t.number, 'lang', t.lang, 'status', t.status,
    'shop', coalesce(nullif(bz.name, ''), br.name), 'public_id', br.public_id, 'branch_id', br.id,
    'position', case when t.status = 'waiting' and t.mode = 'remote' then public.ticket_position(t.id) end,
    'estimate_min', case when t.status = 'waiting' and t.mode = 'remote' then public.ticket_estimate(t.id) end)
  from public.tickets t join public.branches br on br.id = t.branch_id join public.businesses bz on bz.id = br.business_id
  where t.id = p_ticket
$$;

/**
 * An incoming WhatsApp message. With a valid code: link that number to the ticket. Without: refresh the 24-hour
 * window of the number's active tickets and return them (the reply says where the line is). "stop" unlinks.
 */
create or replace function public.wa_inbound(p_wa_id text, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m text[];
  tid uuid;
  active jsonb;
begin
  if p_wa_id !~ '^[0-9]{8,15}$' then return public.err('invalid_input'); end if;
  perform public.whatsapp_forget();
  if p_text ~* '^\s*(إيقاف|ايقاف|وقف|stop|unsubscribe)\s*$' then
    delete from public.whatsapp_links where wa_id = p_wa_id;
    return jsonb_build_object('kind', 'stopped');
  end if;
  m := regexp_match(upper(coalesce(p_text, '')), '\m(J[A-Z0-9]{6})\M');
  if m is not null then
    select c.ticket_id into tid from public.whatsapp_codes c join public.tickets t on t.id = c.ticket_id
     where c.code = m[1] and t.status in ('waiting','called','serving');
    if tid is null then return jsonb_build_object('kind', 'unknown_code'); end if;
    insert into public.whatsapp_links(ticket_id, wa_id) values (tid, p_wa_id)
      on conflict (ticket_id) do update set wa_id = excluded.wa_id, last_inbound_at = now();
    return jsonb_build_object('kind', 'linked', 'ticket', public.wa_ticket_facts(tid));
  end if;
  update public.whatsapp_links set last_inbound_at = now() where wa_id = p_wa_id;
  select coalesce(jsonb_agg(public.wa_ticket_facts(l.ticket_id)), '[]'::jsonb) into active
    from public.whatsapp_links l join public.tickets t on t.id = l.ticket_id
   where l.wa_id = p_wa_id and t.status in ('waiting','called','serving');
  return jsonb_build_object('kind', 'status', 'tickets', active);
end $$;

/** Who to message for these tickets: only numbers whose 24-hour window is still open. */
create or replace function public.wa_targets(p_tickets uuid[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.wa_ticket_facts(l.ticket_id) || jsonb_build_object('wa_id', l.wa_id)), '[]'::jsonb)
    from public.whatsapp_links l
   where l.ticket_id = any(p_tickets) and l.last_inbound_at > now() - interval '23 hours 50 minutes'
     and public.whatsapp_ready()
$$;

create or replace function public.wa_log(p_branch uuid, p_kind text, p_ok boolean, p_error text) returns void
language sql security definer set search_path = public as $$
  insert into public.whatsapp_log(branch_id, kind, ok, error) values (p_branch, left(p_kind, 30), p_ok, left(p_error, 300));
$$;

-- ---------- platform admin ----------
create or replace function public.a_whatsapp(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.whatsapp_config;
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  select * into w from public.whatsapp_config;
  return jsonb_build_object(
    'enabled', w.enabled, 'ready', public.whatsapp_ready(), 'display_number', w.display_number,
    'phone_number_id', w.phone_number_id, 'has_token', w.access_token is not null, 'has_secret', w.app_secret is not null,
    'verify_token', w.verify_token,
    'month', (select jsonb_build_object('sent', count(*) filter (where ok), 'failed', count(*) filter (where not ok),
                                        'linked', count(*) filter (where kind = 'linked' and ok))
                from public.whatsapp_log where created_at >= date_trunc('month', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'),
    'active_links', (select count(*) from public.whatsapp_links));
end $$;

/** Save settings. Empty token/secret fields keep what is stored, so the admin never has to see them again. */
create or replace function public.a_whatsapp_save(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare num text := regexp_replace(coalesce(p->>'display_number', ''), '\D', '', 'g');
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  if num ~ '^05[0-9]{8}$' then num := '966' || substr(num, 2); end if;
  if num <> '' and num !~ '^[0-9]{8,15}$' then return public.err('invalid_input', jsonb_build_object('field', 'display_number')); end if;
  if coalesce(p->>'phone_number_id', '') <> '' and p->>'phone_number_id' !~ '^[0-9]{5,30}$' then
    return public.err('invalid_input', jsonb_build_object('field', 'phone_number_id'));
  end if;
  update public.whatsapp_config set
    display_number = nullif(num, ''),
    phone_number_id = nullif(p->>'phone_number_id', ''),
    access_token = coalesce(nullif(btrim(p->>'access_token'), ''), access_token),
    app_secret = coalesce(nullif(btrim(p->>'app_secret'), ''), app_secret),
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    updated_at = now();
  return public.a_whatsapp(p_user);
end $$;

revoke execute on function public.whatsapp_ready(), public.whatsapp_forget(), public.c_whatsapp_code(text), public.wa_config(),
  public.wa_ticket_facts(uuid), public.wa_inbound(text, text), public.wa_targets(uuid[]), public.wa_log(uuid, text, boolean, text),
  public.a_whatsapp(uuid), public.a_whatsapp_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.whatsapp_ready(), public.whatsapp_forget(), public.c_whatsapp_code(text), public.wa_config(),
  public.wa_ticket_facts(uuid), public.wa_inbound(text, text), public.wa_targets(uuid[]), public.wa_log(uuid, text, boolean, text),
  public.a_whatsapp(uuid), public.a_whatsapp_save(uuid, jsonb) to service_role;
