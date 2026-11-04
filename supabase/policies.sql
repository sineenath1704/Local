-- ============================================================
--  Local app — Row Level Security (RLS) policies
--  Run AFTER schema.sql, in the Supabase SQL Editor.
-- ============================================================
--  Model: data is readable publicly where it makes sense (profiles,
--  videos, comments), but a user can only WRITE their own rows.
--  Counts are kept by SECURITY DEFINER triggers, so clients never
--  need UPDATE on *_count columns.
-- ------------------------------------------------------------
--  ลำดับที่ต้องรัน:
--    1) schema.sql
--    2) migrations/create_community_places.sql   (สร้างตาราง community_places)
--    3) policies.sql  ← ไฟล์นี้
--    4) storage.sql
--
--  ✅ รันซ้ำได้ (idempotent): ทุก policy ถูก `drop policy if exists`
--     ก่อน `create policy` เสมอ → รันซ้ำไม่ error "policy already exists"
--     และไม่ทำให้ policy ที่ยังไม่ถึงครึ่งทางค้าง
--
--  ℹ️ ถ้า community_places ยังไม่มีตาราง → ข้ามเฉพาะส่วนนั้น
--     พร้อมข้อความเตือน (ไม่ error ทั้งไฟล์) → รัน
--     create_community_places.sql แล้วรัน policies.sql ซ้ำก็ได้
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
drop policy if exists "users readable by all" on public.users;
create policy "users readable by all" on public.users
  for select using (true);
drop policy if exists "users update own" on public.users;
create policy "users update own" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- insert handled by the signup trigger (security definer)

-- ---------- COMMUNITY REGISTRATIONS (private to owner) ----------
drop policy if exists "reg select own" on public.community_registrations;
create policy "reg select own" on public.community_registrations
  for select using (auth.uid() = user_id);
drop policy if exists "reg insert own" on public.community_registrations;
create policy "reg insert own" on public.community_registrations
  for insert with check (auth.uid() = user_id);
drop policy if exists "reg update own" on public.community_registrations;
create policy "reg update own" on public.community_registrations
  for update using (auth.uid() = user_id);

-- ---------- COMMUNITIES & SERVICES (public read, host writes own) ----------
drop policy if exists "communities readable by all" on public.communities;
create policy "communities readable by all" on public.communities
  for select using (true);
drop policy if exists "communities write own" on public.communities;
create policy "communities write own" on public.communities
  for all using (auth.uid() = host_user_id) with check (auth.uid() = host_user_id);

drop policy if exists "services readable by all" on public.services;
create policy "services readable by all" on public.services
  for select using (true);
drop policy if exists "services write via community" on public.services;
create policy "services write via community" on public.services
  for all using (
    exists (select 1 from public.communities c where c.id = community_id and c.host_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.communities c where c.id = community_id and c.host_user_id = auth.uid())
  );

-- ---------- COMMUNITY PLACES (public read = แหล่งจริงของข้อมูลสถานที่) ----------
--
-- PLAN_PLACE_MATCHING.md §2.6.4 — policy เดิมใน create_community_places.sql
--   WITH CHECK (auth.uid() = owner_id OR auth.uid() IS NOT NULL)
-- เงื่อนไขหลังทำให้เงื่อนไขแรกเป็นจริงเสมอ → ใครก็ insert แถวที่ owner_id
-- ของคนอื่นได้ → ผู้ใช้ทั่วไป insert ได้เฉพาะแถวที่ owner_id = NULL
-- (หรือเป็นของตัวเอง)
--
-- หมายเหตุ: ตารางนี้เป็น "แหล่งจริง" ของสถานที่ (D1) ทั้ง AI Chat และแอป
-- ต้องอ่านได้ → select เปิดให้สาธารณะ
--
-- ห่อด้วย DO block: ถ้ายังไม่มีตาราง community_places ให้ข้ามส่วนนี้
-- พร้อม notice (ไม่ error ทั้งไฟล์) → รัน create_community_places.sql
-- แล้วรันไฟล์นี้ซ้ำ → policy ของ community_places จะถูกสร้างครบ
do $$
begin
  if to_regclass('public.community_places') is null then
    raise notice 'community_places ยังไม่มีในโปรเจกต์นี้ — ข้าม policy ของ community_places (ต้องรัน create_community_places.sql ก่อน แล้วรัน policies.sql ซ้ำ)';
    return;
  end if;

  execute 'alter table public.community_places enable row level security';

  execute 'drop policy if exists "Allow public read access on community_places" on public.community_places';
  execute 'create policy "Allow public read access on community_places" on public.community_places for select using (true)';

  execute 'drop policy if exists "Allow authenticated users to insert community_places" on public.community_places';
  execute 'create policy "Allow authenticated users to insert community_places" on public.community_places for insert with check (owner_id is null or owner_id = auth.uid())';

  execute 'drop policy if exists "Allow owners to update their community_places" on public.community_places';
  execute 'create policy "Allow owners to update their community_places" on public.community_places for update using (auth.uid() = owner_id) with check (owner_id is null or owner_id = auth.uid())';
end $$;

-- ---------- VIDEOS (public read non-deleted, owner writes) ----------
drop policy if exists "videos readable by all" on public.videos;
create policy "videos readable by all" on public.videos
  for select using (is_deleted = false or auth.uid() = user_id);
drop policy if exists "videos insert own" on public.videos;
create policy "videos insert own" on public.videos
  for insert with check (auth.uid() = user_id);
drop policy if exists "videos update own" on public.videos;
create policy "videos update own" on public.videos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "videos delete own" on public.videos;
create policy "videos delete own" on public.videos
  for delete using (auth.uid() = user_id);

-- ---------- VIDEO LIKES ----------
-- หมายเหตุ: แอปเขียนด้วย upsert(onConflict) → เดินทาง DO UPDATE เมื่อแถวมีอยู่
--           → ต้องมี policy ของ UPDATE ด้วย ไม่งั้นได้
--             "new row violates row-level security policy (USING expression)"
drop policy if exists "likes readable by all" on public.video_likes;
create policy "likes readable by all" on public.video_likes
  for select using (true);
drop policy if exists "likes insert own" on public.video_likes;
create policy "likes insert own" on public.video_likes
  for insert with check (auth.uid() = user_id);
drop policy if exists "likes update own" on public.video_likes;
create policy "likes update own" on public.video_likes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "likes delete own" on public.video_likes;
create policy "likes delete own" on public.video_likes
  for delete using (auth.uid() = user_id);

-- ---------- FOLLOWS ----------
drop policy if exists "follows readable by all" on public.follows;
create policy "follows readable by all" on public.follows
  for select using (true);
drop policy if exists "follows insert own" on public.follows;
create policy "follows insert own" on public.follows
  for insert with check (auth.uid() = follower_id);
drop policy if exists "follows delete own" on public.follows;
create policy "follows delete own" on public.follows
  for delete using (auth.uid() = follower_id);

-- ---------- VIDEO SAVES (private to the user) ----------
-- หมายเหตุ: แอปเขียนด้วย upsert(onConflict) → เดินทาง DO UPDATE เมื่อแถวมีอยู่
--           → ต้องมี policy ของ UPDATE ด้วย ไม่งั้นได้
--             "new row violates row-level security policy (USING expression)"
drop policy if exists "saves select own" on public.video_saves;
create policy "saves select own" on public.video_saves
  for select using (auth.uid() = user_id);
drop policy if exists "saves insert own" on public.video_saves;
create policy "saves insert own" on public.video_saves
  for insert with check (auth.uid() = user_id);
drop policy if exists "saves update own" on public.video_saves;
create policy "saves update own" on public.video_saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "saves delete own" on public.video_saves;
create policy "saves delete own" on public.video_saves
  for delete using (auth.uid() = user_id);

-- ---------- COMMENTS (public read, owner writes) ----------
drop policy if exists "comments readable by all" on public.comments;
create policy "comments readable by all" on public.comments
  for select using (true);
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments
  for insert with check (auth.uid() = user_id);
drop policy if exists "comments update own" on public.comments;
create policy "comments update own" on public.comments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments
  for delete using (auth.uid() = user_id);

-- ---------- FOLDERS (owner or collaborator) ----------
--
-- ⚠️ ห้ามอ้างตารางข้ามกันใน policy ของโฟลเดอร์โดยตรง
--    (เดิม: folders → folder_collaborators → folders → …)
--    → Postgres ตอบ 42P17 "infinite recursion detected in policy"
--    แก้โดยย้ายการตรวจสิทธิ์ข้ามตารางไปไว้ในฟังก์ชัน SECURITY DEFINER
--    (ฟังก์ชันรันด้วยสิทธิ์เจ้าของตาราง → ข้าม RLS → วงจรถูกตัด)
--    ดูรายละเอียด: supabase/migrations/fix_folders_policy_recursion.sql
--
create or replace function public.folder_owner_id(p_folder_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.owner_id
  from public.folders f
  where f.id = p_folder_id
  limit 1;
$$;

create or replace function public.is_folder_member(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.folders f
    where f.id = p_folder_id
      and (
        f.owner_id = auth.uid()
        or exists (
          select 1
          from public.folder_collaborators fc
          where fc.folder_id = f.id
            and fc.user_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.is_folder_public(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.folders f
    where f.id = p_folder_id
      and f.is_public = true
  );
$$;

create or replace function public.can_write_folder(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.folders f
    where f.id = p_folder_id
      and (
        f.owner_id = auth.uid()
        or exists (
          select 1
          from public.folder_collaborators fc
          where fc.folder_id = f.id
            and fc.user_id = auth.uid()
            and fc.permission = 'editor'
        )
      )
  );
$$;

drop policy if exists "folders select own or shared" on public.folders;
create policy "folders select own or shared" on public.folders
  for select using (
    auth.uid() = owner_id
    or is_public = true
    or public.is_folder_member(id)
  );
drop policy if exists "folders insert own" on public.folders;
create policy "folders insert own" on public.folders
  for insert with check (auth.uid() = owner_id);
drop policy if exists "folders update own" on public.folders;
create policy "folders update own" on public.folders
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "folders delete own" on public.folders;
create policy "folders delete own" on public.folders
  for delete using (auth.uid() = owner_id);

drop policy if exists "folder_collab select" on public.folder_collaborators;
create policy "folder_collab select" on public.folder_collaborators
  for select using (
    auth.uid() = user_id
    or public.folder_owner_id(folder_id) = auth.uid()
  );
drop policy if exists "folder_collab manage by owner" on public.folder_collaborators;
create policy "folder_collab manage by owner" on public.folder_collaborators
  for all using (public.folder_owner_id(folder_id) = auth.uid())
  with check (public.folder_owner_id(folder_id) = auth.uid());

drop policy if exists "folder_items select via folder" on public.folder_items;
create policy "folder_items select via folder" on public.folder_items
  for select using (
    public.is_folder_member(folder_id)
    or public.is_folder_public(folder_id)
  );
drop policy if exists "folder_items write via folder" on public.folder_items;
create policy "folder_items write via folder" on public.folder_items
  for all using (public.can_write_folder(folder_id))
  with check (public.can_write_folder(folder_id));

-- ---------- CHATS (members only) ----------
drop policy if exists "chats select members" on public.chats;
create policy "chats select members" on public.chats
  for select using (
    exists (select 1 from public.chat_members m where m.chat_id = id and m.user_id = auth.uid())
  );
drop policy if exists "chats insert" on public.chats;
create policy "chats insert" on public.chats
  for insert with check (auth.uid() = created_by);

drop policy if exists "chat_members select own chats" on public.chat_members;
create policy "chat_members select own chats" on public.chat_members
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.chat_members m2 where m2.chat_id = chat_id and m2.user_id = auth.uid())
  );
drop policy if exists "chat_members insert" on public.chat_members;
create policy "chat_members insert" on public.chat_members
  for insert with check (
    auth.uid() = user_id
    or exists (select 1 from public.chats c where c.id = chat_id and c.created_by = auth.uid())
  );

drop policy if exists "messages select members" on public.chat_messages;
create policy "messages select members" on public.chat_messages
  for select using (
    exists (select 1 from public.chat_members m where m.chat_id = id and m.user_id = auth.uid())
  );
drop policy if exists "messages insert members" on public.chat_messages;
create policy "messages insert members" on public.chat_messages
  for insert with check (
    auth.uid() = sender_id
    and exists (select 1 from public.chat_members m where m.chat_id = chat_id and m.user_id = auth.uid())
  );

-- ---------- NOTIFICATIONS (recipient only) ----------
drop policy if exists "notifications select own" on public.notifications;
create policy "notifications select own" on public.notifications
  for select using (auth.uid() = user_id);
drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications
  for update using (auth.uid() = user_id);

-- ---------- TRIP PLANS (creator) ----------
drop policy if exists "trips select own or shared" on public.trip_plans;
create policy "trips select own or shared" on public.trip_plans
  for select using (auth.uid() = creator_id or is_shared = true);
drop policy if exists "trips write own" on public.trip_plans;
create policy "trips write own" on public.trip_plans
  for all using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

-- ---------- BOOKINGS ----------
drop policy if exists "bookings select own or host" on public.bookings;
create policy "bookings select own or host" on public.bookings
  for select using (
    auth.uid() = tourist_id
    or exists (select 1 from public.communities c where c.id = community_id and c.host_user_id = auth.uid())
  );
drop policy if exists "bookings insert own" on public.bookings;
create policy "bookings insert own" on public.bookings
  for insert with check (auth.uid() = tourist_id);
drop policy if exists "bookings update own or host" on public.bookings;
create policy "bookings update own or host" on public.bookings
  for update using (
    auth.uid() = tourist_id
    or exists (select 1 from public.communities c where c.id = community_id and c.host_user_id = auth.uid())
  );

-- ---------- PASSPORT STAMPS ----------
drop policy if exists "stamps select own" on public.passport_stamps;
create policy "stamps select own" on public.passport_stamps
  for select using (auth.uid() = tourist_id);
drop policy if exists "stamps insert own" on public.passport_stamps;
create policy "stamps insert own" on public.passport_stamps
  for insert with check (auth.uid() = tourist_id);

-- ============================================================
--  ตรวจผลหลังรัน (optional)
-- ------------------------------------------------------------
--  select tablename, count(*) as policies
--  from pg_policies
--  where schemaname = 'public'
--  group by tablename
--  order by tablename;
--
--  ต้องได้:
--    bookings 3 · chat_members 2 · chat_messages 2 · chats 2
--    comments 4 · communities 2 · community_places 3
--    community_registrations 3 · folder_collaborators 2
--    folder_items 2 · folders 4 · follows 3 · notifications 2
--    passport_stamps 2 · services 2 · trip_plans 2 · users 2
--    video_likes 4 · video_saves 4 · videos 4
-- ============================================================
