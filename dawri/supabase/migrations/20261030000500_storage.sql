-- Public bucket for shop page photos. Owners write only under "<branch_id>/...".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branch-photos', 'branch-photos', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy branch_photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'branch-photos'
              and (storage.foldername(name))[1] in (select id::text from public.owned_branch_ids()));
create policy branch_photos_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'branch-photos'
         and (storage.foldername(name))[1] in (select id::text from public.owned_branch_ids()));
create policy branch_photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branch-photos'
         and (storage.foldername(name))[1] in (select id::text from public.owned_branch_ids()));
