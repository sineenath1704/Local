-- supabase/migrations/create_fuel_price_cache.sql
--
-- Cache for fuel prices (one row per Thai calendar day)
-- ------------------------------------------------------------
-- The trip planner shows the cost of fuel per litre. The price changes
-- daily (PTT Oil Station publishes a new price with an effective date),
-- but a trip plan is not recalculated every time somebody opens a screen —
-- so the price is fetched once per day and cached.
--
-- Why a table and not an in-process cache
--   The backend runs on Vercel: every cold start is a fresh process, and
--   there is no guarantee two requests hit the same instance. An in-memory
--   cache would re-scrape the price site several times a day and could
--   even hand out two different prices to two users at the same moment.
--   The table makes the "one fetch per day" rule hold across instances.
--
-- One row per day
--   `cache_date` is the Thai calendar day ("YYYY-MM-DD", Asia/Bangkok).
--   The backend treats a row whose `cache_date` is not today as stale and
--   only falls back to it (with an explicit "ข้อมูลเก่า" label) when the
--   live fetch fails. It never writes an old price into today's row.
--
-- RLS is on and there is deliberately NO policy: only the service-role
-- key (backend) can read or write it. The mobile app never touches this
-- table directly — it asks the backend for the price.
--
-- Safe to run more than once.

create table if not exists public.fuel_price_cache (
  cache_date date primary key,
  prices jsonb not null default '{}'::jsonb,
  effective_date text,
  effective_date_alt text,
  source text,
  origin text,
  is_estimate boolean not null default false,
  url text,
  fetched_at timestamptz not null default now()
);

comment on table public.fuel_price_cache is
  'Fuel prices cached once per Thai calendar day. Backend-only: RLS on, no policy. Written by backend/src/fuelPrice.ts.';

comment on column public.fuel_price_cache.cache_date is
  'The Thai calendar day the price was fetched for (YYYY-MM-DD, Asia/Bangkok). Primary key = one price set per day.';

comment on column public.fuel_price_cache.prices is
  'Price per litre keyed by fuel type (gasohol95, dieselB20, ...).';

comment on column public.fuel_price_cache.is_estimate is
  'true = these numbers came from the code constants, not from the price site.';

-- Backend only: service_role bypasses RLS, the anon/authenticated roles
-- do not — and with no policy they cannot read or write a single row.
alter table public.fuel_price_cache enable row level security;
