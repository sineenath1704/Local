-- supabase/migrations/add_community_places_place_facts.sql
--
-- What a clip tells us about a place, stored on the place itself.
--
-- The AI chat answers a traveller from `community_places`. Before this, the
-- only facts it could reach were price, phone, website and opening hours —
-- everything said in the clip about the PLACE (how many rooms, the rules,
-- the zones, the facilities) lived in the summary text and nowhere else, so
-- "มีกี่ห้อง" could only be answered by someone who watched the video.
--
-- These four columns are the structured twin of that prose. They are written
-- when a host posts a clip and confirms the place, and read back by the chat.
--
-- `rules` is `house_rules` here: `rules` is a keyword in Postgres, and the
-- column name says what it holds anyway.
--
-- Every value is a JSONB array of short strings (capacity is an object of
-- short strings) — the clip says "ห้องใหญ่ 4-6 คน", and a number would force
-- one reading of an ambiguous sentence.
--
-- Safe to run more than once.

alter table public.community_places
  add column if not exists capacity jsonb,
  add column if not exists house_rules jsonb,
  add column if not exists areas jsonb,
  add column if not exists facilities jsonb;

comment on column public.community_places.capacity is
  'Capacity of the accommodation: {rooms, guests_per_room, max_guests, beds}. Every value is text, because the clip says ranges ("4-6 คน").';

comment on column public.community_places.house_rules is
  'Rules of the place, as said in the clip: ["รับวันละ 1 กลุ่ม", "ต้องช่วยกันทำเตาไฟ"].';

comment on column public.community_places.areas is
  'Zones of the place, as seen in the clip: ["โซนเจ้าบ้าน", "โซนห้องพัก"].';

comment on column public.community_places.facilities is
  'Facilities of the place, as seen in the clip: ["ระเบียง", "กองไฟ"].';
