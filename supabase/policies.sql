-- ============================================================
--  Local app — Row Level Security (RLS) policies
--  Run AFTER schema.sql, in the Supabase SQL Editor.
-- ============================================================
--  Model: data is readable publicly where it makes sense (profiles,
--  videos, comments), but a user can only WRITE their own rows.
--  Counts are kept by SECURITY DEFINER triggers, so clients never
--  need UPDATE on *_count columns.
-- ============================================================

-- Enable RLS everywhere
alter table public.users                   enable row level security;
alter table public.community_registrations enable row level security;
alter table public.communities             enable row level security;
alter table public.services                enable row level security;
alter table public.videos                  enable row level security;
alter table public.video_likes             enable row level security;
alter table public.follows                 enable row level security;
alter table public.video_saves             enable row level security;
alter table public.comments                enable row level security;
alter table public.folders                 enable row level security;
alter table public.folder_collaborators    enable row level security;
alter table public.folder_items            enable row level security;
alter table public.chats                   enable row level security;
alter table public.chat_members            enable row level security;
alter table public.chat_messages           enable row level security;
alter table public.notifications           enable row level security;
alter table public.trip_plans              enable row level security;
alter table public.bookings                enable row level security;
alter table public.passport_stamps         enable row level security;

-- ---------- USERS ----------
create policy "users readable by all" on public.users
  for select using (true);
create policy "users update own" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- insert handled by the signup trigger (security definer)

-- ---------- COMMUNITY REGISTRATIONS (private to owner) ----------
create policy "reg select own" on public.community_registrations
  for select using (auth.uid() = user_id);
create policy "reg insert own" on public.community_registrations
  for insert with check (auth.uid() = user_id);
create policy "reg update own" on public.community_registrations
  for update using (auth.uid() = user_id);

-- ---------- COMMUNITIES & SERVICES (public read, host writes own) ----------
create policy "communities readable by all" on public.communities
  for select using (true);
create policy "communities write own" on public.communities
  for all using (auth.uid() = host_user_id) with check (auth.uid() = host_user_id);

create policy "services readable by all" on public.services
  for select using (true);
create policy "services write via community" on public.services
  for all using (
    exists (select 1 from public.communities c where c.id = community_id and c.host_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.communities c where c.id = community_id and c.host_user_id = auth.uid())
  );

-- ---------- VIDEOS (public read non-deleted, owner writes) ----------
create policy "videos readable by all" on public.videos
  for select using (is_deleted = false or auth.uid() = user_id);
create policy "videos insert own" on public.videos
  for insert with check (auth.uid() = user_id);
create policy "videos update own" on public.videos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "videos delete own" on public.videos
  for delete using (auth.uid() = user_id);

-- ---------- VIDEO LIKES ----------
create policy "likes readable by all" on public.video_likes
  for select using (true);
create policy "likes insert own" on public.video_likes
  for insert with check (auth.uid() = user_id);
create policy "likes delete own" on public.video_likes
  for delete using (auth.uid() = user_id);

-- ---------- FOLLOWS ----------
create policy "follows readable by all" on public.follows
  for select using (true);
create policy "follows insert own" on public.follows
  for insert with check (auth.uid() = follower_id);
create policy "follows delete own" on public.follows
  for delete using (auth.uid() = follower_id);

-- ---------- VIDEO SAVES (private to the user) ----------
create policy "saves select own" on public.video_saves
  for select using (auth.uid() = user_id);
create policy "saves insert own" on public.video_saves
  for insert with check (auth.uid() = user_id);
create policy "saves delete own" on public.video_saves
  for delete using (auth.uid() = user_id);

-- ---------- COMMENTS (public read, owner writes) ----------
create policy "comments readable by all" on public.comments
  for select using (true);
create policy "comments insert own" on public.comments
  for insert with check (auth.uid() = user_id);
create policy "comments update own" on public.comments
  for update using (auth.uid() = user_id);
create policy "comments delete own" on public.comments
  for delete using (auth.uid() = user_id);

-- ---------- FOLDERS (owner or collaborator) ----------
create policy "folders select own or shared" on public.folders
  for select using (
    auth.uid() = owner_id
    or is_public = true
    or exists (select 1 from public.folder_collaborators fc where fc.folder_id = id and fc.user_id = auth.uid())
  );
create policy "folders insert own" on public.folders
  for insert with check (auth.uid() = owner_id);
create policy "folders update own" on public.folders
  for update using (auth.uid() = owner_id);
create policy "folders delete own" on public.folders
  for delete using (auth.uid() = owner_id);

create policy "folder_collab select" on public.folder_collaborators
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid())
  );
create policy "folder_collab manage by owner" on public.folder_collaborators
  for all using (exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid()))
  with check (exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid()));

create policy "folder_items select via folder" on public.folder_items
  for select using (
    exists (
      select 1 from public.folders f
      where f.id = folder_id
        and (f.owner_id = auth.uid() or f.is_public = true
          or exists (select 1 from public.folder_collaborators fc where fc.folder_id = f.id and fc.user_id = auth.uid()))
    )
  );
create policy "folder_items write via folder" on public.folder_items
  for all using (
    exists (
      select 1 from public.folders f
      where f.id = folder_id
        and (f.owner_id = auth.uid()
          or exists (select 1 from public.folder_collaborators fc where fc.folder_id = f.id and fc.user_id = auth.uid() and fc.permission = 'editor'))
    )
  ) with check (
    exists (
      select 1 from public.folders f
      where f.id = folder_id
        and (f.owner_id = auth.uid()
          or exists (select 1 from public.folder_collaborators fc where fc.folder_id = f.id and fc.user_id = auth.uid() and fc.permission = 'editor'))
    )
  );

-- ---------- CHATS (members only) ----------
create policy "chats select members" on public.chats
  for select using (
    exists (select 1 from public.chat_members m where m.chat_id = id and m.user_id = auth.uid())
  );
create policy "chats insert" on public.chats
  for insert with check (auth.uid() = created_by);

create policy "chat_members select own chats" on public.chat_members
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.chat_members m2 where m2.chat_id = chat_id and m2.user_id = auth.uid())
  );
create policy "chat_members insert" on public.chat_members
  for insert with check (
    auth.uid() = user_id
    or exists (select 1 from public.chats c where c.id = chat_id and c.created_by = auth.uid())
  );

create policy "messages select members" on public.chat_messages
  for select using (
    exists (select 1 from public.chat_members m where m.chat_id = chat_id and m.user_id = auth.uid())
  );
create policy "messages insert members" on public.chat_messages
  for insert with check (
    auth.uid() = sender_id
    and exists (select 1 from public.chat_members m where m.chat_id = chat_id and m.user_id = auth.uid())
  );

-- ---------- NOTIFICATIONS (recipient only) ----------
create policy "notifications select own" on public.notifications
  for select using (auth.uid() = user_id);
create policy "notifications update own" on public.notifications
  for update using (auth.uid() = user_id);

-- ---------- TRIP PLANS (creator) ----------
create policy "trips select own or shared" on public.trip_plans
  for select using (auth.uid() = creator_id or is_shared = true);
create policy "trips write own" on public.trip_plans
  for all using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

-- ---------- BOOKINGS ----------
create policy "bookings select own or host" on public.bookings
  for select using (
    auth.uid() = tourist_id
    or exists (select 1 from public.communities c where c.id = community_id and c.host_user_id = auth.uid())
  );
create policy "bookings insert own" on public.bookings
  for insert with check (auth.uid() = tourist_id);
create policy "bookings update own or host" on public.bookings
  for update using (
    auth.uid() = tourist_id
    or exists (select 1 from public.communities c where c.id = community_id and c.host_user_id = auth.uid())
  );

-- ---------- PASSPORT STAMPS ----------
create policy "stamps select own" on public.passport_stamps
  for select using (auth.uid() = tourist_id);
create policy "stamps insert own" on public.passport_stamps
  for insert with check (auth.uid() = tourist_id);
