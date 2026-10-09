-- ============================================================
--  Local app — Storage buckets + policies
--  Run in Supabase SQL Editor (or create buckets in the dashboard).
-- ============================================================
-- Two public-read buckets. Writes are restricted to the owning user,
-- enforced by putting the user's id as the first path segment:
--   avatars/<user_id>/avatar.jpg
--   videos/<user_id>/<video_id>.mp4
-- ============================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('videos', 'videos', true)
on conflict (id) do nothing;

-- Public read for both buckets
create policy "public read avatars" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "public read videos" on storage.objects
  for select using (bucket_id = 'videos');

-- Users can write only inside their own folder (first path segment = their uid)
create policy "avatars write own folder" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "avatars update own folder" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "avatars delete own folder" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "videos write own folder" on storage.objects
  for insert with check (
    bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "videos update own folder" on storage.objects
  for update using (
    bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "videos delete own folder" on storage.objects
  for delete using (
    bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text
  );
