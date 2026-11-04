-- ============================================================
--  Local app — ตรวจว่า migration ครบและถูกต้องไหม
--  Run in Supabase SQL Editor (read-only — ไม่แก้อะไร)
-- ------------------------------------------------------------
--  รันหลังรันครบทั้ง 20 ไฟล์:
--    1 schema · 2 create_community_places · 3 add_place_matching
--    4 add_community_places_structured · 5 place_facts · 6 price_level
--    7 add_otop_registration · 8 host_business_profile · 9 host_business_hours
--    10 add_places_table · 11 add_folders · 12 add_ai_summary_accuracy
--    13 create_video_ai_analyses · 14 fix_video_ai_analyses_rls
--    15 add_google_place_cache · 16 add_account_delete_scope
--    17 add_account_hard_delete · 18 policies · 19 storage · 20 fix_role_grants
--
--  ✅ ผลที่ถูกต้อง: ตาราง 24 · policy ใน public 61 · policy ของ storage 8
--     (google_place_cache = 0 policy โดยตั้งใจ → ให้ backend อย่างเดียว)
--
--  หมายเหตุเรื่องนับ: policy ชื่อเดียวกันบนตารางเดียวกันมีได้ตัวเดียว
--  → แม้ policies.sql กับ add_folders.sql จะสร้าง policy ชื่อซ้ำกัน
--    ผลสุดท้ายก็นับได้ตามรายชื่อที่ "หลังสุดท้าย" เท่านั้น
--    (video_ai_analyses = 3: create_video_ai_analyses.sql สร้าง 3
--     แต่ fix_video_ai_analyses_rls.sql ลบ "Anyone can read..." ทิ้งแล้วเพิ่ม
--     "Owners can read..." → เหลือ insert/update/read รวม 3)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) ตาราง + policy แยกตามตาราง (ตัวหลักของการตรวจ)
-- ─────────────────────────────────────────────────────────────
with expected(tablename, policies) as (
  values
    ('bookings', 3),
    ('chat_members', 2),
    ('chat_messages', 2),
    ('chats', 2),
    ('comments', 4),
    ('communities', 2),
    ('community_places', 3),
    ('community_registrations', 3),
    ('folder_collaborators', 2),
    ('folder_items', 2),
    ('folders', 4),
    ('follows', 3),
    ('google_place_cache', 0),
    ('notifications', 2),
    ('passport_stamps', 2),
    ('places', 2),
    ('services', 2),
    ('trip_plans', 2),
    ('user_saved_places', 4),
    ('users', 2),
    ('video_ai_analyses', 3),
    ('video_likes', 3),
    ('video_saves', 3),
    ('videos', 4)
)
select
  e.tablename,
  case
    when t.tablename is null              then '❌ ไม่มีตาราง'
    when pc.cnt is distinct from e.policies then '⚠️ policy ไม่ตรง'
    else '✅'
  end as status,
  coalesce(pc.cnt, 0) as policy_ตอนนี้,
  e.policies as policy_ที่ต้องมี
from expected e
left join pg_tables t
  on t.schemaname = 'public' and t.tablename = e.tablename
left join (
  select tablename, count(*) as cnt
  from pg_policies
  where schemaname = 'public'
  group by tablename
) pc on pc.tablename = e.tablename
order by e.tablename;

-- ─────────────────────────────────────────────────────────────
-- 2) สรุปตัวเลข (ต้องได้ 24 ตาราง / 59 policy)
-- ─────────────────────────────────────────────────────────────
select
  (select count(*) from pg_tables where schemaname = 'public') as ตารางใน_public,
  (select count(*) from pg_policies where schemaname = 'public') as policy_ทั้งหมด,
  (select count(*) from pg_policies where schemaname = 'storage') as policy_ของ_storage;

-- ─────────────────────────────────────────────────────────────
-- 3) ตารางที่ "เกิน" — ต้องได้ 0 แถว
--    (ถ้ามี แปลว่ามีตารางอยู่ในโปรเจกต์ที่ไม่ได้มาจากไฟล์ของเรา
--     เช่นตารางที่เคยสร้างมือใน dashboard — ควรตัดสินใจว่าจะเก็บหรือลบ)
-- ─────────────────────────────────────────────────────────────
select tablename
from pg_tables
where schemaname = 'public'
  and tablename not in (
    'bookings','chat_members','chat_messages','chats','comments','communities',
    'community_places','community_registrations','folder_collaborators','folder_items',
    'folders','follows','google_place_cache','notifications','passport_stamps','places',
    'services','trip_plans','user_saved_places','users','video_ai_analyses',
    'video_likes','video_saves','videos'
  )
order by tablename;

-- ─────────────────────────────────────────────────────────────
-- 4) Storage buckets — ต้องได้ 2 (avatars, videos) และเป็น public
-- ─────────────────────────────────────────────────────────────
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

-- ─────────────────────────────────────────────────────────────
-- 5) FK ที่แก้กฎ "ลบบัญชี = ลบแค่ของตัวเอง" (ข้อ 16)
--    communities.host_user_id ต้องเป็น set null · user_saved_places.user_id ต้องเป็น cascade
-- ─────────────────────────────────────────────────────────────
select
  con.conrelid::regclass::text as table_name,
  con.conname,
  case con.confdeltype
    when 'c' then 'cascade'
    when 'n' then 'set null'
    when 'r' then 'restrict'
    when 'a' then 'no action'
    else con.confdeltype::text
  end as on_delete
from pg_constraint con
where con.contype = 'f'
  and con.conrelid::regclass::text in ('communities', 'user_saved_places')
  and con.conname in ('communities_host_user_id_fkey', 'user_saved_places_user_id_fkey')
order by table_name;

-- ─────────────────────────────────────────────────────────────
-- 6) RPC ลบบัญชี (ข้อ 17) — ต้องมี 1 แถว และ service_role เรียกได้
-- ─────────────────────────────────────────────────────────────
select
  p.proname,
  p.prosecdef as เป็น_security_definer,
  has_function_privilege('service_role', p.oid, 'execute') as service_role_เรียกได้,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_เรียกได้
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'account_hard_delete';

-- ─────────────────────────────────────────────────────────────
-- 7) ดูภาพรวมทั้งหมด — ใช้ตอนมีตารางที่ policy ไม่ตรง
--    จะเห็นทันทีว่า policy ตัวไหน "เกิน" (ชื่อไม่ใช่ของเรา เช่น policy ที่
--    ถูกสร้างจาก Dashboard ตอนสร้างตาราง) และตารางไหน policy ยังไม่ครบ
-- ─────────────────────────────────────────────────────────────
select
  t.tablename,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.tablename) as policies,
  (select string_agg(p.policyname, ' | ' order by p.policyname)
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.tablename) as รายชื่อ_policy
from pg_tables t
where t.schemaname = 'public'
group by t.tablename
order by t.tablename;
