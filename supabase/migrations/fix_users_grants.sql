-- ============================================================
--  Fix — GRANT บน public.users ให้ role ฝั่งแอป (anon / authenticated)
--
--  ⚠️ ไฟล์นี้เป็นส่วนหนึ่งของชุดเดียวกัน — ใช้
--     supabase/migrations/fix_app_role_grants.sql แทนได้เลย
--     (ไฟล์นั้นครอบคลุมทุกตารางที่แอปแตะตรง ๆ รวมถึง users)
--
--  Run in Supabase SQL Editor (ปลอดภัย รันซ้ำได้)
-- ------------------------------------------------------------
--  อาการ (หน้าลงทะเบียน กด "บันทึก"):
--    { "code": "42501", "message": "permission denied for table users" }
--
--  ทำไมถึงเป็นแบบนี้ — ไม่ใช่ปัญหา RLS:
--    • ไม่มี GRANT ระดับตาราง → 403 "permission denied for table users"  ← อันนี้
--    • RLS ไม่ให้ผ่าน (WITH CHECK) → 403 "new row violates row-level security policy"
--    • RLS มีอยู่แต่ไม่เห็นแถว → 200 กับ [] (ไม่ error เลย)
--    → policy "users update own" ที่เขียนไว้ถูกต้องอยู่แล้ว
--      แต่ policy จะทำงาน "หลัง" จากที่ role มีสิทธิ์ระดับตาราง (PRIVILEGE)
--      ถ้าไม่มี GRANT → ไม่มี policy ไหนช่วยได้
--
--  ทำไมถึงขาด:
--    • ในโปรเจกต์นี้ยังไม่มีไฟล์ไหน grant บน public.users เลย
--      (grep "grant" เจอแค่ places · folders · folder_items · trip_plans)
--      → ตารางที่สร้างผ่าน SQL Editor ไม่ได้ grant ให้ role ฝั่งแอปอัตโนมัติ
--    • เพิ่งโผล่ตอนนี้เพราะครั้งนี้เป็นการ "เขียน" users ครั้งแรกจากแอป
--      (การอ่านก่อนหน้านี้ก็พังเงียบ ๆ เพราะโค้ดไม่เช็ค error —
--       isUsernameAvailable คืน "ชื่อว่าง" เมื่อ query ล้มเหลว
--       loadUserRow ตั้ง user = null เงียบ ๆ)
--
--  ผลหลังรัน:
--    • แอปเขียน users ได้ — ลงทะเบียน · แก้โปรไฟล์ · แก้ข้อมูลธุรกิจ ·
--      ขอสิทธิ์ host (claimHostRole)
--    • RLS ยังคุมไว้เหมือนเดิม → อัปเดตได้แค่แถวของตัวเอง
--      (policy "users update own" = auth.uid() = id)
-- ============================================================

-- ─────────────────────────────────────────────────────────────────
-- 0) ตรวจสถานะก่อน (optional — รันดูความเป็นจริงก่อนจะแก้)
--    ถ้าไม่เห็น "authenticated" ในรายการ → ยืนยันว่าเป็นสาเหตุ
-- ─────────────────────────────────────────────────────────────────
-- select g.grantee, g.privilege_type
-- from information_schema.role_table_grants g
-- where g.table_schema = 'public' and g.table_name = 'users'
-- order by g.grantee, g.privilege_type;
--
-- policy ของ users ต้องมีอยู่ (ถ้าไม่มี → รัน policies.sql ด้วย)
-- select policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public' and tablename = 'users';
--
-- ─────────────────────────────────────────────────────────────────
-- 1) GRANT — role ฝั่งแอป
-- ─────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;

-- อ่านได้: โปรไฟล์ของตัวเอง + ชื่อ/รูปของคนอื่นที่โผล่ในฟีด/คอมเมนต์
grant select on public.users to anon, authenticated;

-- แก้ไขได้แค่แถวตัวเอง (RLS policy คุมอีกชั้น)
grant update on public.users to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2) กันเหตุ "อัปเดตได้ 0 แถว" เงียบ ๆ
--    ถ้า trigger ของ auth.users หายไป แถว users จะไม่ถูกสร้างตอนสมัคร
--    → อัปเดตได้ 0 แถว (ไม่ error) → ผู้ใช้เข้าแอปแล้วไม่มีโปรไฟล์
--    ถ้าเจอ warning นี้ → รัน schema.sql (มี handle_new_user + trigger)
-- ─────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users'
      and t.tgname = 'on_auth_user_created'
      and not t.tgisinternal
  ) then
    raise warning 'ไม่พบ trigger on_auth_user_created บน auth.users — แถว public.users จะไม่ถูกสร้างตอนสมัคร (รัน schema.sql)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────
-- 3) ตรวจผลหลังรัน — ต้องเห็น authenticated มี select + update
-- ─────────────────────────────────────────────────────────────────
-- select g.grantee, g.privilege_type
-- from information_schema.role_table_grants g
-- where g.table_schema = 'public' and g.table_name = 'users'
-- order by g.grantee, g.privilege_type;
