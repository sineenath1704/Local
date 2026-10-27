-- ============================================================
--  Migration — โฟลเดอร์คลิป + แพลนทริป (folders / folder_items /
--  folder_collaborators / trip_plans)
--  Run in Supabase SQL Editor (ปลอดภัย รันซ้ำได้)
-- ------------------------------------------------------------
--  ทำไมต้องมีไฟล์นี้:
--    ตาราง 4 ตารางนี้มี DDL ใน `supabase/schema.sql` และมี RLS ใน
--    `supabase/policies.sql` แต่ **ไม่เคยมี migration** → ในโปรเจกต์จริง
--    อาจไม่มีตารางเลย (หรือมีครบเกือบ แต่ขาด grant / constraint)
--
--  ผลของการ "ไม่มีตาราง":
--    • ปุ่มบันทึกคลิปลงโฟลเดอร์กลืน error แล้วดูเหมือนทำงาน (getMyFolders
--      คืน [] เงียบ ๆ) → ผู้ใช้เข้าใจว่าบันทึกไม่ได้
--    • ตัวสร้างแพลนทริปเขียน `trip_plans` ไม่ได้ → แพลนหายเมื่อปิดแอป
--
--  ข้อสำคัญ (เรียนจาก fix_role_grants.sql):
--    ตารางที่สร้างผ่าน SQL Editor **ไม่ได้ grant อัตโนมัติ**
--    → ถ้าไม่มี grant จะได้ `42501 permission denied for table folders`
--    → ฟีเจอร์ตายทันทีแบบเงียบ ๆ จึงต้อง grant ในไฟล์นี้ด้วย
--
--  ไฟล์นี้ **ไม่แก้ migration เดิมที่รันไปแล้ว** — เพิ่มไฟล์ใหม่เท่านั้น
-- ============================================================

-- ─────────────────────────────────────────────────────────────────
--  0) เตรียมสิทธิ์ระดับ schema
--     (จำเป็น: role ที่รัน SQL Editor = postgres → object ที่สร้าง
--      ในไฟล์นี้จะได้ grant ตาม alter default privileges ด้วย)
-- ─────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on routines to service_role;

-- ─────────────────────────────────────────────────────────────────
--  1) ตารางโฟลเดอร์
--     DDL ตรงกับ supabase/schema.sql:171-193
--     (หมายเหตุ: FK ไป `public.videos` ใส่ทีหลังแบบมีเงื่อนไข เผื่อโปรเจกต์
--      ยังไม่มีตาราง videos — ดู §2)
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name varchar(100) not null,
  is_public boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.folder_collaborators (
  folder_id uuid not null references public.folders(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  permission varchar(20) default 'viewer' check (permission in ('viewer', 'editor')),
  primary key (folder_id, user_id)
);

create table if not exists public.folder_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  video_id uuid not null,
  added_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  unique (folder_id, video_id)
);

create table if not exists public.trip_plans (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid,
  creator_id uuid not null references public.users(id) on delete cascade,
  source_folder_id uuid references public.folders(id) on delete set null,
  plan_name varchar(100) not null,
  start_location text not null,
  return_location text,
  start_date date,
  end_date date,
  budget_limit numeric(10,2),
  travel_style varchar(30),
  itinerary_data jsonb not null,
  status varchar(20) default 'draft' check (status in ('upcoming', 'draft', 'past')),
  is_shared boolean default false,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────
--  2) FK ที่ใส่แบบมีเงื่อนไข
--     • `videos` / `chats` อาจยังไม่มีในโปรเจกต์ → ข้ามไปก่อน
--     • ตารางที่มีอยู่แล้วอาจถูกสร้างโดยไม่มี constraint → เติมให้
--     • ทำซ้ำได้ (เช็ค pg_constraint ก่อน add)
-- ─────────────────────────────────────────────────────────────────
do $$
begin
  -- โฟลเดอร์ → คลิป (ต้องมี ไม่งั้นลบคลิป/โฟลเดอร์ไม่ cascade)
  if to_regclass('public.videos') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.folder_items'::regclass
         and conname = 'folder_items_video_id_fkey'
     ) then
    alter table public.folder_items
      add constraint folder_items_video_id_fkey
      foreign key (video_id) references public.videos(id) on delete cascade;
  end if;

  -- แผนทริป → แชท (ยังไม่มีตาราง chats → เก็บเป็น NULL ได้)
  if to_regclass('public.chats') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.trip_plans'::regclass
         and conname = 'trip_plans_chat_id_fkey'
     ) then
    alter table public.trip_plans
      add constraint trip_plans_chat_id_fkey
      foreign key (chat_id) references public.chats(id) on delete set null;
  end if;

  -- unique (folder_id, video_id) — จำเป็นมาก เพราะแอปใช้
  -- `upsert(..., { onConflict: "folder_id,video_id" })` เวลาย้ายคลิป
  -- (ถ้าไม่มี → error: there is no unique or exclusion constraint matching)
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.folder_items'::regclass
      and contype = 'u'
      and conname = 'folder_items_folder_id_video_id_key'
  ) then
    begin
      alter table public.folder_items
        add constraint folder_items_folder_id_video_id_key
        unique (folder_id, video_id);
    exception
      -- มีอยู่แล้ว (ชื่อชน) → ข้าม ไม่ต้อง error
      when duplicate_object then null;
    end;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────
--  3) ดัชนี (โฟลเดอร์ของฉัน / คลิปในโฟลเดอร์ / แผนของฉัน)
-- ─────────────────────────────────────────────────────────────────
create index if not exists idx_folders_owner on public.folders(owner_id);
create index if not exists idx_folder_items_folder on public.folder_items(folder_id);
create index if not exists idx_folder_items_video on public.folder_items(video_id);
create index if not exists idx_folder_collaborators_user
  on public.folder_collaborators(user_id);
create index if not exists idx_trip_plans_creator on public.trip_plans(creator_id);
create index if not exists idx_trip_plans_source_folder
  on public.trip_plans(source_folder_id);

-- ─────────────────────────────────────────────────────────────────
--  4) RLS + policy
--     คัดลอกจาก supabase/policies.sql:138-184, 222-225
--     (drop ก่อน create → รันซ้ำได้ ไม่ error "policy already exists")
-- ─────────────────────────────────────────────────────────────────
alter table public.folders enable row level security;
alter table public.folder_items enable row level security;
alter table public.folder_collaborators enable row level security;
alter table public.trip_plans enable row level security;

-- ---------- FOLDERS (เจ้าของ หรือ ผู้ร่วม, หรือ สาธารณะ) ----------
drop policy if exists "folders select own or shared" on public.folders;
create policy "folders select own or shared" on public.folders
  for select using (
    auth.uid() = owner_id
    or is_public = true
    or exists (select 1 from public.folder_collaborators fc where fc.folder_id = id and fc.user_id = auth.uid())
  );

drop policy if exists "folders insert own" on public.folders;
create policy "folders insert own" on public.folders
  for insert with check (auth.uid() = owner_id);

drop policy if exists "folders update own" on public.folders;
create policy "folders update own" on public.folders
  for update using (auth.uid() = owner_id);

drop policy if exists "folders delete own" on public.folders;
create policy "folders delete own" on public.folders
  for delete using (auth.uid() = owner_id);

-- ---------- FOLDER COLLABORATORS ----------
drop policy if exists "folder_collab select" on public.folder_collaborators;
create policy "folder_collab select" on public.folder_collaborators
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid())
  );

drop policy if exists "folder_collab manage by owner" on public.folder_collaborators;
create policy "folder_collab manage by owner" on public.folder_collaborators
  for all using (exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid()))
  with check (exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid()));

-- ---------- FOLDER ITEMS (อ่าน/เขียนผ่านสิทธิ์ของโฟลเดอร์) ----------
drop policy if exists "folder_items select via folder" on public.folder_items;
create policy "folder_items select via folder" on public.folder_items
  for select using (
    exists (
      select 1 from public.folders f
      where f.id = folder_id
        and (f.owner_id = auth.uid() or f.is_public = true
          or exists (select 1 from public.folder_collaborators fc where fc.folder_id = f.id and fc.user_id = auth.uid()))
    )
  );

drop policy if exists "folder_items write via folder" on public.folder_items;
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

-- ---------- TRIP PLANS (เจ้าของ หรือ แชร์) ----------
drop policy if exists "trips select own or shared" on public.trip_plans;
create policy "trips select own or shared" on public.trip_plans
  for select using (auth.uid() = creator_id or is_shared = true);

drop policy if exists "trips write own" on public.trip_plans;
create policy "trips write own" on public.trip_plans
  for all using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

-- ─────────────────────────────────────────────────────────────────
--  5) GRANT
--     • service_role = backend (อ่าน/เขียนทุกอย่าง, ข้าม RLS)
--     • authenticated = แอป (ผู้ใช้ที่ล็อกอิน) → เขียนได้เฉพาะของตัวเอง
--       ตาม RLS ข้างบน
--     • anon = ไม่ให้สิทธิ์กับโฟลเดอร์/แผนเลย (เป็นข้อมูลส่วนตัว)
-- ─────────────────────────────────────────────────────────────────
grant all on public.folders to service_role;
grant all on public.folder_items to service_role;
grant all on public.folder_collaborators to service_role;
grant all on public.trip_plans to service_role;

grant select, insert, update, delete on public.folders to authenticated;
grant select, insert, update, delete on public.folder_items to authenticated;
grant select, insert, update, delete on public.folder_collaborators to authenticated;
grant select, insert, update, delete on public.trip_plans to authenticated;

-- ─────────────────────────────────────────────────────────────────
--  6) คอมเมนต์ (อ่านง่ายตอน inspect schema ใน dashboard)
-- ─────────────────────────────────────────────────────────────────
comment on table public.folders is
  'โฟลเดอร์คลิปที่ผู้ใช้บันทึกไว้ — ใช้เป็นแหล่งข้อมูลให้ AI จัดแพลนทริป';
comment on table public.folder_items is
  'คลิปในแต่ละโฟลเดอร์ (ไม่ซ้ำภายในโฟลเดอร์เดียวกัน)';
comment on table public.folder_collaborators is
  'ผู้ที่ได้รับสิทธิ์ร่วมโฟลเดอร์ (viewer/editor)';
comment on table public.trip_plans is
  'แผนทริป — ผูกกับโฟลเดอร์ต้นทางผ่าน source_folder_id';
comment on column public.trip_plans.source_folder_id is
  'โฟลเดอร์ที่แพลนนี้มาจาก (null = สร้างเอง ไม่ได้มาจากโฟลเดอร์)';
comment on column public.trip_plans.status is
  'สถานะใน DB: upcoming|draft|past (ค่าของแอป draft|planned|active|completed เก็บที่ itinerary_data.__meta.appStatus)';
comment on column public.trip_plans.itinerary_data is
  'ข้อมูลแพลนดิบจากตัวสร้างแพลน + __meta (source, generatedAt, appStatus, destinations, folderPlaces)';

-- ─────────────────────────────────────────────────────────────────
--  7) ตรวจผลหลังรัน (optional)
-- ─────────────────────────────────────────────────────────────────
-- select t.tablename,
--        coalesce(string_agg(distinct g.grantee, ', '), '(ไม่มี grant ใครเลย)') as roles
-- from pg_tables t
-- left join information_schema.role_table_grants g
--   on g.table_schema = t.schemaname and g.table_name = t.tablename
-- where t.schemaname = 'public'
--   and t.tablename in ('folders','folder_items','folder_collaborators','trip_plans')
-- group by t.tablename
-- order by t.tablename;
--
-- ต้องเห็น service_role + authenticated ในทุกตาราง
-- (ถ้าเห็นแค่ service_role → ยังไม่ได้ grant ให้ authenticated → แอปจะ error
--  ตอนอ่าน/เขียนโฟลเดอร์)
--
-- ตรวจจากฝั่งแอป:
--   cd backend && npm run check:folder
