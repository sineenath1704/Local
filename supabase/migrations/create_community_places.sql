-- Migration: create_community_places.sql
-- Table for verified host business places and granular community spots.

CREATE TABLE IF NOT EXISTS public.community_places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- เจ้าของร้าน (Host)
  place_id TEXT UNIQUE,                                        -- Google Place ID (ถ้ามี)
  place_name TEXT NOT NULL,                                    -- ชื่อร้าน/สถานที่
  formatted_address TEXT,                                      -- ที่อยู่เต็ม
  province TEXT NOT NULL,                                      -- จังหวัด
  district TEXT,                                               -- อำเภอ
  subdistrict TEXT,                                            -- ตำบล
  village TEXT,                                                -- ชุมชน/หมู่บ้าน
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  google_maps_url TEXT,                                        -- ลิงก์แผนที่ Google Maps
  phone TEXT,                                                  -- เบอร์โทรติดต่อ
  opening_hours TEXT,                                          -- เวลาเปิด-ปิด
  price_info TEXT,                                             -- ข้อมูลราคา / อัตราค่าบริการ
  rating NUMERIC(2, 1),                                        -- คะแนนรีวิว
  user_ratings_total INTEGER,                                  -- จำนวนรีวิว
  website TEXT,                                                -- เว็บไซต์/เพจ
  business_status TEXT DEFAULT 'OPERATIONAL',
  source TEXT DEFAULT 'host_verified',                        -- host_verified / google_places
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_places_name ON public.community_places(place_name);
CREATE INDEX IF NOT EXISTS idx_community_places_prov ON public.community_places(province);
CREATE INDEX IF NOT EXISTS idx_community_places_owner ON public.community_places(owner_id);

-- Enable RLS
ALTER TABLE public.community_places ENABLE ROW LEVEL SECURITY;

-- Allow public read access (for search and AI Chat)
-- NOTE: the canonical RLS list lives in supabase/policies.sql — this file is
-- kept in sync so re-running the migration does not reintroduce the old,
-- too-permissive INSERT policy.
drop policy if exists "Allow public read access on community_places" on public.community_places;
create policy "Allow public read access on community_places"
  ON public.community_places
  FOR SELECT
  USING (true);

-- Allow authenticated users to insert/update their own places
--
-- PLAN_PLACE_MATCHING.md §2.6.4 — the old check was
--   WITH CHECK (auth.uid() = owner_id OR auth.uid() IS NOT NULL)
-- The second clause is always true for any signed-in user, so anyone could
-- insert a row carrying somebody else's owner_id. Now a user may only insert
-- rows they own themselves, or ownerless rows (a place a tourist recorded).
drop policy if exists "Allow authenticated users to insert community_places" on public.community_places;
create policy "Allow authenticated users to insert community_places"
  ON public.community_places
  FOR INSERT
  WITH CHECK (owner_id IS NULL OR auth.uid() = owner_id);

drop policy if exists "Allow owners to update their community_places" on public.community_places;
create policy "Allow owners to update their community_places"
  ON public.community_places
  FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (owner_id IS NULL OR auth.uid() = owner_id);
