-- ============================================================
--  Fix — GRANT ทุกตารางที่แอปแตะตรง ๆ ให้ role ฝั่งแอป (anon / authenticated)
--  Run in Supabase SQL Editor (ปลอดภัย รันซ้ำได้)
-- ------------------------------------------------------------
--  ⚠️ ต้องรันไฟล์นี้ **คู่กับ**:
--     • fix_folders_policy_recursion.sql  (policy โฟลเดอร์วนกัน → 42P17)
--     • fix_interaction_policies.sql      (policy ขาด UPDATE + trigger ไม่ใช่
--                                           SECURITY DEFINER → like/save พัง)
--     (ไฟล์นี้แก้ "ไม่มีสิทธิ์" · ไฟล์อื่นแก้ "policy/RLS พัง" ซึ่งจะโผล่
--      พอแอปมีสิทธิ์แล้ว)
-- ------------------------------------------------------------
--  อาการ:
--    หน้าลงทะเบียน:  { "code":"42501", "message":"permission denied for table users" }
--    โพสต์คลิป:     { "code":"42501", "message":"permission denied for table videos",
--                    "hint":"Grant the required privileges to the current role with:
--                            GRANT SELECT, INSERT ON public.videos TO authenticated;" }
--
--  ทำไมถึงเป็นแบบนี้ — ไม่ใช่ปัญหา RLS:
--    • ไม่มี GRANT ระดับตาราง → 403 "permission denied for table X"   ← อันนี้
--    • RLS ไม่ให้ผ่าน (WITH CHECK) → 403 "new row violates row-level security policy"
--    • มี GRANT แล้วแต่ไม่เห็นแถว → HTTP 200 กับ [] (ไม่มี error เลย)
--    → policy ที่เขียนไว้ถูกต้องทั้งหมด แต่ policy จะทำงาน "หลัง" จากที่
--      role มีสิทธิ์ระดับตาราง (PRIVILEGE) — ไม่มี GRANT = ไม่มี policy ไหนช่วยได้
--
--  ทำไมถึงขาด:
--    • ตารางที่สร้างผ่าน SQL Editor ไม่ได้ grant ให้ role ฝั่งแอปอัตโนมัติ
--    • โปรเจกต์นี้เคยแก้ทีละตาราง (places · folders · folder_items · trip_plans)
--      แต่ลืม public.users และตารางฝั่งคลิป (videos · video_likes ·
--      video_saves · video_ai_analyses · user_saved_places)
--    • แอปเขียนตรงจาก client ทุกตารางในรายการด้านล่างนี้
--
--  ขอบเขต: grant เฉพาะตารางที่แอปแตะเอง — ตารางที่ backend จัดการ
--  (follows · bookings · chats · notifications · account_hard_delete)
--  ไม่แตะ เพราะ backend ใช้ service_role (ข้าม RLS อยู่แล้ว)
--  (comments แตะเอง — แอปเขียนคอมเมนต์/ตอบกลับจาก client)
--
--  ผลหลังรัน:
--    • ลงทะเบียน · โพสต์คลิป · กดไลก์ · บันทึกในโฟลเดอร์ · บันทึกสถานที่
--      · เขียนคอมเมนต์/ตอบกลับ (คอมเมนต์ที่เขียนแล้วจะไม่หายอีก)
--      ทำงานได้จากแอป
--    • RLS ยังคุมไว้เหมือนเดิมทุกตาราง → เขียนได้แค่แถวของตัวเอง
--      (anon อ่านได้เฉพาะของสาธารณะตาม policy ที่เขียนไว้)
-- ============================================================

-- ─────────────────────────────────────────────────────────────────
-- 0) ตรวจสถานะก่อน (optional)
--    ตารางที่ role ไหนมีสิทธิ์อะไรบ้าง
-- ─────────────────────────────────────────────────────────────────
-- select t.tablename, g.grantee, g.privilege_type
-- from pg_tables t
-- left join information_schema.role_table_grants g
--   on g.table_schema = t.schemaname and g.table_name = t.tablename
-- where t.schemaname = 'public'
--   and t.tablename in ('users','videos','video_likes','video_saves',
--                       'video_ai_analyses','user_saved_places','folders',
--                       'folder_items','folder_collaborators','trip_plans',
--                       'communities','places','comments')
-- order by t.tablename, g.grantee, g.privilege_type;

-- ─────────────────────────────────────────────────────────────────
-- 1) schema
-- ─────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 2) คอลัมน์ที่แอป insert ใช้ แต่ไม่ได้อยู่ใน schema.sql
--    (มาจาก add_places_table.sql + add_ai_summary_accuracy.sql)
--    ถ้ารันสองไฟล์นั้นแล้ว → ทั้งสองบรรทัดนี้ไม่ทำอะไร
--    ถ้ายังไม่รัน → จะได้ error 42703 "column ... does not exist" ตอนโพสต์คลิป
-- ─────────────────────────────────────────────────────────────────
alter table public.videos
  add column if not exists place_name varchar(200),
  add column if not exists place_id uuid references public.places(id) on delete set null,
  add column if not exists ai_summary_accuracy int
    check (ai_summary_accuracy is null or (ai_summary_accuracy >= 1 and ai_summary_accuracy <= 5));

-- ─────────────────────────────────────────────────────────────────
-- 3) อ่านอย่างเดียว (บทบาทที่ยังไม่ล็อกอิน — เนื้อหาสาธารณะ)
--    ตรงกับ policy ที่เปิดไว้: users readable by all · videos readable by all
--    · likes readable by all · communities readable by all · places
-- ─────────────────────────────────────────────────────────────────
grant select on public.users             to anon;
grant select on public.videos            to anon;
grant select on public.video_likes       to anon;
grant select on public.communities       to anon;
grant select on public.places            to anon;
grant select on public.comments          to anon;

-- ─────────────────────────────────────────────────────────────────
-- 4) ผู้ใช้ที่ล็อกอินแล้ว — สิทธิ์ตาม policy ของแต่ละตารางพอดี
-- ─────────────────────────────────────────────────────────────────

-- โปรไฟล์: อ่านได้ทุกคน · แก้ได้แค่แถวตัวเอง
grant select on public.users             to authenticated;
grant update on public.users             to authenticated;

-- คลิป: อ่านได้ · ลงคลิปของตัวเอง · แก้/ลบของตัวเอง
grant select on public.videos            to authenticated;
grant insert on public.videos            to authenticated;
grant update on public.videos            to authenticated;
grant delete on public.videos            to authenticated;

-- ไลก์: อ่านได้ · กดไลก์ · เอาไลก์ออก
grant select on public.video_likes       to authenticated;
grant insert on public.video_likes       to authenticated;
grant delete on public.video_likes       to authenticated;

-- เซฟคลิป (upsert → ต้องมีทั้ง insert และ update)
grant select on public.video_saves       to authenticated;
grant insert on public.video_saves       to authenticated;
grant update on public.video_saves       to authenticated;
grant delete on public.video_saves       to authenticated;

-- ผลวิเคราะห์ AI ของคลิป (แอปเขียนตอนโพสต์ · เจ้าของอ่านของตัวเองได้)
grant select on public.video_ai_analyses to authenticated;
grant insert on public.video_ai_analyses to authenticated;
grant update on public.video_ai_analyses to authenticated;

-- สถานที่ที่ผู้ใช้บันทึกไว้ (แต่ละคนเห็นของตัวเอง)
grant select on public.user_saved_places to authenticated;
grant insert on public.user_saved_places to authenticated;
grant update on public.user_saved_places to authenticated;
grant delete on public.user_saved_places to authenticated;

-- โฟลเดอร์ + ทริป (add_folders.sql grant ไว้แล้ว — grant ซ้ำไม่เป็นไร
-- ถ้ายังไม่เคยรัน add_folders.sql บนโปรเจกต์นี้ บรรทัดพวกนี้ช่วยได้)
grant select, insert, update, delete on public.folders             to authenticated;
grant select, insert, update, delete on public.folder_items       to authenticated;
grant select, insert, update, delete on public.folder_collaborators to authenticated;
grant select, insert, update, delete on public.trip_plans         to authenticated;

-- ชุมชน + สถานที่ในระบบ (อ่านอย่างเดียวจากแอป)
grant select on public.communities       to authenticated;
grant select, insert on public.places    to authenticated;

-- ความคิดเห็น: อ่านได้ทุกคน · เขียน/แก้/ลบได้แค่แถวของตัวเอง
-- (RLS policy "comments insert/update/delete own" = auth.uid() = user_id)
grant select on public.comments          to authenticated;
grant insert on public.comments          to authenticated;
grant update on public.comments          to authenticated;
grant delete on public.comments          to authenticated;

-- ─────────────────────────────────────────────────────────────────
-- 5) เช็คว่า trigger สร้างแถว users ยังอยู่
--    (ถ้าไม่มี → แถว users ไม่ถูกสร้างตอนสมัคร → อัปเดตได้ 0 แถว
--     ซึ่งแอปจะขึ้นว่า "ไม่พบข้อมูลผู้ใช้ของคุณ" → รัน schema.sql)
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
-- 6) ตรวจผลหลังรัน
--    ตารางที่แอปแตะ → ต้องเห็น authenticated อยู่ในทุกตาราง
-- ─────────────────────────────────────────────────────────────────
-- select t.tablename, count(distinct g.grantee) as roles_with_grant
-- from pg_tables t
-- left join information_schema.role_table_grants g
--   on g.table_schema = t.schemaname and g.table_name = t.tablename
-- where t.schemaname = 'public'
--   and t.tablename in ('users','videos','video_likes','video_saves',
--                       'video_ai_analyses','user_saved_places','folders',
--                       'folder_items','folder_collaborators','trip_plans',
--                       'communities','places','comments')
-- group by t.tablename
-- order by t.tablename;
