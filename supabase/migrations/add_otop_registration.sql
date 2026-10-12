-- ============================================================
--  Migration — OTOP community registration on users
--  Run in Supabase SQL Editor (safe to run multiple times).
-- ------------------------------------------------------------
--  After Google login, a user picks a role: tourist or host (OTOP community).
--  A host verifies with their OTOP นวัตวิถี registration number via the CDD
--  API; the returned community info is stored here and shown on the profile's
--  "ข้อมูลเพิ่มเติม" section as a verified badge.
-- ============================================================

-- `role` already exists on users (tourist|host). Add OTOP fields:
alter table public.users
  add column if not exists otop_village_id varchar(40),         -- เลขทะเบียน (Village_ID)
  add column if not exists otop_verified boolean default false, -- ยืนยันกับ CDD API แล้ว
  add column if not exists otop_region varchar(100),
  add column if not exists otop_province varchar(100),
  add column if not exists otop_amphur varchar(100),
  add column if not exists otop_tambol varchar(100),
  add column if not exists otop_village varchar(150),
  add column if not exists otop_nawatwithi varchar(200),
  add column if not exists otop_for_tourism varchar(200),
  add column if not exists otop_cbt_village varchar(200),       -- หมู่บ้านท่องเที่ยวโดยชุมชน
  -- full raw payload for anything extra the API returns
  add column if not exists otop_raw jsonb;

comment on column public.users.otop_village_id is 'OTOP นวัตวิถี registration number used to verify a host via the CDD API.';
