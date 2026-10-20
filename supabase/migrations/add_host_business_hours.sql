-- Migration: add_host_business_hours.sql
-- Store the opening hours the registrant reviewed and corrected, on the users
-- row itself. community_places already carries the same text, but the profile
-- edit modal reads this column — and it was never created, so the hours a host
-- set were gone by the time they came back to fix anything.
--
-- Same shape ProfileLocal.tsx's parsePrimaryHoursStr() expects:
--   "<weekday label>: <hours> | <weekend label>: <hours> | วันหยุดร้าน: ปิดทุกวันอาทิตย์"

alter table public.users
  add column if not exists business_opening_hours text;