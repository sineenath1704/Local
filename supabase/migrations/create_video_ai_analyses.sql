-- ============================================================
--  Migration — Table video_ai_analyses (เก็บผลการวิเคราะห์ AI ละเอียด)
--  แยกเก็บข้อมูลโครงสร้าง JSON เพื่อใช้ค้นหา/ปักหมุด/ประมวลผล
--  โดยหน้าแอปแสดงเฉพาะ display_summary (คำบรรยาย 2 ย่อหน้า)
-- ============================================================

create table if not exists public.video_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.videos(id) on delete cascade,

  -- ข้อมูลสถานที่ (Ground Truth / Verified)
  place_name text,
  community text,
  province text,
  district text,
  subdistrict text,
  latitude double precision,
  longitude double precision,

  -- ข้อมูลวิเคราะห์สภาพแวดล้อมและกิจกรรม
  atmosphere text,
  category jsonb default '[]'::jsonb,
  activities jsonb default '[]'::jsonb,
  highlights jsonb default '[]'::jsonb,
  otop_products jsonb default '[]'::jsonb,
  tags jsonb default '[]'::jsonb,

  -- ข้อมูลติดต่อและบริการ
  price_info jsonb,
  contact jsonb,
  opening_hours text,

  -- ข้อมูลวิเคราะห์ภายใน AI
  reasoning jsonb,
  confidence jsonb,

  -- JSON ต้นฉบับทั้งก้อนจาก AI (ก่อนและหลัง enrich)
  raw_analysis jsonb not null,

  -- คำบรรยาย 2 ย่อหน้าแบบเพื่อนชวนเที่ยวที่แสดงให้ผู้ใช้เห็นจริง
  display_summary text not null,

  -- สถานะการตรวจสอบพิกัด
  location_status text default 'verified',

  created_at timestamptz default now()
);

-- Indexes สำหรับการค้นหาและ query
create index if not exists idx_video_ai_analyses_post_id on public.video_ai_analyses(post_id);
create index if not exists idx_video_ai_analyses_place on public.video_ai_analyses(place_name);
create index if not exists idx_video_ai_analyses_province on public.video_ai_analyses(province);

-- Row Level Security (RLS)
alter table public.video_ai_analyses enable row level security;

-- นโยบาย: ทุกคนสามารถอ่านผลวิเคราะห์ได้ (เพื่อแสดงผลในแอปและค้นหา)
create policy "Anyone can read video_ai_analyses"
  on public.video_ai_analyses for select
  using (true);

-- นโยบาย: ผู้ใช้ที่ล็อกอินสามารถเพิ่มหรืออัปเดตผลวิเคราะห์ของโพสต์ตัวเองได้
create policy "Owners can insert their video_ai_analyses"
  on public.video_ai_analyses for insert
  with check (
    exists (
      select 1 from public.videos
      where public.videos.id = video_ai_analyses.post_id
        and public.videos.user_id = auth.uid()
    )
  );

create policy "Owners can update their video_ai_analyses"
  on public.video_ai_analyses for update
  using (
    exists (
      select 1 from public.videos
      where public.videos.id = video_ai_analyses.post_id
        and public.videos.user_id = auth.uid()
    )
  );
