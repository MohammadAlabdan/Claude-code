-- Dawri core schema: businesses, branches, queue, offers, loyalty, pages.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  category text not null default 'other'
    check (category in ('cafe','restaurant','bakery','barber','salon','clinic','lab','carwash','phone_repair','other')),
  plan text not null default 'basic' check (plan in ('basic','growth','full','seasonal')),
  plan_until timestamptz,
  trial_until timestamptz,
  owner_user_id uuid references auth.users(id) on delete set null,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_owner_idx on public.businesses(owner_user_id);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  public_id text not null unique default lower(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8))
    check (public_id ~ '^[a-z0-9]{6,16}$'),
  address text check (char_length(address) <= 200),
  map_url text check (char_length(map_url) <= 500),
  phone text check (char_length(phone) <= 20),
  google_review_url text check (char_length(google_review_url) <= 500),
  timezone text not null default 'Asia/Riyadh',
  -- {"sun":[["16:00","23:30"]], "mon":[...], ...}; an interval whose close <= open runs past midnight
  hours jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  redemption_secret text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index branches_business_idx on public.branches(business_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  mode text not null check (mode in ('receipt','remote','dropoff')),
  avg_minutes int not null default 15 check (avg_minutes between 1 and 600),
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index services_branch_idx on public.services(branch_id);

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  service_ids uuid[],            -- null = can serve every service of the branch
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index providers_branch_idx on public.providers(branch_id);

create table public.staff_devices (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 40),
  language text not null default 'ar' check (language in ('ar','en','ur','bn','fil')),
  provider_id uuid references public.providers(id) on delete set null,
  token_hash text not null unique,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_devices_branch_idx on public.staff_devices(branch_id);

create table public.ticket_counters (
  branch_id uuid not null references public.branches(id) on delete cascade,
  day date not null,
  last_number int not null default 0,
  primary key (branch_id, day)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  mode text not null check (mode in ('receipt','remote','dropoff')),
  day date not null,
  number int not null,
  receipt_code text check (char_length(receipt_code) between 1 and 12),
  item_label text check (char_length(item_label) between 1 and 60),
  party_size int not null default 1 check (party_size between 1 and 6),
  source text not null check (source in ('remote','walk_in','staff','receipt')),
  status text not null default 'waiting'
    check (status in ('waiting','called','serving','done','no_show','cancelled','left')),
  stage text check (stage in ('received','in_progress','ready','picked_up')),
  priority boolean not null default false,
  priority_reason text check (priority_reason in ('elderly','pregnant','disability','other')),
  priority_by_device uuid references public.staff_devices(id) on delete set null,
  snooze_count int not null default 0,
  push_back_count int not null default 0,
  push_enabled boolean not null default false,
  return_now_sent boolean not null default false,
  loyalty_counted boolean not null default false,
  sort_key timestamptz not null default now(),
  access_token_hash text unique,
  claim_token_hash text unique,
  customer_phone text check (customer_phone ~ '^05[0-9]{8}$'),
  phone_consent boolean not null default false,
  lang text not null default 'ar' check (lang in ('ar','en')),
  fingerprint text,
  called_by_device uuid references public.staff_devices(id) on delete set null,
  joined_at timestamptz not null default now(),
  called_at timestamptz,
  served_at timestamptz,
  done_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, day, number)
);
create index tickets_queue_idx on public.tickets(service_id, status, priority desc, sort_key);
create index tickets_branch_day_idx on public.tickets(branch_id, day);
create index tickets_branch_joined_idx on public.tickets(branch_id, joined_at);
create unique index tickets_receipt_uq on public.tickets(branch_id, day, service_id, receipt_code)
  where receipt_code is not null;
create index tickets_phone_idx on public.tickets(customer_phone) where customer_phone is not null;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now(),
  check ((ticket_id is null) <> (owner_user_id is null))
);
create index push_subscriptions_ticket_idx on public.push_subscriptions(ticket_id);
create index push_subscriptions_owner_idx on public.push_subscriptions(owner_user_id);

create table public.branch_status (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  manual_level text check (manual_level in ('free','some','busy')),
  busy_alert_armed boolean not null default true,
  last_busy_alert_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.ready_numbers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  day date not null,
  receipt_code text not null check (char_length(receipt_code) between 1 and 12),
  ready_at timestamptz not null default now(),
  unique (branch_id, day, receipt_code)
);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  kind text not null default 'timed' check (kind in ('timed','quiet_coupon')),
  title text not null check (char_length(title) between 2 and 80),
  terms text check (char_length(terms) <= 300),
  discount_text text check (char_length(discount_text) <= 40),
  weekdays int[] not null default '{0,1,2,3,4,5,6}',   -- 0 = Sunday … 6 = Saturday
  start_time time,
  end_time time,
  valid_from date,
  valid_to date,
  max_redemptions int check (max_redemptions > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index offers_branch_idx on public.offers(branch_id);

create table public.loyalty_cards (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  phone text not null check (phone ~ '^05[0-9]{8}$'),
  visits int not null default 0,
  goal int not null default 6 check (goal between 2 and 50),
  rewards_redeemed int not null default 0,
  last_visit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, phone)
);

create table public.redemptions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete set null,
  loyalty_card_id uuid references public.loyalty_cards(id) on delete set null,
  ticket_id uuid references public.tickets(id) on delete set null,
  device_id uuid references public.staff_devices(id) on delete set null,
  redeemed_at timestamptz not null default now()
);
create index redemptions_branch_idx on public.redemptions(branch_id, redeemed_at desc);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null unique references public.tickets(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  positive boolean not null,
  reason text check (reason in ('long_wait','quality','treatment','price','other')),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now()
);
create index feedback_branch_idx on public.feedback(branch_id, created_at desc);

create table public.business_pages (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  bio text check (char_length(bio) <= 600),
  photos text[] not null default '{}',
  highlights text[] not null default '{}',
  is_published boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  category text check (char_length(category) <= 40),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 200),
  price_sar numeric(8,2) check (price_sar >= 0),
  duration_min int check (duration_min between 1 and 600),
  is_available boolean not null default true,
  sort int not null default 0,
  service_id uuid references public.services(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_items_branch_idx on public.menu_items(branch_id);

create table public.news_posts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  body text check (char_length(body) <= 1000),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index news_posts_branch_idx on public.news_posts(branch_id, published_at desc);

create table public.daily_summaries (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  day date not null,
  text text not null,
  stats jsonb not null,
  created_at timestamptz not null default now(),
  unique (branch_id, day)
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  feature text not null,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_business_idx on public.ai_usage(business_id, created_at desc);

create table public.rate_limits (
  key text not null,
  bucket timestamptz not null,
  hits int not null default 0,
  primary key (key, bucket)
);

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['businesses','branches','services','providers','staff_devices','tickets',
                           'offers','loyalty_cards','menu_items']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;
create trigger business_pages_touch before update on public.business_pages
  for each row execute function public.touch_updated_at();
