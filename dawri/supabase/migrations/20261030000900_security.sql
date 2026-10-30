-- Row Level Security and privileges. Runs after every function exists.
-- Anonymous users get no table access at all: only public_branch() and public_ticket().
-- Edge Functions use the service role; owners read their own rows and edit catalog tables directly.

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Functions: nothing is callable by anon/authenticated unless granted below.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant execute on function public.public_branch(text) to anon, authenticated;
grant execute on function public.public_ticket(text) to anon, authenticated;
-- used inside RLS policies, so the caller needs them
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.owned_branch_ids(uuid) to authenticated;
grant execute on function public.has_feature(uuid, text) to authenticated;
grant execute on function public.branch_features(uuid) to authenticated;
grant execute on function public.plan_features(text) to authenticated;
grant execute on function public.business_effective_plan(uuid) to authenticated;
grant execute on function public.feature_min_plan(text) to authenticated;

-- ---------- owner read access ----------
grant select on public.businesses, public.services, public.providers, public.tickets, public.offers,
                public.loyalty_cards, public.redemptions, public.feedback, public.business_pages,
                public.menu_items, public.news_posts, public.daily_summaries, public.ready_numbers,
                public.branch_status, public.ai_usage to authenticated;
-- secrets stay server-side
grant select (id, business_id, name, public_id, address, map_url, phone, google_review_url, timezone,
              hours, settings, is_active, created_at, updated_at) on public.branches to authenticated;
grant select (id, branch_id, label, language, provider_id, last_seen_at, revoked_at, created_at, updated_at)
  on public.staff_devices to authenticated;

-- ---------- owner write access (catalog only; queue state changes go through Edge Functions) ----------
grant update (name, category) on public.businesses to authenticated;
grant update (name, address, map_url, phone, google_review_url, hours) on public.branches to authenticated;
grant insert, update, delete on public.services, public.providers, public.menu_items, public.offers,
                                 public.news_posts to authenticated;
grant insert, update on public.business_pages to authenticated;

-- ---------- policies ----------
create policy businesses_owner_read on public.businesses for select to authenticated
  using (owner_user_id = auth.uid() or public.is_admin());
create policy businesses_owner_update on public.businesses for update to authenticated
  using (owner_user_id = auth.uid() or public.is_admin())
  with check (owner_user_id = auth.uid() or public.is_admin());

create policy branches_owner_read on public.branches for select to authenticated
  using (id in (select public.owned_branch_ids()) or public.is_admin());
create policy branches_owner_update on public.branches for update to authenticated
  using (id in (select public.owned_branch_ids()) or public.is_admin())
  with check (id in (select public.owned_branch_ids()) or public.is_admin());

do $$
declare t text;
begin
  -- read-only for owners
  foreach t in array array['staff_devices','tickets','loyalty_cards','redemptions','feedback',
                           'daily_summaries','ready_numbers','branch_status'] loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using (branch_id in (select public.owned_branch_ids()) or public.is_admin())$p$, t || '_owner_read', t);
  end loop;
  -- full CRUD for owners
  foreach t in array array['services','providers','menu_items','offers','news_posts','business_pages'] loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using (branch_id in (select public.owned_branch_ids()) or public.is_admin())$p$, t || '_owner_read', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (branch_id in (select public.owned_branch_ids()) or public.is_admin())$p$, t || '_owner_delete', t);
  end loop;
end $$;

-- inserts/updates also respect plan features
create policy services_owner_write on public.services for insert to authenticated
  with check (branch_id in (select public.owned_branch_ids()) or public.is_admin());
create policy services_owner_update on public.services for update to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin())
  with check (branch_id in (select public.owned_branch_ids()) or public.is_admin());
create policy providers_owner_write on public.providers for insert to authenticated
  with check (branch_id in (select public.owned_branch_ids()) or public.is_admin());
create policy providers_owner_update on public.providers for update to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin())
  with check (branch_id in (select public.owned_branch_ids()) or public.is_admin());
create policy menu_items_owner_write on public.menu_items for insert to authenticated
  with check ((branch_id in (select public.owned_branch_ids()) or public.is_admin()) and public.has_feature(branch_id, 'menu'));
create policy menu_items_owner_update on public.menu_items for update to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin())
  with check (public.has_feature(branch_id, 'menu'));
create policy offers_owner_write on public.offers for insert to authenticated
  with check ((branch_id in (select public.owned_branch_ids()) or public.is_admin())
              and public.has_feature(branch_id, case kind when 'quiet_coupon' then 'quiet_coupon' else 'timed_offers' end));
create policy offers_owner_update on public.offers for update to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin())
  with check (public.has_feature(branch_id, case kind when 'quiet_coupon' then 'quiet_coupon' else 'timed_offers' end));
create policy news_posts_owner_write on public.news_posts for insert to authenticated
  with check ((branch_id in (select public.owned_branch_ids()) or public.is_admin()) and public.has_feature(branch_id, 'news'));
create policy news_posts_owner_update on public.news_posts for update to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin())
  with check (public.has_feature(branch_id, 'news'));
create policy business_pages_owner_write on public.business_pages for insert to authenticated
  with check (branch_id in (select public.owned_branch_ids()) or public.is_admin());
create policy business_pages_owner_update on public.business_pages for update to authenticated
  using (branch_id in (select public.owned_branch_ids()) or public.is_admin())
  with check (branch_id in (select public.owned_branch_ids()) or public.is_admin());

create policy ai_usage_owner_read on public.ai_usage for select to authenticated
  using (business_id in (select id from public.businesses where owner_user_id = auth.uid()) or public.is_admin());
