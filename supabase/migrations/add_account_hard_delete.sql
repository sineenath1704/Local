-- supabase/migrations/add_account_hard_delete.sql
--
-- Bypasses GoTrue's auth.admin.deleteUser(), which (in some Supabase
-- environments) returns "database error deleting user" before the
-- cascade even gets to run. The same FK chain still fires — auth.users
-- → public.users → every owned row — but with an SQL-level delete the
-- real error surfaces from Postgres instead of being masked.
--
-- Gated to service_role only; a SECURITY DEFINER bypass callable from
-- anon/authenticated would be a privilege-escalation primitive.
--
-- กฎของการลบบัญชี: "ลบแค่ของตัวเอง · ของคนอื่นอยู่ครบ"
--   • ของฉัน → หายหมด (FK cascade จัดการให้)
--   • ของคนอื่น → ต้องไม่หาย → เช่น ไลก์ที่ฉันกดบนคลิปเขา: คลิปเขายังอยู่
--     มีแต่ร่องรอยของฉัน (แถว video_likes) ที่หาย
--
-- เพิ่ม 2 ขั้นกันเหตุก่อนลบจริง (ป้องกันไม่ให้ของคนอื่นหายตาม):
--   1) ปลดล็อก "เจ้าของชุมชน" ออกก่อน → ชุมชนไม่ถูก cascade ตามบัญชี
--      (ถ้า FK ยังเป็น CASCADE อยู่ แล้วไม่ปลดล็อก = การจอง/สแตมป์ของ
--       นักท่องเที่ยวคนอื่นในชุมชนนั้นหายไปด้วย)
--   2) ลบแถว "ที่บันทึกไว้" ของฉันก่อน → กันกรณี FK เป็น RESTRICT
--      (ซึ่งจะทำให้ลบบัญชีไม่สำเร็จเลย)

create or replace function public.account_hard_delete(target_uid uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden: service_role only'
      using errcode = '42501';
  end if;

  -- ไม่รอล็อกไม่จำกัด: ถ้ามี transaction อื่นล็อกแถวที่เราจะแตะ (เช่น
  -- การจอง/สแตมป์ของนักท่องเที่ยวที่ยังทำรายการค้างอยู่) เดิม Postgres
  -- จะรอไม่จำกัด → request ค้างจน client ตัดการเชื่อมต่อ (~60 วินาที)
  -- และเซิร์ฟเวอร์ไม่มี log ให้ดูเลย → ตั้งเพดานเวลาให้ล้มเหลวเร็ว
  -- พร้อมข้อความสาเหตุจริงแทน
  perform set_config('lock_timeout', '15s', true);
  perform set_config('statement_timeout', '60s', true);

  -- 1) ชุมชนของโฮสต์ต้องไม่หายตามบัญชี (ป้องกันของคนอื่นหาย)
  begin
    update public.communities
       set host_user_id = null
     where host_user_id = target_uid;
  exception when others then
    -- คอลัมน์ยัง NOT NULL (migration add_account_delete_scope.sql ยังไม่รัน)
    -- → ปลดล็อกไม่ได้ แต่ห้ามทำให้ทั้ง request ตาย
    raise warning 'account_hard_delete: unlink community host failed: %', sqlerrm;
  end;

  -- 2) ที่บันทึกไว้ของฉัน (ลบก่อน เพื่อไม่ให้ FK แบบ RESTRICT บล็อกการลบบัญชี)
  if to_regclass('public.user_saved_places') is not null then
    begin
      delete from public.user_saved_places where user_id = target_uid;
    exception when others then
      raise warning 'account_hard_delete: delete user_saved_places failed: %', sqlerrm;
    end;
  end if;

  -- 3) ลบบัญชี → cascade ลบแถวของฉันในทุกตารางที่ผูกด้วย FK
  --    (คลิป ไลก์ เซฟ คอมเมนต์ โฟลเดอร์ ทริป การจอง สแตมป์ ฯลฯ)
  delete from auth.users where id = target_uid;
end;
$$;

revoke all on function public.account_hard_delete(uuid) from public;
grant execute on function public.account_hard_delete(uuid) to service_role;
