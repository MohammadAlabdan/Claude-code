-- A trial that ended with no paid period after it means the shop is inactive (status) and has no features,
-- instead of quietly keeping its plan for free. A paid plan with no end date stays active.
create or replace function public.business_status(b public.businesses) returns text
language sql stable as $$
  select case
    when not b.is_active then 'inactive'
    when b.trial_until is not null and b.trial_until > now() then 'trial'
    when b.plan_until is not null and b.plan_until > now() then 'active'
    when b.trial_until is not null then 'inactive'          -- the trial ended and nothing was paid after it
    when b.plan_until is null then 'active'
    else 'inactive' end
$$;

create or replace function public.business_effective_plan(p_business uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not b.is_active then null
    when b.trial_until is not null and b.trial_until > now() then 'full'
    when b.plan_until is not null and b.plan_until > now() then b.plan
    when b.trial_until is not null then null
    when b.plan_until is null then b.plan
    else null
  end
  from public.businesses b where b.id = p_business
$$;
