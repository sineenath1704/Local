-- ============================================================
--  Migration — "places" table (specific verified places under a community)
--  Run in Supabase SQL Editor (safe to run multiple times).
-- ------------------------------------------------------------
--  Local's location hierarchy goes region → province → district → subdistrict
--  → community (from the OTOP dataset). This table adds the deepest level:
--  a SPECIFIC place (ร้าน/คาเฟ่/โฮมสเตย์/จุดชมวิว) that a user confirmed exists.
--  Confirmed places accumulate here so later posts resolve instantly without
--  calling Google Places again.
-- ============================================================

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name varchar(200) not null,                 -- specific place name
  community varchar(200),                      -- ชุมชน/หมู่บ้าน
  subdistrict varchar(100),
  district varchar(100),
  province varchar(100),
  latitude double precision,
  longitude double precision,
  google_place_id varchar(200),                -- set when verified via Google
  source varchar(20) default 'manual' check (source in ('google', 'manual', 'otop')),
  verified_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  -- avoid duplicates of the same place in the same area
  unique (name, district, province)
);
create index if not exists idx_places_lookup on public.places (province, district, name);

-- Row Level Security: anyone can read; only signed-in users can add.
alter table public.places enable row level security;

drop policy if exists "places public read" on public.places;
create policy "places public read" on public.places for select using (true);

drop policy if exists "places auth insert" on public.places;
create policy "places auth insert" on public.places
  for insert with check (auth.uid() = verified_by);

grant select on public.places to anon;
grant select, insert on public.places to authenticated;

-- Let the videos row reference a confirmed place + carry coordinates.
alter table public.videos
  add column if not exists place_id uuid references public.places(id) on delete set null,
  add column if not exists place_name varchar(200),
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
