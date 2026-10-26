-- ============================================================
--  Fix — GRANT ระดับตารางที่ `service_role` (และ `anon`) ขาด
--  Run in Supabase SQL Editor (ปลอดภัย รันซ้ำได้)
-- ------------------------------------------------------------
--  อาการ (backend/scripts/db_access_check.ts):
--    GET /rest/v1/users → HTTP 403
--    { "code":"42501",
--      "message":"permission denied for table users",
--      "hint":"Grant the required privileges to the current role with:
--              GRANT SELECT ON public.users TO service_role;" }
--
--  ตัวที่ชี้ว่า "ไม่ใช่ key ผิด":
--    • JWT ถูกถอดสำเร็จ → role = service_role (PostgREST ปฏิเสธถ้า key นอกโปรเจกต์)
--    • GET /rest/v1/ → HTTP 200 → บริการ PostgREST ยังทำงาน
--    • error มาจาก Postgres เอง (code 42501 = insufficient_privilege)
--      ไม่ใช่ 401 (token ใช้ไม่ได้) และไม่ใช่ 404 (ไม่มีตาราง)
--
--  และ "ไม่ใช่ปัญหา RLS":
--    service_role เป็น BYPASSRLS อยู่แล้ว → RLS คุมแค่ "อ่านแถวไหนได้"
--    ไม่ใช่ "มีสิทธิ์แตะตารางนี้ไหม" ถ้าไม่มี GRANT ก็ 403 ทั้งที่บัญชีแตะตารางนี้
--    การเปิด policy เพิ่มจึงไม่ช่วยอะไร ต้อง GRANT
--
--  ทำไมถึงขาด:
--    ในโปรเจกต์นี้ยังไม่มี migration ไหน grant สิทธิ์ระดับตารางเลย
--    (grep "grant" เจอแค่ `grant execute on function ... to service_role`)
--    → ตารางที่สร้างจาก SQL Editor ไม่ได้ grant ให้ service_role อัตโนมัติ
--    → ตารางที่ dashboard เป็นคนสร้าง (users/places/videos/communities) ยังอ่านได้
--      ด้วย anon แต่ service_role ใช้ไม่ได้
--    → community_places อ่านด้วย anon ไม่ได้ ทั้งที่ policy "Allow public read
--      access on community_places" ตั้งไว้แล้ว (policy ทำงานได้ก็ต่อเมื่อมี GRANT)
--
--  ผลหลังรัน:
--    • backend ที่ใช้ service_role อ่าน/เขียนได้ทุกตาราง (seed/backfill/บันทึกสถานที่)
--    • แอปอ่าน communities/community_places ผ่าน anon key ได้ (เหมาะกับ policy ที่ตั้งไว้)
-- ============================================================

-- ─────────────────────────────────────────────────────────────────
--  0) ตรวจสถานะก่อน (optional — รันดูความเป็นจริงก่อนจะแก้)
--     ผลที่ "โดนปัญหา" จะเห็นเป็น — ไม่มี grant ใครเลย
-- ─────────────────────────────────────────────────────────────────
-- select t.tablename,
--        coalesce(
--          string_agg(g.grantee || ':' || g.privilege_type, ', ' order by g.grantee, g.privilege_type),
--          '(ไม่มี grant ให้ role ไหนเลย)'
--        ) as grants
-- from pg_tables t
-- left join information_schema.role_table_grants g
--   on g.table_schema = t.schemaname and g.table_name = t.tablename
-- where t.schemaname = 'public'
-- group by t.tablename
-- order by t.tablename;

-- ─────────────────────────────────────────────────────────────────
--  1) service_role — อ่าน/เขียนทุกตารางใน public
--     (ข้าม RLS อยู่แล้ว แต่ยังต้องมี GRANT ถึงจะแตะตารางได้)
-- ─────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all routines in schema public to service_role;

-- ตาราง/ฟังก์ชันที่จะสร้างใน migration ถัดไป → ต้องมี grant อัตโนมัติ
-- (คำสั่งนี้มีผลกับ object ที่สร้างโดย role ที่รันคำสั่งนี้ = postgres ใน SQL Editor)
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on routines to service_role;

-- ─────────────────────────────────────────────────────────────────
--  2) anon / authenticated — อ่านตารางที่ policy เปิดให้สาธารณะ
--
--     หมายเหตุเรื่องสิทธิ์เขียน: ให้ SELECT อย่างเดียว
--     ทุกการเขียน community_places เดินผ่าน backend (service_role) หรือ RPC
--     `host_save_business_profile` อยู่แล้ว → ไม่ต้องเปิด INSERT/UPDATE
--     ให้ role ฝั่งผู้ใช้ (RLS policy ยังคงอยู่เป็นชั้นป้องกันที่สอง)
-- ─────────────────────────────────────────────────────────────────
grant select on public.communities to anon, authenticated;
grant select on public.community_places to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────
--  3) ตรวจผลหลังรัน — ต้องเห็น service_role ในทุกตาราง
-- ─────────────────────────────────────────────────────────────────
-- select t.tablename,
--        coalesce(
--          string_agg(distinct g.grantee, ', '),
--          '(ไม่มี grant ให้ role ไหนเลย)'
--        ) as roles_with_grant
-- from pg_tables t
-- left join information_schema.role_table_grants g
--   on g.table_schema = t.schemaname and g.table_name = t.tablename
-- where t.schemaname = 'public'
-- group by t.tablename
-- order by t.tablename;
--
-- ตรวจผ่านภายนอก (ต้องเห็น HTTP 200 ไม่ใช่ 403):
--   cd backend
--   npx ts-node --transpile-only scripts/db_access_check.ts
