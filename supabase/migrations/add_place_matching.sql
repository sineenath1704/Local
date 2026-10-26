-- ============================================================
--  Migration — place↔community matching (D4 / D7 / D11 / D13 / D14 / D18 / D19 / D28)
--  Run in Supabase SQL Editor (safe to run multiple times).
-- ------------------------------------------------------------
--  Context: PLAN_PLACE_MATCHING.md — เฟส 1
--
--  Before this migration the app had three disconnected place stores:
--    • communities      = ชุมชน OTOP (ทุกแถวต้องมี host_user_id → ว่างเปล่า)
--    • community_places = สถานที่ที่ host ลงทะเบียน (ไม่มีคอลัมน์ชุมชน)
--    • places           = cache ของสถานที่ที่ยืนยันแล้ว (uuid, ไม่ใช่แหล่งจริง)
--
--  This migration makes `communities` a read-only registry of OTOP villages
--  (host is optional — a village can exist before anyone hosts it) and links
--  every place back to its community.
--
--  หมายเหตุ: ขั้น 1.5 (set community_places.community_id → not null) **ไม่ได้อยู่ในไฟล์นี้**
--  ต้องรันหลัง backfill B5/B6 เสร็จและไม่มีแถวค้าง — ดู PLAN_PLACE_MATCHING.md §4.3
-- ============================================================

-- ── 1) ปลดล็อกตาราง communities ให้เป็น registry read-only ของ OTOP ─────
alter table public.communities
  alter column host_user_id drop not null;
alter table public.communities
  drop constraint if exists communities_host_user_id_fkey;
alter table public.communities
  add constraint communities_host_user_id_fkey
  foreign key (host_user_id) references public.users(id) on delete set null;

--    lat/lng + capacity_per_day: ไม่มีแหล่งข้อมูล (ดู 2.1) → คง NULL
alter table public.communities
  alter column latitude drop not null,
  alter column longitude drop not null,
  alter column capacity_per_day drop not null;
alter table public.communities
  drop constraint if exists communities_capacity_per_day_check;

--    ตัวระบุชุมชนที่เสถียร = CDD Village_ID (เลขทะเบียน OTOP)
alter table public.communities
  add column if not exists otop_village_id varchar(40);
create unique index if not exists idx_communities_village
  on public.communities(otop_village_id) where otop_village_id is not null;

-- ── 2) host → ชุมชน (หนึ่งชุมชนมี host ได้หลายคน) ──────────────────
alter table public.users
  add column if not exists community_id uuid
  references public.communities(id) on delete set null;

-- ── 3) id ของ Google สำหรับสถานที่ที่ host ลงทะเบียนไว้ ─────────────
alter table public.users
  add column if not exists business_place_id text;

-- ── 4) สถานที่ → ชุมชน (D4) ───────────────────────────────────────
alter table public.community_places
  add column if not exists community_id uuid
  references public.communities(id) on delete restrict;
create index if not exists idx_cp_community
  on public.community_places(community_id);

-- ── 5) เจ้าของ = ผู้ประกอบการ + ผู้บันทึก (D14) ──────────────────
alter table public.community_places
  add column if not exists recorded_by uuid
  references public.users(id) on delete set null;

-- ── 6) เลิกเขียนชื่อ hierarchy ซ้ำใน community_places (D18) ───────────
--    ยังไม่ลบคอลัมน์ในรอบนี้ (กลับได้) แต่หยุดเขียนและอ่านจาก join
alter table public.community_places
  alter column province drop not null;

-- ── 7) ดัชนีช่วยค้นสถานที่ในชุมชน (D7: ค้นด้วย id) ─────────────────
create index if not exists idx_places_google_id
  on public.places(google_place_id) where google_place_id is not null;

-- ── 8) ระดับที่จับคู่ชุมชนได้ (D28) ───────────────────────────────────
--    village = เจอชื่อหมู่บ้านในที่อยู่ | subdistrict = ตำบลตรง
--    district = อำเภอตรง | manual = ผู้ใช้เลือกชุมชนเอง
--    NULL = backfill จาก places (เดิม) ที่ยังไม่รู้ระดับ
alter table public.community_places
  add column if not exists community_match_level text;

comment on column public.communities.otop_village_id is
  'CDD Village_ID (เลขทะเบียน OTOP) — ตัวระบุชุมชนที่เสถียร ใช้เป็น key ของ seed/backfill';
comment on column public.users.community_id is
  'ชุมชนที่ผู้ใช้สังกัด (host ของหมู่บ้าน)';
comment on column public.users.business_place_id is
  'Google Place ID (ChIJ…) ของสถานที่ที่ผู้ใช้ลงทะเบียนไว้';
comment on column public.community_places.community_id is
  'ชุมชนที่สถานที่นี้อยู่';
comment on column public.community_places.recorded_by is
  'ผู้บันทึกสถานที่ครั้งแรก (ต่างจาก owner_id ซึ่งเป็นผู้ประกอบการ)';
comment on column public.community_places.community_match_level is
  'ระดับที่จับคู่ชุมชนได้: village | subdistrict | district | manual (NULL = ยังไม่รู้)';

-- ตรวจว่า RLS เปิดอยู่ (communities เปิดอยู่แล้วจาก policies.sql)
alter table public.communities enable row level security;
alter table public.community_places enable row level security;
