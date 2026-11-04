-- ============================================================
--  Fix — policy ของตาราง interaction (ไลก์ / เซฟ) + trigger ตัวนับ
--  Run in Supabase SQL Editor (ปลอดภัย รันซ้ำได้)
-- ------------------------------------------------------------
--  อาการ:
--    WARN [interaction] addClipToFolder error:
--    [Error: addClipToFolder (บันทึกคลิป): new row violates row-level
--     security policy (USING expression) for table "video_saves"]
--
--  ─────────────────────────────────────────────────────────────────
--  สาเหตุที่ 1 — policy ไม่มีสิทธิ์ UPDATE (ตาราง video_saves / video_likes)
--
--    แอปเขียนด้วย `upsert(..., { onConflict: "user_id,video_id" })`
--    → SQL คือ `INSERT … ON CONFLICT DO UPDATE`
--    → ถ้าแถวมีอยู่แล้ว PostgreSQL จะเดินทาง **DO UPDATE**
--    → RLS บังคับใช้ policy ของ UPDATE ด้วย
--    → แต่ policy ที่มีอยู่มีแค่ select / insert / delete
--      **ไม่มี policy ของ UPDATE** → ไม่มี policy แบบ permissive ที่ผ่าน
--      → error "new row violates row-level security policy (USING expression)"
--
--    ทำไมถึงเจอตอน "บันทึกลงโฟลเดอร์" แต่ไม่เจอตอนกด save ครั้งแรก:
--      • กด save ครั้งแรก → INSERT → ผ่าน (policy insert มีอยู่) ✓
--      • กด save อีกครั้งเพื่อเลือกโฟลเดอร์ → แถวมีอยู่แล้ว
--        → ON CONFLICT DO UPDATE → ไม่มี UPDATE policy → error
--      • (ผลคือ: คลิปถูก "บันทึก" ไว้แล้ว แต่ไม่เคยลงในโฟลเดอร์)
--
--  ─────────────────────────────────────────────────────────────────
--  สาเหตุที่ 2 — trigger ตัวนับไม่ใช่ SECURITY DEFINER
--
--    หัวไฟล์ schema.sql เขียนไว้ว่า "Counts are kept by SECURITY DEFINER
--    triggers" แต่ตัวฟังก์ชันจริง **ไม่มี** security definer
--    → trigger ทำงานด้วยสิทธิ์ของผู้กด (authenticated)
--    → ประโยค `update public.videos set saves_count = …` โดน RLS
--      ของตาราง videos บล็อก (policy "videos update own" = ของตัวเองเท่านั้น)
--    → พอบันทึก/ไลก์คลิป **ของคนอื่น** → trigger โดน → ทั้ง INSERT ล้มเหลว
--    → อาการคล้ายกับ "กดไลก์แล้วไม่ขึ้นในแท็บ วิดีโอที่ถูกใจ"
--
--    แก้โดยใส่ `security definer` + `set search_path` → trigger ทำงานด้วย
--    สิทธิ์เจ้าของตาราง → ข้าม RLS → นับเลขได้ทุกคลิป ไม่ว่าของใคร
--    (ถ้าฐานข้อมูลที่ deploy อยู่เป็น SECURITY DEFINER อยู่แล้ว → เปลี่ยนแบบนี้
--     ไม่มีผลอะไร เป็นการ "ทำให้ตรงกับโค้ดใน repo")
-- ============================================================

-- ─────────────────────────────────────────────────────────────────
-- 1) policy UPDATE ของตารางที่แอปเขียนด้วย upsert()
--    (RLS policy ของ update = เขียนได้แค่แถวของตัวเอง
--     เหมือน insert / delete ของตารางเดียวกัน)
-- ─────────────────────────────────────────────────────────────────

-- ไลก์
drop policy if exists "likes update own" on public.video_likes;
create policy "likes update own" on public.video_likes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- เซฟคลิป
drop policy if exists "saves update own" on public.video_saves;
create policy "saves update own" on public.video_saves
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────
-- 2) trigger ตัวนับ = SECURITY DEFINER
--    (ต้องเป็นเจ้าของตารางเพื่อให้ข้าม RLS — schema.sql เป็นคนสร้าง
--     ฟังก์ชันเหล่านี้ใน SQL Editor → owner = postgres = เจ้าของตาราง ✓)
-- ─────────────────────────────────────────────────────────────────

create or replace function public.bump_video_likes() returns trigger language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    update public.videos set likes_count = likes_count + 1 where id = new.video_id;
    update public.users u set total_likes_received = total_likes_received + 1
      from public.videos v where v.id = new.video_id and v.user_id = u.id;
  elsif (tg_op = 'DELETE') then
    update public.videos set likes_count = greatest(likes_count - 1, 0) where id = old.video_id;
    update public.users u set total_likes_received = greatest(total_likes_received - 1, 0)
      from public.videos v where v.id = old.video_id and v.user_id = u.id;
  end if;
  return null;
end; $$;
drop trigger if exists trg_video_likes on public.video_likes;
create trigger trg_video_likes after insert or delete on public.video_likes
  for each row execute function public.bump_video_likes();

create or replace function public.bump_video_saves() returns trigger language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    update public.videos set saves_count = saves_count + 1 where id = new.video_id;
  elsif (tg_op = 'DELETE') then
    update public.videos set saves_count = greatest(saves_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end; $$;
drop trigger if exists trg_video_saves on public.video_saves;
create trigger trg_video_saves after insert or delete on public.video_saves
  for each row execute function public.bump_video_saves();

create or replace function public.bump_comments() returns trigger language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT') then
    update public.videos set comments_count = comments_count + 1 where id = new.video_id;
  elsif (tg_op = 'DELETE') then
    update public.videos set comments_count = greatest(comments_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end; $$;
drop trigger if exists trg_comments on public.comments;
create trigger trg_comments after insert or delete on public.comments
  for each row execute function public.bump_comments();

-- ─────────────────────────────────────────────────────────────────
-- 3) ตรวจผลหลังรัน (optional)
--
--    3.1) video_likes / video_saves ต้องมี policy ของ update แล้ว
--    select tablename, policyname, cmd
--    from pg_policies
--    where schemaname = 'public'
--      and tablename in ('video_likes','video_saves')
--    order by tablename, cmd;
--    → video_likes: DELETE · INSERT · SELECT · UPDATE (4)
--    → video_saves: DELETE · INSERT · SELECT · UPDATE (4)
--
--    3.2) trigger ต้องเป็น SECURITY DEFINER
--    select p.proname, p.prosecdef, t.tgname
--    from pg_proc p
--    join pg_namespace n on n.oid = p.pronamespace
--    join pg_trigger t on t.tgfoid = p.oid and not t.tgisinternal
--    where n.nspname = 'public'
--      and p.proname in ('bump_video_likes','bump_video_saves','bump_comments');
--    → prosecdef = true ทั้ง 3 ตัว
--
--    3.3) ทดสอบจริงจากแอป:
--      • กดบันทึกคลิป → เลือกโฟลเดอร์ → ต้องไม่ error
--        และคลิปต้องเข้าโฟลเดอร์จริง
--      • กดบันทึกคลิปเดิมอีกครั้ง → ต้องผ่าน (เดิมพังตรงนี้)
--      • กดไลก์คลิปของคนอื่น → ต้องขึ้นในแท็บ "วิดีโอที่ถูกใจ"
--      • กด "เอาคลิปออกจากที่บันทึก" → ต้องหายจากแท็บ "ที่บันทึก"
-- ============================================================
