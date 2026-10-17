-- ============================================================
--  Migration — Host Business Profile (สถานประกอบการของชุมชน OTOP)
--  Run in Supabase SQL Editor (safe to run multiple times).
-- ------------------------------------------------------------
--  Host registers with OTOP Village ID, then provides their specific
--  place_name, price_info, phone, and confirmed GPS coordinates.
--  These become the Ground Truth for the host's posts.
-- ============================================================

alter table public.users
  add column if not exists business_place_name varchar(200),
  add column if not exists business_price_info text,
  add column if not exists business_phone varchar(30),
  add column if not exists business_lat double precision,
  add column if not exists business_lng double precision,
  add column if not exists business_address text,
  add column if not exists business_subdistrict varchar(100),
  add column if not exists business_district varchar(100),
  add column if not exists business_province varchar(100);

comment on column public.users.business_place_name is 'ชื่อสถานที่ประกอบการ/ร้านค้า/โฮมสเตย์ของชุมชน';
comment on column public.users.business_price_info is 'ข้อมูลราคา/อัตราค่าบริการเริ่มต้น';
comment on column public.users.business_phone is 'เบอร์โทรศัพท์ติดต่อสถานประกอบการ';
comment on column public.users.business_lat is 'พิกัดละติจูดสถานประกอบการ';
comment on column public.users.business_lng is 'พิกัดลองจิจูดสถานประกอบการ';
