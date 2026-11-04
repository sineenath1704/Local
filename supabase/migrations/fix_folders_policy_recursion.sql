-- ============================================================
--  Fix — infinite recursion ใน RLS policy ของตารางโฟลเดอร์
--  Run in Supabase SQL Editor (ปลอดภัย รันซ้ำได้)
-- ------------------------------------------------------------
--  อาการ:
--    WARN [folder] createFolder DB FAILED:
--    createFolder: infinite recursion detected in policy for relation "folders"
--    (Postgres 42P17)
--
--  ทำไมถึงพัง:
--    policy ของสองตารางวนกัน (cycle) → Postgres ตัดวงเป็น 42P17
--
--      folders (SELECT policy)
--        └─ exists (select 1 from folder_collaborators fc …)
--             └─ folder_collaborators (policy "folder_collab manage by owner")
--                  └─ exists (select 1 from folders f …)
--                       └─ folders (SELECT policy)   ← วนกลับมาเริ่มใหม่ → ∞
--
--    ทำไมถึงโผล่ตอน "สร้างโฟลเดอร์" (INSERT) ทั้งที่ policy ของ INSERT
--    ไม่ได้อ้างตารางอื่นเลย:
--      • PostgREST คืนแถวที่เพิ่ง insert ด้วย `Prefer: return=representation`
--        → SQL ที่จริงคือ `INSERT … RETURNING *`
--      • Postgres ใช้ **SELECT policy** ตรวจแถวที่จะคืนกลับใน RETURNING
--        → เข้า policy ของ folders → เข้าวงจร recursion
--      • และแม้แต่ `SELECT * FROM folders` ธรรมดาก็พัง (getMyFolders,
--        getFloatingClips, unsaveClipCompletely) รวมถึง folder_items ที่
--        policy อ้าง folders → folder_collaborators → folders
--
--  ทำไมถึงเพิ่งพังตอนนี้ (ไม่ใช่ของใหม่):
--    ก่อนหน้านี้ตาราง folders ไม่มี GRANT ระดับตารางให้ role ฝั่งแอป
--    → ติด 42501 "permission denied for table folders" ตั้งแต่ชั้นก่อน RLS
--    → RLS เลยไม่เคยถูกประเมิน → วงจร recursion ซ่อนอยู่
--    พอรัน fix_app_role_grants.sql แล้ว → เข้าไปถึงชั้น RLS → เจอวงจร
--
--  วิธีแก้ (คงพฤติกรรมเดิมทุกอย่าง):
--    ย้ายการตรวจข้ามตาราง (เจ้าของ / สมาชิก / สาธารณะ / เขียนได้ไหม)
--    ไปไว้ในฟังก์ชัน `SECURITY DEFINER`
--      → ฟังก์ชันรันด้วยสิทธิ์ของเจ้าของฟังก์ชัน (เจ้าของตาราง)
--        → ข้าม RLS ของตารางที่มัน query → วงจรถูกตัด
--      → สิทธิ์เดิมยังอยู่ครบ: เจ้าของ · ผู้ร่วมงาน (viewer/editor)
--        · โฟลเดอร์สาธารณะ · อ่าน/เขียน folder_items
--
--  ผลหลังรัน:
--    • สร้างโฟลเดอร์ได้ · เห็นโฟลเดอร์ของตัวเองได้ · เพิ่ม/ลบคลิปในโฟลเดอร์ได้
--    • ไลก์ · เซฟ · คอมเมนต์ ไม่ได้แตะ (ไม่มีวงจร recursion)
-- ============================================================

-- ─────────────────────────────────────────────────────────────────
-- 1) ฟังก์ชันช่วยตรวจสิทธิ์โฟลเดอร์ (SECURITY DEFINER → ข้าม RLS)
--
--    ความสำคัญ:
--      • `security definer`  → รันด้วยสิทธิ์เจ้าของฟังก์ชัน
--        (เจ้าของตาราง) → ไม่ตกใต้ RLS ของ folders / folder_collaborators
--      • `set search_path = public, pg_temp` → กันการโจมตีผ่าน search_path
--      • ผู้เรียกจาก policy ยังต้องมีสิทธิ์ EXECUTE → grant ท้ายไฟล์
-- ─────────────────────────────────────────────────────────────────

-- เจ้าของโฟลเดอร์ (null = ไม่มีโฟลเดอร์นี้)
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

-- ผู้ใช้เป็นเจ้าของ หรือ ผู้ร่วมงาน (ไม่สน permission) ของโฟลเดอร์ไหม
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

-- โฟลเดอร์เป็นสาธารณะไหม
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

-- เขียนในโฟลเดอร์ได้ไหม (เจ้าของ หรือ ผู้ร่วมงาน permission='editor')
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

-- ─────────────────────────────────────────────────────────────────
-- 2) policy ใหม่ — ไม่มีการอ้างตารางอื่นข้ามกันอีกแล้ว
-- ─────────────────────────────────────────────────────────────────

-- FOLDERS
drop policy if exists "folders select own or shared" on public.folders;
create policy "folders select own or shared" on public.folders
  for select using (
    auth.uid() = owner_id
    or is_public = true
    or public.is_folder_member(id)
  );

-- FOLDER COLLABORATORS
drop policy if exists "folder_collab select" on public.folder_collaborators;
create policy "folder_collab select" on public.folder_collaborators
  for select using (
    auth.uid() = user_id
    or public.folder_owner_id(folder_id) = auth.uid()
  );

drop policy if exists "folder_collab manage by owner" on public.folder_collaborators;
create policy "folder_collab manage by owner" on public.folder_collaborators
  for all
  using (public.folder_owner_id(folder_id) = auth.uid())
  with check (public.folder_owner_id(folder_id) = auth.uid());

-- FOLDER ITEMS
drop policy if exists "folder_items select via folder" on public.folder_items;
create policy "folder_items select via folder" on public.folder_items
  for select using (
    public.is_folder_member(folder_id)
    or public.is_folder_public(folder_id)
  );

drop policy if exists "folder_items write via folder" on public.folder_items;
create policy "folder_items write via folder" on public.folder_items
  for all
  using (public.can_write_folder(folder_id))
  with check (public.can_write_folder(folder_id));

-- ─────────────────────────────────────────────────────────────────
-- 3) GRANT — policy เรียกฟังก์ชันเหล่านี้ ผู้เรียกต้องมีสิทธิ์ EXECUTE
--    (ตารางโฟลเดอร์มีแต่ authenticated ที่เข้าถึงได้ → grant ให้ authenticated)
-- ─────────────────────────────────────────────────────────────────
revoke all on function public.folder_owner_id(uuid) from public;
revoke all on function public.is_folder_member(uuid) from public;
revoke all on function public.is_folder_public(uuid) from public;
revoke all on function public.can_write_folder(uuid) from public;

grant execute on function public.folder_owner_id(uuid) to authenticated;
grant execute on function public.is_folder_member(uuid) to authenticated;
grant execute on function public.is_folder_public(uuid) to authenticated;
grant execute on function public.can_write_folder(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 4) ตรวจผลหลังรัน (optional)
--
--    4.1) policy ของโฟลเดอร์ต้องไม่มีคำว่า 'from public.folders' / 'from public.folder_collaborators'
--         ในเงื่อนไข (ถ้ายังมี → ยังไม่ได้รันไฟล์นี้ หรือมี policy ตัวอื่นที่ยังวนอยู่)
--    select policyname, qual, with_check
--    from pg_policies
--    where schemaname = 'public'
--      and tablename in ('folders','folder_items','folder_collaborators')
--    order by tablename, policyname;
--
--    4.2) ฟังก์ชันต้องมี 4 ตัว
--    select proname, prosecdef
--    from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and proname in ('folder_owner_id','is_folder_member','is_folder_public','can_write_folder');
--
--    4.3) ทดสอบจริงจากแอป: กดสร้างโฟลเดอร์ → ต้องไม่ขึ้น 42P17
-- ============================================================
