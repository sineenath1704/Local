-- supabase/migrations/add_community_places_structured.sql
--
-- Structured business data for AI ground truth.
--
-- ⚠️ ลำดับที่ต้องรัน: `add_place_matching.sql` **ก่อน** ไฟล์นี้
--    (ฟังก์ชันนี้อ้างถึงคอลัมน์ community_places.community_id / recorded_by
--     ที่ถูกเพิ่มใน migration แรก — ถ้ายังไม่มีคอลัมน์ `create or replace` จะ error
--     และฟังก์ชันเดิมจะยังทำงานอยู่)
--
-- Why: `opening_hours` and `price_info` are free-text blobs. The AI reads
-- them verbatim, so a host who wrote "เช็คอิน 14:00 / เช็คเอาท์ 11:00" or
-- "วันธรรมดา 500 บาท/ คืน | วันหยุด 750 บาท/ คืน" has to be re-parsed by the
-- model on every prompt, and it can't answer "เปิดวันอาทิตย์ไหม" reliably.
--
-- Two JSONB columns carry the same information in a form both Postgres and
-- the model can read directly:
--   business_hours    → {mon:[{open,close}], …, sun:[…]}   (all 7 keys always
--                      present; [] means deliberately closed that day)
--   business_pricing  → {weekday:{amount,currency}, weekend:{…}, unit}
--
-- The TEXT columns are intentionally kept: the editor forms read them back to
-- seed the UI, and they're what makes this migration backward-compatible.

-- ------------------------------------------------------------------
-- 1) Structured columns
-- ------------------------------------------------------------------
alter table public.community_places
  add column if not exists business_hours jsonb,
  add column if not exists business_pricing jsonb;

comment on column public.community_places.business_hours is
  'Per-day opening hours keyed mon..sun. Each value is an array of {open,close} so split shifts are representable; [] means closed that day.';
comment on column public.community_places.business_pricing is
  'Structured pricing: {weekday:{amount,currency}, weekend:{amount,currency}, unit}.';

-- Supports "which places are open on Sunday" style filters.
create index if not exists idx_community_places_hours
  on public.community_places using gin (business_hours);

-- ------------------------------------------------------------------
-- 2) updated_at trigger
--
-- The column has always existed but nothing ever wrote to it, so every row
-- looked untouched since creation. Mirrors trg_users_updated.
-- ------------------------------------------------------------------
drop trigger if exists trg_community_places_updated on public.community_places;
create trigger trg_community_places_updated
  before update on public.community_places
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- 3) Atomic host save
--
-- The mobile app used to write `public.users` and `community_places` as two
-- independent round-trips, the second fire-and-forget. A failure in between
-- left the profile updated but no row for the AI to read, and the host saw a
-- success message either way. One function, one transaction: both land or
-- neither does.
--
-- Gated to service_role. A SECURITY DEFINER function callable from anon would
-- be a privilege-escalation primitive, so the role check comes first.
-- ------------------------------------------------------------------
create or replace function public.host_save_business_profile(
  p_user_id uuid,
  p_users_payload jsonb,
  p_place_payload jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_value text;
  v_place_id text;
  v_community_id uuid;
  v_province text;
  v_district text;
  v_subdistrict text;
  v_village text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden: service_role only'
      using errcode = '42501';
  end if;

  -- ── กันดัก: ฟังก์ชันนี้อ้างถึงคอลัมน์ของ add_place_matching.sql ──
  --
  -- ถ้ารันไฟล์นี้ก่อน add_place_matching.sql ฟังก์ชันจะถูกสร้างได้
  -- (plpgsql ไม่ตรวจคอลัมน์ตอน create) แล้วพังตอนใช้งานจริง
  -- → ตรวจก่อนแล้วบอกให้ชัดว่าต้องรัน migration ไหนก่อน
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'community_places'
      and column_name = 'community_id'
  ) then
    raise exception 'migration required: run add_place_matching.sql before this function'
      using errcode = '3F000';
  end if;

  if p_user_id is null then
    raise exception 'missing user id' using errcode = '22023';
  end if;

  -- --- 3a) public.users.business_* -------------------------------
  --
  -- Only keys actually present in the payload are written, so a caller that
  -- sends a partial patch can't blank out the fields it didn't mention. The
  -- whitelist keeps `jsonb_each` from turning into an arbitrary-column write
  -- (`role`, `tier`, `id`…) even though the caller is already service_role.
  -- `value #>> '{}'` unwraps the scalar to SQL text, so an explicit JSON null
  -- arrives as SQL NULL — the profile editor sends `businessAddress: null` to
  -- mean "no address", and a jsonb null would otherwise be a type error here.
  for v_key, v_value in
    select key, value #>> '{}'
    from jsonb_each(
      case
        when jsonb_typeof(p_users_payload) = 'object' then p_users_payload
        else '{}'::jsonb
      end
    )
  loop
    if v_key = 'business_lat' or v_key = 'business_lng' then
      execute format(
        'update public.users set %I = nullif($1, '''')::double precision where id = $2',
        v_key
      ) using v_value, p_user_id;
    elsif v_key = 'community_id' then
      -- uuid → ต้อง cast เอง (ค่าว่าง = ไม่ผูกชุมชน)
      execute format(
        'update public.users set community_id = nullif($1, '''')::uuid where id = $2',
        v_key
      ) using v_value, p_user_id;
    elsif v_key = 'business_place_id' then
      -- Google Place ID — ค่าว่าง = ยังไม่ได้ผูกกับสถานที่ของ Google
      execute format(
        'update public.users set business_place_id = nullif($1, '''') where id = $2',
        v_key
      ) using v_value, p_user_id;
    elsif v_key in (
      'business_place_name', 'business_price_info', 'business_opening_hours',
      'business_phone', 'business_address', 'business_subdistrict',
      'business_district', 'business_province'
    ) then
      execute format('update public.users set %I = $1 where id = $2', v_key)
        using v_value, p_user_id;
    else
      raise exception 'unknown field %', v_key using errcode = '22023';
    end if;
  end loop;

  -- --- 3b) community_places --------------------------------------
  --
  -- Skipped entirely when the host hasn't picked a place on the map yet —
  -- their profile should still save, exactly as it did before.
  if jsonb_typeof(p_place_payload) is distinct from 'object' or p_place_payload = '{}'::jsonb then
    return;
  end if;

  v_place_id := p_place_payload->>'place_id';
  if v_place_id is null or btrim(v_place_id) = '' then
    raise exception 'missing place_id' using errcode = '22023';
  end if;

  -- --- 3b-1) ชุมชนของสถานที่ (D4/D13) -----------------------------
  --
  -- ชุมชนคือแหล่งของชื่อ hierarchy (D18) — client ไม่ต้องส่ง
  -- province/district/subdistrict/village มาอีกแล้ว แต่ยังรับ payload เป็น
  -- fallback ไว้ เผื่อ client รุ่นเก่าที่ยังไม่ส่ง community_id
  v_community_id := nullif(btrim(p_place_payload->>'community_id'), '')::uuid;

  select c.name, c.province, c.district, c.subdistrict
    into v_village, v_province, v_district, v_subdistrict
  from public.communities c
  where c.id = v_community_id;

  v_province := coalesce(
    nullif(btrim(v_province), ''),
    nullif(btrim(p_place_payload->>'province'), '')
  );
  v_district := coalesce(
    nullif(btrim(v_district), ''),
    nullif(btrim(p_place_payload->>'district'), '')
  );
  v_subdistrict := coalesce(
    nullif(btrim(v_subdistrict), ''),
    nullif(btrim(p_place_payload->>'subdistrict'), '')
  );
  v_village := coalesce(
    nullif(btrim(v_village), ''),
    nullif(btrim(p_place_payload->>'village'), '')
  );

  if coalesce(btrim(v_province), '') = '' then
    raise exception 'missing province' using errcode = '22023';
  end if;

  -- place_name is NOT NULL; catch the empty-name case here so the host sees a
  -- readable reason instead of a bare not_null_violation.
  if coalesce(btrim(p_place_payload->>'place_name'), '') = '' then
    raise exception 'missing place_name' using errcode = '22023';
  end if;

  insert into public.community_places (
    place_id, place_name, formatted_address, province, district, subdistrict,
    village, latitude, longitude, google_maps_url, phone, opening_hours,
    price_info, rating, user_ratings_total, website, source, owner_id,
    recorded_by, community_id, business_hours, business_pricing
  ) values (
    v_place_id,
    btrim(p_place_payload->>'place_name'),
    nullif(p_place_payload->>'formatted_address', ''),
    v_province,
    v_district,
    v_subdistrict,
    v_village,
    nullif(p_place_payload->>'latitude', '')::double precision,
    nullif(p_place_payload->>'longitude', '')::double precision,
    nullif(p_place_payload->>'google_maps_url', ''),
    nullif(p_place_payload->>'phone', ''),
    nullif(p_place_payload->>'opening_hours', ''),
    nullif(p_place_payload->>'price_info', ''),
    nullif(p_place_payload->>'rating', '')::numeric,
    nullif(p_place_payload->>'user_ratings_total', '')::integer,
    nullif(p_place_payload->>'website', ''),
    coalesce(nullif(p_place_payload->>'source', ''), 'host_verified'),
    p_user_id,
    p_user_id,
    v_community_id,
    -- nullif(..., 'null'::jsonb) turns a JSON null from the client into a
    -- real SQL NULL, so "no structured data" stays NULL rather than a
    -- non-null jsonb holding the value null.
    nullif(p_place_payload->'business_hours', 'null'::jsonb),
    nullif(p_place_payload->'business_pricing', 'null'::jsonb)
  )
  on conflict (place_id) do update set
    -- owner_id เดิม "ไม่ถูกย้าย" — ผ่อนเป็น "ย้ายได้เฉพาะตอนยังไม่มีเจ้าของ"
    -- (D14): แถวที่ยังไม่มี owner = แถวที่ host เพิ่งเข้ามายึด → owner เดิมคือ
    -- คนที่ยืนยันเป็นเจ้าของก่อนห้ามถูกย้าย (D14 เคยเป็นแบบนี้)
    owner_id = case
      when community_places.owner_id is null then excluded.owner_id
      else community_places.owner_id
    end,
    -- คนที่บันทึกครั้งแรกเท่านั้นที่ถูกเก็บไว้
    recorded_by = coalesce(community_places.recorded_by, excluded.recorded_by),
    -- ชุมชนจาก client ชนะเดิม · ถ้าไม่ส่งมาให้คงเดิมไว้
    community_id = coalesce(excluded.community_id, community_places.community_id),
    place_name           = excluded.place_name,
    formatted_address    = excluded.formatted_address,
    province             = excluded.province,
    district             = coalesce(excluded.district, community_places.district),
    subdistrict          = coalesce(excluded.subdistrict, community_places.subdistrict),
    village              = coalesce(excluded.village, community_places.village),
    latitude             = excluded.latitude,
    longitude            = excluded.longitude,
    google_maps_url      = excluded.google_maps_url,
    phone                = excluded.phone,
    opening_hours        = excluded.opening_hours,
    price_info           = excluded.price_info,
    rating               = excluded.rating,
    user_ratings_total   = excluded.user_ratings_total,
    website              = excluded.website,
    business_hours       = excluded.business_hours,
    business_pricing     = excluded.business_pricing,
    source               = excluded.source;
end;
$$;

revoke all on function public.host_save_business_profile(uuid, jsonb, jsonb) from public;
grant execute on function public.host_save_business_profile(uuid, jsonb, jsonb) to service_role;