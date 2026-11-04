-- supabase/migrations/add_account_delete_scope.sql
--
-- กฎของการลบบัญชี: "ลบแค่ของตัวเอง · ของคนอื่นอยู่ครบ"
--   • ของฉัน (คลิป ไลก์ เซฟ คอมเมนต์ โฟลเดอร์ ทริป การจอง) → หายหมด
--   • ของคนอื่น → ยังอยู่ครบ เหลือแค่ "ร่องรอยของฉัน" ที่ต้องถูกเก็บ
--     (เช่น ไลก์ที่ฉันกดไปบนคลิปเขา → ร่องรอยนั้นหาย คลิปเขายังอยู่
--       และ likes_count ของเขาลดลงถูกต้อง 1)
--
-- ไฟล์นี้แก้ 2 จุดที่ยังผิดกฎ:
--
--   1) communities.host_user_id เดิม = ON DELETE CASCADE
--      → ลบบัญชีโฮสต์ = ชุมชนหาย → services หาย → bookings + passport_stamps
--        ของนักท่องเที่ยวคนอื่นหายตามไปด้วย (ผิดกฎ "ไม่ลบของคนอื่น")
--      → เปลี่ยนเป็น ON DELETE SET NULL: ชุมชนยังอยู่ ของคนอื่นยังอยู่
--        เหลือแค่ช่อง "เจ้าของ" ว่างเปล่า
--
--   2) user_saved_places — แอปใช้จริง (src/services/savedPlacesService.ts)
--      แต่ไม่มี DDL อยู่ในโปรเจกต์เลย → ไม่รู้ว่า FK เป็นกฎอะไร
--      • ไม่มี FK        → ที่บันทึกไว้ค้าง (ของฉันไม่หาย)
--      • ON DELETE RESTRICT → ลบบัญชีไม่สำเร็จเลย (ติด FK error)
--      → ตั้งให้เป็น ON DELETE CASCADE แน่นอน
--
-- รันซ้ำได้ (idempotent) — รันใน Supabase SQL Editor

-- ─────────────────────────────────────────────────────────────
-- 1) ชุมชนของโฮสต์ต้องไม่หายตามบัญชี
-- ─────────────────────────────────────────────────────────────

-- ลบ FK ทั้งหมดที่ผูกกับคอลัมน์ host_user_id (ไม่เชื่อชื่อ constraint
-- เพราะชื่อในฐานข้อมูลจริงอาจตั้งต่างจากใน schema.sql) — ถ้าค้าง FK
-- ตัวเก่าไว้ Postgres จะ cascade ตามตัวเก่า = ของคนอื่นหายตาม
do $$
declare
  fk record;
begin
  if not exists (
    select 1
    from pg_attribute att
    join pg_class rel on rel.oid = att.attrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where ns.nspname = 'public'
      and rel.relname = 'communities'
      and att.attname = 'host_user_id'
      and att.attnum > 0
      and not att.attisdropped
  ) then
    raise warning 'communities.host_user_id ไม่มีคอลัมน์นี้ — ข้าม';
    return;
  end if;

  for fk in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where ns.nspname = 'public'
      and rel.relname = 'communities'
      and con.contype = 'f'
      and att.attname = 'host_user_id'
  loop
    execute format('alter table public.communities drop constraint %I', fk.conname);
    raise notice 'dropped FK % on communities.host_user_id', fk.conname;
  end loop;

  -- SET NULL ต้องมีคอลัมน์ที่รับ null ได้
  alter table public.communities
    alter column host_user_id drop not null;

  alter table public.communities
    add constraint communities_host_user_id_fkey
    foreign key (host_user_id) references public.users(id) on delete set null;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 2) user_saved_places — ต้องมี และต้อง cascade
-- ─────────────────────────────────────────────────────────────
do $$
declare
  fk record;
  col_type text;
begin
  -- 2.1) ถ้ายังไม่มีตาราง → สร้างให้ตรงกับที่แอปเรียกใช้
  --      (RLS + policy ถูกตั้งทีหลังเสมอ ไม่ต้องพึ่งว่ารันครั้งแรก)
  if to_regclass('public.user_saved_places') is null then
    create table public.user_saved_places (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.users(id) on delete cascade,
      label text not null,
      address_text text,
      google_maps_url text,
      lat double precision,
      lng double precision,
      is_default boolean not null default false,
      created_at timestamptz default now()
    );

    raise notice 'created public.user_saved_places (ไม่เคยมีในโปรเจกต์)';
  end if;

  -- 2.2) ชนิดของ user_id ต้องเป็น uuid ถึงจะผูก FK กับ public.users ได้
  select format_type(att.atttypid, att.atttypmod) into col_type
  from pg_attribute att
  join pg_class rel on rel.oid = att.attrelid
  join pg_namespace ns on ns.oid = rel.relnamespace
  where ns.nspname = 'public'
    and rel.relname = 'user_saved_places'
    and att.attname = 'user_id'
    and att.attnum > 0
    and not att.attisdropped;

  if col_type is null then
    -- ตารางมีอยู่แต่ไม่มีคอลัมน์ user_id (schema ไม่ตรงกับที่แอปเรียกใช้)
    -- → เติมคอลัมน์ให้ แล้วผูก FK ต่อได้
    alter table public.user_saved_places add column if not exists user_id uuid;
    col_type := 'uuid';
    raise notice 'added user_id column to user_saved_places';
  end if;

  if col_type <> 'uuid' then
    raise warning 'user_saved_places.user_id เป็นชนิด % (ไม่ใช่ uuid) — ข้ามการตั้ง FK (ต้องแก้เอง)', col_type;
    return;
  end if;

  -- 2.2.5) RLS + policy — ตั้งทุกครั้งที่รันไฟล์นี้ (ไม่ว่าตารางเพิ่งถูกสร้าง
  --        หรือมีอยู่แล้ว) เพื่อให้ "ลบ policy ทิ้งแล้วรันซ้ำ" กลับมาได้
  --        ตารางที่เปิด RLS แล้วแต่ไม่มี policy = ใครก็อ่าน/เขียนไม่ได้
  alter table public.user_saved_places enable row level security;
  drop policy if exists "user_saved_places read own" on public.user_saved_places;
  create policy "user_saved_places read own" on public.user_saved_places
    for select using (auth.uid() = user_id);
  drop policy if exists "user_saved_places insert own" on public.user_saved_places;
  create policy "user_saved_places insert own" on public.user_saved_places
    for insert with check (auth.uid() = user_id);
  drop policy if exists "user_saved_places update own" on public.user_saved_places;
  create policy "user_saved_places update own" on public.user_saved_places
    for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  drop policy if exists "user_saved_places delete own" on public.user_saved_places;
  create policy "user_saved_places delete own" on public.user_saved_places
    for delete using (auth.uid() = user_id);

  -- 2.3) ทิ้งแถวกำพร้า (ของบัญชีที่ถูกลบไปแล้ว) ก่อน — ไม่งั้นการเพิ่ม
  --      FK จะติด error ว่ามีแถวอ้าง user ที่ไม่มีอยู่จริง
  delete from public.user_saved_places p
  where p.user_id is not null
    and not exists (select 1 from public.users u where u.id = p.user_id);

  -- 2.4) ลบ FK เดิมทั้งหมดที่ผูกกับ user_id (อาจเป็น RESTRICT หรือไม่มีเลย)
  for fk in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where ns.nspname = 'public'
      and rel.relname = 'user_saved_places'
      and con.contype = 'f'
      and att.attname = 'user_id'
  loop
    execute format('alter table public.user_saved_places drop constraint %I', fk.conname);
    raise notice 'dropped FK % on user_saved_places.user_id', fk.conname;
  end loop;

  -- 2.5) ตั้งใหม่ = CASCADE (ลบบัญชี → ที่บันทึกไว้หายตาม)
  alter table public.user_saved_places
    add constraint user_saved_places_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 3) ตรวจสอบ: ควรเห็น set null (n) กับ cascade (c)
-- ─────────────────────────────────────────────────────────────
select
  con.conrelid::regclass::text as table_name,
  con.conname,
  case con.confdeltype
    when 'c' then 'cascade'
    when 'n' then 'set null'
    when 'r' then 'restrict'
    else con.confdeltype::text
  end as on_delete
from pg_constraint con
where con.contype = 'f'
  and con.conrelid::regclass::text in ('communities', 'user_saved_places')
  and con.conname in ('communities_host_user_id_fkey', 'user_saved_places_user_id_fkey')
order by table_name;
