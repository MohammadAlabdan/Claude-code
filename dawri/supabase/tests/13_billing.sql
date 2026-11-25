begin;
\ir 00_fixtures.inc
select plan(22);

create temp table fx as select pg_temp.mk_branch('basic') br;
alter table fx add column biz uuid, add column owner uuid, add column adm uuid, add column q uuid, add column tok text, add column inv uuid;
update fx set biz = (select business_id from public.branches where id = fx.br);
update fx set owner = (select owner_user_id from public.businesses where id = fx.biz);
insert into auth.users(id, email) values ('d0000000-0000-4000-8000-0000000000d1', 'bill-admin@test.local');
insert into public.admins(user_id) values ('d0000000-0000-4000-8000-0000000000d1');
update fx set adm = 'd0000000-0000-4000-8000-0000000000d1';

-- catalog
select is(public.plan_price_sar('growth'), 399, 'plan prices come from the catalog');
select is((public.a_product_save(adm, '{"code":"growth","kind":"plan","name":"النمو","price":449,"unit":"month","highlights":[],"is_featured":true}') ->> 'error'), null, 'admin edits a price') from fx;
select is(public.plan_price_sar('growth'), 449, 'and MRR follows it');
select is(public.a_product_save(owner, '{"code":"x","name":"y","price":1}') ->> 'error', 'forbidden', 'owners cannot edit the catalog') from fx;

-- quote: totals, numbering, discount
create temp table r as select public.a_quote_save(adm, jsonb_build_object('customer_name', 'حلاق النخبة', 'plan', 'growth', 'cycle', 'year', 'months', 12,
  'discount_pct', 10, 'items', jsonb_build_array(
    jsonb_build_object('title', 'باقة النمو · اشتراك سنوي', 'qty', 10, 'unit_price', 449),
    jsonb_build_object('title', 'التركيب والتدريب', 'qty', 1, 'unit_price', 399)))) j from fx;
update fx set q = (select (j -> 'quote' ->> 'id')::uuid from r), tok = (select j -> 'quote' ->> 'token' from r);
select is((select (j -> 'quote' ->> 'subtotal')::numeric from r), 4889.00, 'subtotal = 10×449 + 399');
select is((select (j -> 'quote' ->> 'total')::numeric from r), 4400.10, 'minus 10%, no VAT while not registered');
select ok((select j -> 'quote' ->> 'number' from r) ~ '^Q-\d{4}-0001$', 'first quote number');
select is(public.a_quote_save(adm, '{"customer_name":"x","items":[]}') ->> 'error', 'invalid_input', 'a quote needs items') from fx;

-- public page: drafts are private; sending opens the link; first view is recorded
select is(public.public_quote(tok) ->> 'error', 'quote_not_found', 'a draft is not public') from fx;
select public.a_quote_status(adm, q, 'send') from fx;
select is(public.public_quote(tok) -> 'quote' ->> 'state', 'viewed', 'opening the link marks it viewed') from fx;
select is(public.quote_accept(tok, 'أ') ->> 'error', 'invalid_input', 'accepting needs a name') from fx;
select is(public.quote_accept(tok, 'سالم العتيبي') -> 'quote' ->> 'state', 'accepted', 'accepted from the public page') from fx;
select is(public.a_quote_status(adm, q, 'cancel') ->> 'error', 'not_editable', 'an accepted quote cannot be cancelled') from fx;

-- signup from the quote takes its plan
select is(public.o_quote_link(owner, tok) ->> 'plan', 'growth', 'the new shop is linked to the quote') from fx;
select is((select plan from public.businesses where id = (select biz from fx)), 'growth', 'and gets the quoted plan');

-- invoice from the quote, paid, activates a year
update fx set inv = (public.a_invoice_create(adm, jsonb_build_object('quote_id', q, 'paid', true, 'pay_method', 'bank', 'activate_months', 12)) -> 'invoice' ->> 'id')::uuid;
select ok((select number from public.invoices where id = (select inv from fx)) ~ '^JAY-\d{4}-0001$', 'first invoice number');
select is((select public.business_status(b) from public.businesses b where id = (select biz from fx)), 'active', 'paying activates the subscription');
select throws_ok(format('update public.invoices set total = 1 where id = %L', (select inv from fx)), 'P0001', 'invoice_locked', 'an issued invoice cannot be edited');
select is(public.a_invoice_update(adm, inv, '{"action":"void","reason":"خطأ في المبلغ"}') -> 'invoice' ->> 'status', 'void', 'void instead') from fx;

-- VAT once registered
select public.a_billing_settings_save(adm, '{"vat_registered":true,"vat_number":"300000000000003"}') from fx;
select is((public.billing_compute('[{"title":"اشتراك","qty":1,"unit_price":100}]', 0) ->> 'total')::numeric, 115.00, 'VAT 15% is added when registered');

-- agreement: pending until accepted, with the shop filled in
select is((public.o_billing(owner) ->> 'contract_pending')::boolean, true, 'agreement pending after signup') from fx;
select is((public.o_contract_accept(owner, (select max(version) from public.contract_templates), 'سالم العتيبي') ->> 'contract_pending')::boolean, false, 'accepted') from fx;

select * from finish();
rollback;
