-- supabase/migrations/add_community_places_structured.sql
--
-- Structured business data for AI ground truth.
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
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden: service_role only'
      using errcode = '42501';
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

  if coalesce(btrim(p_place_payload->>'province'), '') = '' then
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
    business_hours, business_pricing
  ) values (
    v_place_id,
    btrim(p_place_payload->>'place_name'),
    nullif(p_place_payload->>'formatted_address', ''),
    btrim(p_place_payload->>'province'),
    nullif(p_place_payload->>'district', ''),
    nullif(p_place_payload->>'subdistrict', ''),
    nullif(p_place_payload->>'village', ''),
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
    -- nullif(..., 'null'::jsonb) turns a JSON null from the client into a
    -- real SQL NULL, so "no structured data" stays NULL rather than a
    -- non-null jsonb holding the value null.
    nullif(p_place_payload->'business_hours', 'null'::jsonb),
    nullif(p_place_payload->'business_pricing', 'null'::jsonb)
  )
  on conflict (place_id) do update set
    -- owner_id is deliberately not reassigned: a host who edits their listing
    -- must not be able to take over a row that belongs to someone else, and
    -- the ON CONFLICT target isn't scoped to owner. updated_at is left to
    -- trg_community_places_updated.
    place_name           = excluded.place_name,
    formatted_address    = excluded.formatted_address,
    province             = excluded.province,
    district             = excluded.district,
    subdistrict          = excluded.subdistrict,
    village              = excluded.village,
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