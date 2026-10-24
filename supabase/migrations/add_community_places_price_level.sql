-- supabase/migrations/add_community_places_price_level.sql
--
-- Google's price band as its own column.
--
-- Why not inside `price_info`: that column holds the host's OWN pricing —
-- "วันธรรมดา 500 บาท | วันหยุด 750 บาท" — written by the profile editor
-- through formatPriceStr() and read back through parsePriceStr(). The band
-- (ฟรี / ฿ / ฿฿ / ฿฿฿ / ฿฿฿฿) is a different fact: a rough estimate of the
-- price tier, not a price. Writing one over the other would wipe the real
-- weekday/weekend prices the host typed.
--
-- The host confirms the band when they pick a place while posting a clip, so
-- the AI chat can answer "ราคาประมาณเท่าไหร่" without re-parsing prose.
--
-- Safe to run more than once.

alter table public.community_places
  add column if not exists price_level text;

comment on column public.community_places.price_level is
  'Price tier confirmed by the host: ฟรี / ฿ / ฿฿ / ฿฿฿ / ฿฿฿฿. Separate from price_info, which holds the weekday/weekend prices.';
