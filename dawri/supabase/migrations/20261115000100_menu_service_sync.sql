-- A menu item linked to a queue service (menu_items.service_id) is the same thing seen in two places:
-- «قائمتي» (name, price, duration) and the queue services the customer picks from («خذ رقمك»).
-- Renaming either one, or changing its duration, now updates the other, so an owner never edits one
-- and keeps seeing the old name on the shop page.

create or replace function public.sync_menu_to_service() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.service_id is null then return new; end if;
  update public.services s
     set name = left(new.name, 60),
         avg_minutes = coalesce(new.duration_min, s.avg_minutes)
   where s.id = new.service_id and s.branch_id = new.branch_id
     and (s.name is distinct from left(new.name, 60) or (new.duration_min is not null and s.avg_minutes is distinct from new.duration_min));
  return new;
end $$;

create or replace function public.sync_service_to_menu() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  update public.menu_items m
     set name = new.name,
         duration_min = case when new.avg_minutes is distinct from old.avg_minutes then new.avg_minutes else m.duration_min end
   where m.service_id = new.id and m.branch_id = new.branch_id
     and (m.name is distinct from new.name or (new.avg_minutes is distinct from old.avg_minutes and m.duration_min is distinct from new.avg_minutes));
  return new;
end $$;

create trigger menu_items_sync_service after insert or update of name, duration_min, service_id on public.menu_items
  for each row execute function public.sync_menu_to_service();
create trigger services_sync_menu after update of name, avg_minutes on public.services
  for each row execute function public.sync_service_to_menu();

-- bring linked pairs that already drifted back together (the menu item, the one owners edit, wins)
update public.services s set name = left(m.name, 60)
  from public.menu_items m
 where m.service_id = s.id and m.branch_id = s.branch_id and s.name is distinct from left(m.name, 60);

revoke execute on function public.sync_menu_to_service(), public.sync_service_to_menu() from public, anon, authenticated;
