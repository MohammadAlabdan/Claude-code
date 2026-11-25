-- Sales documents: a product catalog, quotes with a public accept page, a versioned subscription agreement accepted
-- after signup, and invoices with sequential numbers that cannot be edited once issued (void instead).
-- Every label, price and term lives in a table the platform admin edits from the dashboard.

-- ---------- settings (one row) ----------
create table public.billing_settings (
  id boolean primary key default true check (id),
  seller_name text not null default 'جاي',
  seller_legal_name text,
  seller_id_label text not null default 'رقم وثيقة العمل الحر',
  seller_id text,
  vat_registered boolean not null default false,
  vat_number text check (vat_number is null or vat_number ~ '^3[0-9]{13}3$'),
  vat_rate numeric(5,2) not null default 15 check (vat_rate between 0 and 50),
  bank_name text,
  account_holder text,
  iban text check (iban is null or iban ~ '^SA[0-9]{22}$'),
  phone text,
  email text,
  city text default 'الرياض',
  address text,
  quote_valid_days int not null default 7 check (quote_valid_days between 1 and 90),
  quote_prefix text not null default 'Q' check (quote_prefix ~ '^[A-Z]{1,6}$'),
  invoice_prefix text not null default 'JAY' check (invoice_prefix ~ '^[A-Z]{1,6}$'),
  annual_free_months int not null default 2 check (annual_free_months between 0 and 6),
  trial_days int not null default 14 check (trial_days between 0 and 90),
  payment_terms text not null default 'الدفع بالتحويل البنكي خلال ٣ أيام من قبول العرض، ويبدأ الاشتراك من تاريخ الدفع.',
  invoice_note text not null default 'شكراً لثقتك في «جاي». دورك جاي.. وأنت مرتاح.',
  updated_at timestamptz not null default now()
);
insert into public.billing_settings(id) values (true) on conflict do nothing;

-- ---------- catalog ----------
create table public.billing_products (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  kind text not null check (kind in ('plan','addon')),
  name text not null check (char_length(name) between 2 and 60),
  tagline text check (char_length(tagline) <= 120),
  price numeric(10,2) not null check (price between 0 and 100000),
  unit text not null check (unit in ('month','once')),
  highlights jsonb not null default '[]'::jsonb check (jsonb_typeof(highlights) = 'array'),
  is_featured boolean not null default false,
  is_active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.billing_products(code, kind, name, tagline, price, unit, highlights, is_featured, sort) values
  ('basic', 'plan', 'الأساسية', 'لمحل يبي ينهي فوضى الطابور', 199, 'month',
   '["صفحة المحل الحيّة و«نبّهني لما تهدأ»","لوحة الكراسي واختيار الموظف","«كم تبعد؟» و«وصلت» وتنبيه الواتساب","شاشة الموظف بخمس لغات","ملخص المساء وحاسبة الزبائن الضائعين"]', false, 1),
  ('growth', 'plan', 'النمو', 'لمحل يبي يكسب من وقت الانتظار', 399, 'month',
   '["كل ما في الأساسية","«وأنت تنتظر» والمفاجأة المختومة","تحدّيات الزيارات والمكافآت","«أبيها» لإضافة خدمات","العروض حسب الوقت ونقاط الولاء"]', true, 2),
  ('full', 'plan', 'المتكاملة', 'لمحل يبي مساعد ذكي يفكّر معه', 699, 'month',
   '["كل ما في النمو","تحدّيات ذكية لأوقات الهدوء","مساعد يجاوب أسئلة الزبائن","تقرير الذروة والغايبون","صفحة المحل الكاملة"]', false, 3),
  ('seasonal', 'plan', 'المواسم', 'لرمضان والأعياد وأيام الذروة فقط', 199, 'month',
   '["مزايا الأساسية للفترة اللي تحتاجها","تشغيل وإيقاف حسب الموسم"]', false, 4),
  ('setup', 'addon', 'التركيب والتدريب', 'زيارة، وملصقات مطبوعة، وتدريب الموظفين', 399, 'once', '[]', false, 10),
  ('stickers', 'addon', 'ملصقات QR إضافية', 'طقم ملصق باب وبطاقة مرآة وستيكر زجاج', 79, 'once', '[]', false, 11)
on conflict (code) do nothing;

-- MRR and plan prices now come from the catalog
create or replace function public.plan_price_sar(p_plan text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select round(price)::int from public.billing_products where code = p_plan and kind = 'plan'), 0)
$$;

-- ---------- document numbers: PREFIX-YYYY-0001, per kind and year ----------
create table public.billing_counters (kind text, year int, last int not null default 0, primary key (kind, year));
create or replace function public.next_doc_number(p_kind text, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare y int := extract(year from now() at time zone 'Asia/Riyadh'); n int;
begin
  insert into public.billing_counters(kind, year, last) values (p_kind, y, 1)
    on conflict (kind, year) do update set last = public.billing_counters.last + 1
    returning last into n;
  return p_prefix || '-' || y || '-' || lpad(n::text, 4, '0');
end $$;

-- ---------- totals: the same arithmetic as web/js/billing/doc.js ----------
/** items: [{title, qty, unit_price}] → cleaned items and totals; VAT only when the seller is VAT-registered. */
create or replace function public.billing_compute(p_items jsonb, p_discount_pct numeric) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  st public.billing_settings;
  items jsonb := '[]'::jsonb;
  it jsonb;
  sub numeric := 0;
  disc numeric;
  vat numeric := 0;
  q numeric; p numeric; t text;
begin
  select * into st from public.billing_settings;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid_items';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    t := btrim(coalesce(it->>'title', ''));
    q := coalesce((it->>'qty')::numeric, 1);
    p := coalesce((it->>'unit_price')::numeric, 0);
    if char_length(t) not between 2 and 140 or q <= 0 or q > 1000 or p < 0 or p > 100000 then raise exception 'invalid_items'; end if;
    items := items || jsonb_build_object('title', t, 'note', left(nullif(btrim(coalesce(it->>'note', '')), ''), 160),
      'code', nullif(it->>'code', ''), 'qty', q, 'unit_price', round(p, 2), 'amount', round(q * p, 2));
    sub := sub + round(q * p, 2);
  end loop;
  disc := round(sub * least(greatest(coalesce(p_discount_pct, 0), 0), 100) / 100, 2);
  if st.vat_registered then vat := round((sub - disc) * st.vat_rate / 100, 2); end if;
  return jsonb_build_object('items', items, 'subtotal', sub, 'discount_pct', coalesce(p_discount_pct, 0), 'discount', disc,
    'vat_rate', case when st.vat_registered then st.vat_rate else 0 end, 'vat', vat, 'total', sub - disc + vat);
end $$;

create or replace function public.billing_seller() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', seller_name, 'legal_name', seller_legal_name, 'id_label', seller_id_label, 'id', seller_id,
    'vat_registered', vat_registered, 'vat_number', vat_number, 'bank_name', bank_name, 'account_holder', account_holder,
    'iban', iban, 'phone', phone, 'email', email, 'city', city, 'address', address,
    'payment_terms', payment_terms, 'invoice_note', invoice_note)
  from public.billing_settings
$$;

-- ---------- quotes ----------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  status text not null default 'draft' check (status in ('draft','sent','viewed','accepted','cancelled')),
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  contact_name text check (char_length(contact_name) <= 80),
  phone text check (char_length(phone) <= 20),
  email text check (char_length(email) <= 120),
  category text,
  plan text references public.billing_products(code) on update cascade,
  cycle text not null default 'month' check (cycle in ('month','year')),
  months int not null default 1 check (months between 1 and 36),
  items jsonb not null,
  subtotal numeric(12,2) not null,
  discount_pct numeric(5,2) not null default 0,
  discount numeric(12,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  vat numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  notes text check (char_length(notes) <= 600),
  valid_until date not null,
  viewed_at timestamptz,
  accepted_at timestamptz,
  accepted_name text,
  business_id uuid references public.businesses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.quote_view(q public.quotes) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(q) - 'token' || jsonb_build_object(
    'token', q.token,
    'state', case when q.status in ('accepted','cancelled') then q.status
                  when q.valid_until < (now() at time zone 'Asia/Riyadh')::date then 'expired' else q.status end,
    'plan_info', (select jsonb_build_object('code', p.code, 'name', p.name, 'tagline', p.tagline, 'price', p.price, 'highlights', p.highlights)
                  from public.billing_products p where p.code = q.plan),
    'business_name', (select name from public.businesses where id = q.business_id))
$$;

-- ---------- invoices ----------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  business_id uuid references public.businesses(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  status text not null default 'unpaid' check (status in ('unpaid','paid','void')),
  issued_at timestamptz not null default now(),
  due_date date,
  period_start date,
  period_end date,
  seller jsonb not null,
  buyer jsonb not null,
  items jsonb not null,
  subtotal numeric(12,2) not null,
  discount_pct numeric(5,2) not null default 0,
  discount numeric(12,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  vat numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  is_tax_invoice boolean not null default false,
  paid_at timestamptz,
  pay_method text check (pay_method in ('bank','cash','card','other')),
  pay_reference text check (char_length(pay_reference) <= 80),
  void_reason text check (char_length(void_reason) <= 200),
  voided_at timestamptz,
  notes text check (char_length(notes) <= 600),
  created_at timestamptz not null default now()
);
create index invoices_business_idx on public.invoices(business_id, issued_at desc);

-- issued means issued: amounts, parties and items never change; only payment and voiding do
create or replace function public.invoice_lock() returns trigger language plpgsql as $$
begin
  if old.status = 'void' then raise exception 'invoice_void'; end if;
  if new.number <> old.number or new.items <> old.items or new.total <> old.total or new.subtotal <> old.subtotal
     or new.vat <> old.vat or new.discount <> old.discount or new.seller <> old.seller or new.buyer <> old.buyer
     or new.issued_at <> old.issued_at or new.is_tax_invoice <> old.is_tax_invoice then
    raise exception 'invoice_locked';
  end if;
  return new;
end $$;
create trigger invoices_lock before update on public.invoices for each row execute function public.invoice_lock();
create or replace function public.invoice_no_delete() returns trigger language plpgsql as $$
begin raise exception 'invoice_locked'; end $$;
create trigger invoices_no_delete before delete on public.invoices for each row execute function public.invoice_no_delete();

-- ---------- agreement ----------
create table public.contract_templates (
  version serial primary key,
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 50 and 30000),
  created_at timestamptz not null default now(),
  created_by uuid
);
insert into public.contract_templates(title, body) values ('اتفاقية اشتراك في منصة «جاي»', $body$
تُبرم هذه الاتفاقية بتاريخ {{date}} بين:
- **مقدّم الخدمة:** {{seller_name}} ({{seller_id_label}}: {{seller_id}}).
- **المشترك:** {{business_name}}، ويمثّله صاحب الحساب {{owner_email}}.

## ١. الخدمة
يقدّم «جاي» نظام طوابير رقمياً يشمل صفحة المحل، وتذاكر الزبائن، وشاشة الموظفين، ولوحة المالك، والتنبيهات، بحسب مزايا الباقة المختارة.

## ٢. الباقة والسعر
- الباقة: **{{plan_name}}**.
- السعر: **{{plan_price}} ريال شهرياً**{{vat_note}}.
- الاشتراك السنوي يُمنح {{annual_free_months}} أشهر مجاناً.
- تبدأ تجربة مجانية مدتها {{trial_days}} يوماً، ولا يُطلب أي دفع خلالها.

## ٣. الدفع والتجديد
- {{payment_terms}}
- يتجدد الاشتراك بنفس المدة ما لم يطلب المشترك الإيقاف قبل نهايتها.
- عند تأخر الدفع أكثر من ٧ أيام بعد انتهاء المدة، يُوقف الحساب مؤقتاً دون حذف بياناته.

## ٤. التزامات المشترك
- إدخال بيانات صحيحة عن المحل وخدماته وأوقات عمله.
- استخدام النظام لأغراض مشروعة، وعدم إرسال رسائل مزعجة أو مضللة لزبائنه.
- المحافظة على سرية بيانات الدخول وروابط ربط أجهزة الموظفين.

## ٥. البيانات والخصوصية
- بيانات المحل وزبائنه ملك للمشترك، ويعالجها «جاي» لتشغيل الخدمة فقط وفق سياسة الخصوصية المنشورة.
- لا تُباع البيانات ولا تُشارك مع معلنين.
- عند الإلغاء وطلب الحذف، تُحذف بيانات المحل خلال ٣٠ يوماً.

## ٦. توفر الخدمة والمسؤولية
- يبذل «جاي» عناية معقولة لاستمرار الخدمة، مع نسخ احتياطية يومية.
- الأوقات المعروضة للزبائن تقديرية، ولا يتحمل «جاي» أي خسائر غير مباشرة تنتج عن انقطاع الخدمة أو تقديرات الانتظار.
- لا تتجاوز مسؤولية «جاي» في كل الأحوال قيمة اشتراك الشهر الأخير.

## ٧. الإلغاء
يحق للمشترك الإلغاء في أي وقت، ويستمر الاشتراك حتى نهاية المدة المدفوعة. ولا تُسترد المبالغ المدفوعة عن مدة بدأت.

## ٨. أحكام عامة
- تخضع هذه الاتفاقية لأنظمة المملكة العربية السعودية.
- تُعدّ الموافقة الإلكترونية على هذه الاتفاقية توقيعاً ملزماً للطرفين.
- يحق لـ«جاي» تحديث الاتفاقية، ويُطلب من المشترك الموافقة على النسخة الجديدة قبل سريانها عليه.
$body$);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  version int not null references public.contract_templates(version),
  title text not null,
  body text not null,
  body_sha256 text not null,
  accepted_by uuid,
  accepted_name text not null check (char_length(accepted_name) between 3 and 80),
  accepted_at timestamptz not null default now(),
  unique (business_id, version)
);

/** The current agreement text with this business's details filled in. */
create or replace function public.contract_render(p_business uuid, p_version int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t public.contract_templates;
  st public.billing_settings;
  b public.businesses;
  pr public.billing_products;
  v_body text;
  v_email text;
begin
  select * into t from public.contract_templates where version = coalesce(p_version, (select max(version) from public.contract_templates));
  select * into st from public.billing_settings;
  select * into b from public.businesses where id = p_business;
  select * into pr from public.billing_products where code = b.plan;
  select u.email into v_email from auth.users u where u.id = b.owner_user_id;
  v_body := t.body;
  v_body := replace(v_body, '{{date}}', to_char(now() at time zone 'Asia/Riyadh', 'YYYY-MM-DD'));
  v_body := replace(v_body, '{{seller_name}}', coalesce(st.seller_legal_name, st.seller_name));
  v_body := replace(v_body, '{{seller_id_label}}', st.seller_id_label);
  v_body := replace(v_body, '{{seller_id}}', coalesce(st.seller_id, '—'));
  v_body := replace(v_body, '{{business_name}}', coalesce(b.name, '—'));
  v_body := replace(v_body, '{{owner_email}}', coalesce(v_email, '—'));
  v_body := replace(v_body, '{{plan_name}}', coalesce(pr.name, b.plan, '—'));
  v_body := replace(v_body, '{{plan_price}}', coalesce(trim(to_char(pr.price, 'FM999G999D00')), '0'));
  v_body := replace(v_body, '{{vat_note}}', case when st.vat_registered then ' غير شامل ضريبة القيمة المضافة' else ' (غير خاضع لضريبة القيمة المضافة)' end);
  v_body := replace(v_body, '{{annual_free_months}}', st.annual_free_months::text);
  v_body := replace(v_body, '{{trial_days}}', st.trial_days::text);
  v_body := replace(v_body, '{{payment_terms}}', st.payment_terms);
  return jsonb_build_object('version', t.version, 'title', t.title, 'body', v_body);
end $$;

-- ---------- admin ----------
create or replace function public.a_billing(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.billing_settings s),
    'products', (select coalesce(jsonb_agg(to_jsonb(p) order by p.sort, p.code), '[]') from public.billing_products p),
    'template', (select jsonb_build_object('version', version, 'title', title, 'body', body, 'created_at', created_at)
                 from public.contract_templates order by version desc limit 1),
    'quotes', (select coalesce(jsonb_agg(public.quote_view(q) order by q.created_at desc), '[]') from public.quotes q),
    'invoices', (select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object('business_name', bz.name) order by i.issued_at desc), '[]')
                 from public.invoices i left join public.businesses bz on bz.id = i.business_id),
    'contracts', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'business_id', c.business_id, 'business_name', bz.name,
                    'version', c.version, 'accepted_name', c.accepted_name, 'accepted_at', c.accepted_at) order by c.accepted_at desc), '[]')
                  from public.contracts c join public.businesses bz on bz.id = c.business_id),
    'businesses', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'plan', b.plan) order by b.name), '[]')
                   from public.businesses b where not b.is_demo));
end $$;

create or replace function public.a_billing_settings_save(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_iban text := upper(regexp_replace(coalesce(p->>'iban', ''), '\s', '', 'g'));
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  if v_iban <> '' and v_iban !~ '^SA[0-9]{22}$' then return public.err('invalid_input', jsonb_build_object('field', 'iban')); end if;
  if coalesce(p->>'vat_number', '') <> '' and p->>'vat_number' !~ '^3[0-9]{13}3$' then return public.err('invalid_input', jsonb_build_object('field', 'vat_number')); end if;
  if coalesce((p->>'vat_registered')::boolean, false) and coalesce(p->>'vat_number', '') = '' then
    return public.err('invalid_input', jsonb_build_object('field', 'vat_number'));
  end if;
  update public.billing_settings set
    seller_name = coalesce(nullif(btrim(p->>'seller_name'), ''), seller_name),
    seller_legal_name = nullif(btrim(coalesce(p->>'seller_legal_name', '')), ''),
    seller_id_label = coalesce(nullif(btrim(p->>'seller_id_label'), ''), seller_id_label),
    seller_id = nullif(btrim(coalesce(p->>'seller_id', '')), ''),
    vat_registered = coalesce((p->>'vat_registered')::boolean, vat_registered),
    vat_number = nullif(btrim(coalesce(p->>'vat_number', '')), ''),
    vat_rate = coalesce((p->>'vat_rate')::numeric, vat_rate),
    bank_name = nullif(btrim(coalesce(p->>'bank_name', '')), ''),
    account_holder = nullif(btrim(coalesce(p->>'account_holder', '')), ''),
    iban = nullif(v_iban, ''),
    phone = nullif(btrim(coalesce(p->>'phone', '')), ''),
    email = nullif(btrim(coalesce(p->>'email', '')), ''),
    city = nullif(btrim(coalesce(p->>'city', '')), ''),
    address = nullif(btrim(coalesce(p->>'address', '')), ''),
    quote_valid_days = coalesce((p->>'quote_valid_days')::int, quote_valid_days),
    quote_prefix = coalesce(nullif(upper(btrim(p->>'quote_prefix')), ''), quote_prefix),
    invoice_prefix = coalesce(nullif(upper(btrim(p->>'invoice_prefix')), ''), invoice_prefix),
    annual_free_months = coalesce((p->>'annual_free_months')::int, annual_free_months),
    trial_days = coalesce((p->>'trial_days')::int, trial_days),
    payment_terms = coalesce(nullif(btrim(p->>'payment_terms'), ''), payment_terms),
    invoice_note = coalesce(nullif(btrim(p->>'invoice_note'), ''), invoice_note),
    updated_at = now();
  return public.a_billing(p_user);
exception when check_violation then
  return public.err('invalid_input');
end $$;

create or replace function public.a_product_save(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text := lower(btrim(coalesce(p->>'code', '')));
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  if v_code !~ '^[a-z][a-z0-9_]{1,30}$' then return public.err('invalid_input', jsonb_build_object('field', 'code')); end if;
  insert into public.billing_products(code, kind, name, tagline, price, unit, highlights, is_featured, is_active, sort)
  values (v_code, coalesce(p->>'kind', 'addon'), btrim(p->>'name'), nullif(btrim(coalesce(p->>'tagline', '')), ''),
          (p->>'price')::numeric, coalesce(p->>'unit', 'once'), coalesce(p->'highlights', '[]'),
          coalesce((p->>'is_featured')::boolean, false), coalesce((p->>'is_active')::boolean, true), coalesce((p->>'sort')::int, 50))
  on conflict (code) do update set
    name = excluded.name, tagline = excluded.tagline, price = excluded.price, unit = excluded.unit,
    highlights = excluded.highlights, is_featured = excluded.is_featured, is_active = excluded.is_active, sort = excluded.sort,
    updated_at = now();
  if coalesce((p->>'is_featured')::boolean, false) then
    update public.billing_products set is_featured = false where billing_products.code <> v_code and kind = 'plan';
  end if;
  return public.a_billing(p_user);
exception when check_violation or not_null_violation or invalid_text_representation then
  return public.err('invalid_input');
end $$;

create or replace function public.a_quote_save(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st public.billing_settings;
  calc jsonb;
  qid uuid := nullif(p->>'id', '')::uuid;
  q public.quotes;
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  select * into st from public.billing_settings;
  begin
    calc := public.billing_compute(p->'items', (p->>'discount_pct')::numeric);
  exception when others then
    return public.err('invalid_input', jsonb_build_object('field', 'items'));
  end;
  if char_length(btrim(coalesce(p->>'customer_name', ''))) < 2 then return public.err('invalid_input', jsonb_build_object('field', 'customer_name')); end if;
  if qid is null then
    insert into public.quotes(number, customer_name, contact_name, phone, email, category, plan, cycle, months, items, subtotal,
                              discount_pct, discount, vat_rate, vat, total, notes, valid_until)
    values (public.next_doc_number('quote', st.quote_prefix), btrim(p->>'customer_name'), nullif(btrim(coalesce(p->>'contact_name', '')), ''),
            nullif(btrim(coalesce(p->>'phone', '')), ''), nullif(btrim(coalesce(p->>'email', '')), ''), nullif(p->>'category', ''),
            nullif(p->>'plan', ''), coalesce(p->>'cycle', 'month'), coalesce((p->>'months')::int, 1), calc->'items', (calc->>'subtotal')::numeric,
            (calc->>'discount_pct')::numeric, (calc->>'discount')::numeric, (calc->>'vat_rate')::numeric, (calc->>'vat')::numeric,
            (calc->>'total')::numeric, nullif(btrim(coalesce(p->>'notes', '')), ''),
            (now() at time zone 'Asia/Riyadh')::date + coalesce((p->>'valid_days')::int, st.quote_valid_days))
    returning * into q;
  else
    update public.quotes set customer_name = btrim(p->>'customer_name'), contact_name = nullif(btrim(coalesce(p->>'contact_name', '')), ''),
      phone = nullif(btrim(coalesce(p->>'phone', '')), ''), email = nullif(btrim(coalesce(p->>'email', '')), ''),
      category = nullif(p->>'category', ''), plan = nullif(p->>'plan', ''), cycle = coalesce(p->>'cycle', 'month'),
      months = coalesce((p->>'months')::int, 1), items = calc->'items', subtotal = (calc->>'subtotal')::numeric,
      discount_pct = (calc->>'discount_pct')::numeric, discount = (calc->>'discount')::numeric, vat_rate = (calc->>'vat_rate')::numeric,
      vat = (calc->>'vat')::numeric, total = (calc->>'total')::numeric, notes = nullif(btrim(coalesce(p->>'notes', '')), ''),
      valid_until = (now() at time zone 'Asia/Riyadh')::date + coalesce((p->>'valid_days')::int, st.quote_valid_days), updated_at = now()
    where id = qid and status in ('draft','sent','viewed') returning * into q;
    if q.id is null then return public.err('not_editable'); end if;
  end if;
  return jsonb_build_object('quote', public.quote_view(q));
exception when check_violation then
  return public.err('invalid_input');
end $$;

/** send (marks it sent; the link works) | cancel | reopen (back to draft) | delete (drafts only) */
create or replace function public.a_quote_status(p_user uuid, p_quote uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.quotes;
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  if p_action = 'delete' then
    delete from public.quotes where id = p_quote and status in ('draft','cancelled');
    if not found then return public.err('not_editable'); end if;
    return jsonb_build_object('ok', true);
  end if;
  update public.quotes set status = case p_action when 'send' then case when status = 'draft' then 'sent' else status end
                                                  when 'cancel' then 'cancelled' when 'reopen' then 'draft' else status end,
                           updated_at = now()
   where id = p_quote and (p_action <> 'reopen' or status = 'cancelled') and status <> 'accepted'
   returning * into q;
  if q.id is null then return public.err('not_editable'); end if;
  return jsonb_build_object('quote', public.quote_view(q));
end $$;

create or replace function public.a_invoice_create(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  st public.billing_settings;
  calc jsonb;
  b public.businesses;
  q public.quotes;
  v_buyer jsonb;
  inv public.invoices;
  v_paid boolean := coalesce((p->>'paid')::boolean, false);
  v_months int := nullif(p->>'activate_months', '')::int;
  v_start date := coalesce(nullif(p->>'period_start', '')::date, (now() at time zone 'Asia/Riyadh')::date);
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  select * into st from public.billing_settings;
  select * into q from public.quotes where id = nullif(p->>'quote_id', '')::uuid;
  select * into b from public.businesses where id = coalesce(nullif(p->>'business_id', '')::uuid, q.business_id);
  if b.id is null and q.id is null then return public.err('invalid_input', jsonb_build_object('field', 'business_id')); end if;
  begin
    calc := public.billing_compute(coalesce(p->'items', q.items), coalesce((p->>'discount_pct')::numeric, q.discount_pct));
  exception when others then
    return public.err('invalid_input', jsonb_build_object('field', 'items'));
  end;
  v_buyer := jsonb_build_object('name', coalesce(b.name, q.customer_name),
    'contact', coalesce(q.contact_name, (select email from auth.users where id = b.owner_user_id)),
    'phone', coalesce(q.phone, (select phone from public.branches where business_id = b.id order by created_at limit 1)),
    'email', coalesce(q.email, (select email from auth.users where id = b.owner_user_id)),
    'vat_number', nullif(btrim(coalesce(p->>'buyer_vat_number', '')), ''));
  insert into public.invoices(number, business_id, quote_id, status, due_date, period_start, period_end, seller, buyer, items, subtotal,
                              discount_pct, discount, vat_rate, vat, total, is_tax_invoice, paid_at, pay_method, pay_reference, notes)
  values (public.next_doc_number('invoice', st.invoice_prefix), b.id, q.id, case when v_paid then 'paid' else 'unpaid' end,
          coalesce(nullif(p->>'due_date', '')::date, (now() at time zone 'Asia/Riyadh')::date + 3),
          case when v_months is not null then v_start end,
          case when v_months is not null then (v_start + make_interval(months => v_months) - interval '1 day')::date end,
          public.billing_seller(), v_buyer, calc->'items', (calc->>'subtotal')::numeric, (calc->>'discount_pct')::numeric,
          (calc->>'discount')::numeric, (calc->>'vat_rate')::numeric, (calc->>'vat')::numeric, (calc->>'total')::numeric,
          st.vat_registered, case when v_paid then coalesce(nullif(p->>'paid_at', '')::timestamptz, now()) end,
          case when v_paid then coalesce(nullif(p->>'pay_method', ''), 'bank') end, nullif(btrim(coalesce(p->>'pay_reference', '')), ''),
          nullif(btrim(coalesce(p->>'notes', '')), ''))
  returning * into inv;
  -- paying for a period activates the subscription for it
  if b.id is not null and v_months is not null and v_paid then
    perform public.a_update_business(p_user, b.id, jsonb_build_object('status', 'active', 'start', v_start, 'duration', v_months, 'unit', 'month',
      'plan', coalesce(nullif(p->>'plan', ''), q.plan, b.plan)));
  end if;
  return jsonb_build_object('invoice', to_jsonb(inv));
exception when check_violation then
  return public.err('invalid_input');
end $$;

create or replace function public.a_invoice_update(p_user uuid, p_invoice uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv public.invoices;
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  if p->>'action' = 'pay' then
    update public.invoices set status = 'paid', paid_at = coalesce(nullif(p->>'paid_at', '')::timestamptz, now()),
      pay_method = coalesce(nullif(p->>'pay_method', ''), 'bank'), pay_reference = nullif(btrim(coalesce(p->>'pay_reference', '')), '')
     where id = p_invoice and status = 'unpaid' returning * into inv;
  elsif p->>'action' = 'void' then
    if char_length(btrim(coalesce(p->>'reason', ''))) < 3 then return public.err('invalid_input', jsonb_build_object('field', 'reason')); end if;
    update public.invoices set status = 'void', void_reason = btrim(p->>'reason'), voided_at = now()
     where id = p_invoice and status <> 'void' returning * into inv;
  else
    return public.err('invalid_action');
  end if;
  if inv.id is null then return public.err('not_editable'); end if;
  return jsonb_build_object('invoice', to_jsonb(inv));
end $$;

create or replace function public.a_invoice(p_user uuid, p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  return coalesce((select jsonb_build_object('invoice', to_jsonb(i)) from public.invoices i where i.id = p_invoice), public.err('not_found'));
end $$;

create or replace function public.a_contract_template_save(p_user uuid, p_title text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  if char_length(btrim(coalesce(p_title, ''))) < 3 or char_length(btrim(coalesce(p_body, ''))) < 50 then return public.err('invalid_input'); end if;
  if (select body from public.contract_templates order by version desc limit 1) = btrim(p_body)
     and (select title from public.contract_templates order by version desc limit 1) = btrim(p_title) then
    return public.a_billing(p_user);       -- nothing changed: no new version
  end if;
  insert into public.contract_templates(title, body, created_by) values (btrim(p_title), btrim(p_body), p_user);
  return public.a_billing(p_user);
end $$;

create or replace function public.a_contract(p_user uuid, p_contract uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin(p_user) then return public.err('forbidden'); end if;
  return coalesce((select jsonb_build_object('contract', to_jsonb(c) || jsonb_build_object('business_name', bz.name), 'seller', public.billing_seller())
                   from public.contracts c join public.businesses bz on bz.id = c.business_id where c.id = p_contract), public.err('not_found'));
end $$;

-- ---------- public quote page ----------
create or replace function public.public_quote(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.quotes;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return public.err('quote_not_found'); end if;
  select * into q from public.quotes where token = p_token and status in ('sent','viewed','accepted');
  if q.id is null then return public.err('quote_not_found'); end if;
  if q.status = 'sent' then update public.quotes set status = 'viewed', viewed_at = now() where id = q.id returning * into q; end if;
  return jsonb_build_object('quote', public.quote_view(q) - 'id' - 'business_id', 'seller', public.billing_seller(),
    'trial_days', (select trial_days from public.billing_settings));
end $$;

create or replace function public.quote_accept(p_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.quotes;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then return public.err('quote_not_found'); end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 3 and 80 then return public.err('invalid_input', jsonb_build_object('field', 'name')); end if;
  select * into q from public.quotes where token = p_token for update;
  if q.id is null or q.status not in ('sent','viewed','accepted') then return public.err('quote_not_found'); end if;
  if q.status <> 'accepted' then
    if q.valid_until < (now() at time zone 'Asia/Riyadh')::date then return public.err('quote_expired'); end if;
    update public.quotes set status = 'accepted', accepted_at = now(), accepted_name = btrim(p_name), updated_at = now()
     where id = q.id returning * into q;
  end if;
  return jsonb_build_object('ok', true, 'quote', public.quote_view(q) - 'id' - 'business_id');
end $$;

-- ---------- owner ----------
create or replace function public.owner_business(p_user uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.businesses where owner_user_id = p_user order by created_at limit 1
$$;

/** The owner's agreement (pending or accepted), invoices, and the bank details to pay. */
create or replace function public.o_billing(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.owner_business(p_user); cur int := (select max(version) from public.contract_templates); c public.contracts;
begin
  if b is null then return public.err('not_found'); end if;
  select * into c from public.contracts where business_id = b order by version desc limit 1;
  return jsonb_build_object(
    'business_id', b,
    'contract_pending', c.id is null or c.version < cur,
    'contract', case when c.id is null then null else jsonb_build_object('id', c.id, 'version', c.version, 'title', c.title,
                  'accepted_name', c.accepted_name, 'accepted_at', c.accepted_at) end,
    'draft', case when c.id is null or c.version < cur then public.contract_render(b) end,
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status, 'issued_at', i.issued_at,
                   'total', i.total, 'period_start', i.period_start, 'period_end', i.period_end, 'due_date', i.due_date) order by i.issued_at desc), '[]')
                 from public.invoices i where i.business_id = b),
    'seller', public.billing_seller());
end $$;

create or replace function public.o_contract_accept(p_user uuid, p_version int, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b uuid := public.owner_business(p_user); r jsonb;
begin
  if b is null then return public.err('not_found'); end if;
  if p_version <> (select max(version) from public.contract_templates) then return public.err('contract_changed'); end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 3 and 80 then return public.err('invalid_input', jsonb_build_object('field', 'name')); end if;
  r := public.contract_render(b, p_version);
  insert into public.contracts(business_id, version, title, body, body_sha256, accepted_by, accepted_name)
  values (b, p_version, r->>'title', r->>'body', encode(extensions.digest(r->>'body', 'sha256'), 'hex'), p_user, btrim(p_name))
  on conflict (business_id, version) do nothing;
  return public.o_billing(p_user);
end $$;

create or replace function public.o_contract(p_user uuid, p_contract uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((select jsonb_build_object('contract', to_jsonb(c) || jsonb_build_object('business_name', bz.name), 'seller', public.billing_seller())
                   from public.contracts c join public.businesses bz on bz.id = c.business_id
                   where c.id = p_contract and bz.owner_user_id = p_user), public.err('not_found'));
end $$;

create or replace function public.o_invoice(p_user uuid, p_invoice uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((select jsonb_build_object('invoice', to_jsonb(i)) from public.invoices i join public.businesses bz on bz.id = i.business_id
                   where i.id = p_invoice and bz.owner_user_id = p_user), public.err('not_found'));
end $$;

/** After signing up from an accepted quote: tie the quote to the new shop and take its plan. */
create or replace function public.o_quote_link(p_user uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b uuid := public.owner_business(p_user); q public.quotes;
begin
  if b is null then return public.err('not_found'); end if;
  select * into q from public.quotes where token = p_token and status in ('sent','viewed','accepted') and business_id is null for update;
  if q.id is null then return public.err('quote_not_found'); end if;
  update public.quotes set business_id = b, status = 'accepted', accepted_at = coalesce(accepted_at, now()), updated_at = now() where id = q.id;
  if q.plan is not null and exists (select 1 from public.billing_products where code = q.plan and kind = 'plan') then
    update public.businesses set plan = q.plan where id = b;
  end if;
  return jsonb_build_object('ok', true, 'plan', q.plan);
end $$;

alter table public.billing_settings enable row level security;
alter table public.billing_products enable row level security;
alter table public.billing_counters enable row level security;
alter table public.quotes enable row level security;
alter table public.invoices enable row level security;
alter table public.contract_templates enable row level security;
alter table public.contracts enable row level security;
revoke all on public.billing_settings, public.billing_products, public.billing_counters, public.quotes, public.invoices,
  public.contract_templates, public.contracts from anon, authenticated;
grant execute on function public.public_quote(text), public.quote_accept(text, text) to anon, authenticated;
