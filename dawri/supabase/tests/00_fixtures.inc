-- Shared fixtures, included by each test file (\ir). Creates an always-open branch on a given plan.
create or replace function pg_temp.mk_branch(p_plan text, p_hours jsonb default null, p_settings jsonb default '{}')
returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid(); b uuid; br uuid;
begin
  insert into auth.users(id, email) values (u, u || '@test.local');
  insert into public.businesses(name, slug, plan, owner_user_id)
  values ('متجر تجربة', 't-' || substr(md5(u::text), 1, 10), p_plan, u) returning id into b;
  insert into public.branches(business_id, name, hours, settings)
  values (b, 'فرع تجربة', coalesce(p_hours,
          (select jsonb_object_agg(d, '[["00:00","00:00"]]'::jsonb) from unnest(array['sun','mon','tue','wed','thu','fri','sat']) d)),
          p_settings) returning id into br;
  return br;
end $$;
create or replace function pg_temp.mk_service(p_branch uuid, p_mode text default 'remote', p_min int default 10)
returns uuid language sql as $$
  insert into public.services(branch_id, name, mode, avg_minutes) values (p_branch, 'خدمة', p_mode, p_min) returning id
$$;
create or replace function pg_temp.mk_device(p_branch uuid) returns uuid language sql as $$
  insert into public.staff_devices(branch_id, label, token_hash) values (p_branch, 'جهاز', public.sha256_hex(gen_random_uuid()::text)) returning id
$$;
create or replace function pg_temp.pid(p_branch uuid) returns text language sql as $$
  select public_id from public.branches where id = p_branch
$$;
create or replace function pg_temp.owner_of(p_branch uuid) returns uuid language sql as $$
  select b.owner_user_id from public.branches br join public.businesses b on b.id = br.business_id where br.id = p_branch
$$;
