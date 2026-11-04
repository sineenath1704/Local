-- supabase/migrations/add_google_place_cache.sql
--
-- Cache for Google Places lookups (chat + trip planner)
-- ------------------------------------------------------------
-- The AI chat and the trip planner need facts about ONE specific place
-- (phone, opening hours, website, price tier, rating, address). Before
-- this, those facts only existed in `community_places` — a place nobody
-- had registered yet simply had no data, and the chat answered "ไม่มีข้อมูล".
--
-- This table caches what Google returns so the same place is not billed
-- twice: a text search for the same name, or a details lookup for the
-- same place id.
--
-- Why a NEW table and not `community_places`
--   `community_places` rows are "a place in this community" — the map
--   endpoint (`GET /places/district`) merges rows that have a district even
--   when no community owns them, and the UI labels them as confirmed
--   places. A Google row written there would look like somebody verified
--   it. It also has no expiry, and the chat reads it with `.limit(50)`,
--   so cached noise would crowd out real places.
--
-- Two kinds of row, one table:
--   kind = 'search'  → cache_key = 'search:<hash of the query>'
--                      `candidates` holds up to 5 raw results
--   kind = 'details' → cache_key = 'details:<google place id>'
--                      the columns hold that place's full record
--
-- TTL is applied in code (see `backend/src/placeLookup.ts`):
--   search   → 30 days (1 day when the search found nothing)
--   details  → 14 days
--
-- RLS is on and there is deliberately NO policy: only the service-role
-- key (backend) can read or write it. The mobile app never touches this
-- table directly.
--
-- Safe to run more than once.

create table if not exists public.google_place_cache (
  cache_key text primary key,
  kind text not null,
  place_id text,
  name text,
  address text,
  phone text,
  opening_hours text,
  website text,
  rating numeric,
  user_ratings_total integer,
  price_level integer,
  latitude double precision,
  longitude double precision,
  google_maps_uri text,
  province text,
  district text,
  subdistrict text,
  business_status text,
  types jsonb,
  candidates jsonb,
  fetched_at timestamptz not null default now()
);

comment on table public.google_place_cache is
  'Cache of Google Places lookups (search + details). Backend-only: RLS on, no policy. TTL is enforced in backend/src/placeLookup.ts.';

comment on column public.google_place_cache.cache_key is
  'search:<sha1 of the normalized query> or details:<google place id>.';

comment on column public.google_place_cache.kind is
  'search = a text-search result list (candidates jsonb); details = one place record.';

comment on column public.google_place_cache.candidates is
  'For kind=search: the raw candidate list (max 5). Null for kind=details.';

comment on column public.google_place_cache.fetched_at is
  'When the row was written. The backend treats a row older than its TTL as a miss.';

create index if not exists google_place_cache_kind_idx
  on public.google_place_cache (kind);

-- Backend only: service_role bypasses RLS, the anon/authenticated roles
-- do not — and with no policy they cannot read or write a single row.
alter table public.google_place_cache enable row level security;
