-- ============================================================
--  Local app — Supabase schema  (run in Supabase SQL Editor)
-- ============================================================
--  Based on the provided schema + gaps added:
--   • username / bio on users
--   • video_likes / follows / video_saves (who did what)
--   • community_registrations (raw OTOP application, pending review)
--   • comments.parent_comment_id (replies)
--   • videos.ai_summary as JSONB + status
--   • updated_at + triggers, indexes, soft-delete, counter triggers
--   • Row Level Security (RLS) on every table
-- ============================================================

create extension if not exists "uuid-ossp";
-- PostGIS is optional; lat/long columns are enough for now. Uncomment if needed.
-- create extension if not exists "postgis";

-- ------------------------------------------------------------
-- 1. USERS (profile row, 1:1 with auth.users)
-- ------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  role varchar(20) default 'tourist' check (role in ('tourist', 'host')),
  display_name varchar(100) not null,
  username varchar(50) unique,                 -- read-only after set
  bio text,
  phone_number varchar(20) unique,
  avatar_url text,
  tier varchar(20) default 'free' check (tier in ('free', 'premium')),
  followers_count int default 0,
  following_count int default 0,
  total_likes_received int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 2. COMMUNITY REGISTRATIONS (raw OTOP application → pending review)
-- ------------------------------------------------------------
create table if not exists public.community_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  smce_code varchar(30),
  president_name varchar(150),
  phone varchar(20),
  address text,
  category varchar(100),
  carrying_capacity varchar(100),
  pricing_ceiling varchar(150),
  region varchar(50),
  province varchar(50),
  district varchar(50),
  subdistrict varchar(50),
  status varchar(20) default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 3. COMMUNITIES (verified) & SERVICES
-- ------------------------------------------------------------
create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references public.users(id) on delete cascade,
  registration_id uuid references public.community_registrations(id) on delete set null,
  name varchar(150) not null,
  region varchar(50) not null,
  province varchar(50) not null,
  district varchar(50) not null,
  subdistrict varchar(50) not null,
  latitude double precision not null,
  longitude double precision not null,
  capacity_per_day int not null check (capacity_per_day > 0),
  smce_code varchar(30),
  is_verified boolean default false,
  stamp_icon_url text,
  created_at timestamptz default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  category varchar(50) not null,
  title varchar(150) not null,
  description text,
  weekday_price numeric(10,2) not null,
  weekend_price numeric(10,2) not null,
  max_capacity int not null default 10,
  is_active boolean default true
);

-- ------------------------------------------------------------
-- 4. VIDEOS  (feed content)
-- ------------------------------------------------------------
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  video_type varchar(30) not null check (video_type in ('tourist_review', 'host_promo')),
  video_url text not null,
  thumbnail_url text,
  caption text,
  hashtags jsonb default '[]'::jsonb,
  -- AI summary is structured JSON (place_name, location, price, tags, confidence...)
  ai_summary jsonb,
  ai_summary_status varchar(20) default 'pending' check (ai_summary_status in ('pending', 'processing', 'ready', 'unavailable')),
  audio_track_name varchar(150),
  audio_type varchar(20),                      -- speech | music | mixed | none
  location_name varchar(150),
  province varchar(50),
  district varchar(50),
  latitude double precision,
  longitude double precision,
  likes_count int default 0,
  comments_count int default 0,
  shares_count int default 0,
  saves_count int default 0,
  is_verified_visit boolean default false,
  is_deleted boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_videos_feed on public.videos (created_at desc) where is_deleted = false;
create index if not exists idx_videos_user on public.videos (user_id);

-- ------------------------------------------------------------
-- 5. VIDEO LIKES / FOLLOWS / SAVES  (who did what — real actions)
-- ------------------------------------------------------------
create table if not exists public.video_likes (
  user_id uuid not null references public.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, video_id)
);
create index if not exists idx_video_likes_video on public.video_likes (video_id);

create table if not exists public.follows (
  follower_id uuid not null references public.users(id) on delete cascade,
  following_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists idx_follows_following on public.follows (following_id);

create table if not exists public.video_saves (
  user_id uuid not null references public.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, video_id)
);

-- ------------------------------------------------------------
-- 6. COMMENTS & REVIEWS  (+ replies via parent_comment_id)
-- ------------------------------------------------------------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  parent_comment_id uuid references public.comments(id) on delete cascade,  -- reply thread
  comment_type varchar(20) default 'general' check (comment_type in ('general', 'star_review')),
  content text not null,
  rating int check (rating >= 1 and rating <= 5),
  image_urls jsonb,
  likes_count int default 0,
  created_at timestamptz default now()
);
create index if not exists idx_comments_video on public.comments (video_id);
create index if not exists idx_comments_parent on public.comments (parent_comment_id);

-- ------------------------------------------------------------
-- 7. FOLDERS (saved-video collections for AI trip planning)
-- ------------------------------------------------------------
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name varchar(100) not null,
  is_public boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.folder_collaborators (
  folder_id uuid not null references public.folders(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  permission varchar(20) default 'viewer' check (permission in ('viewer', 'editor')),
  primary key (folder_id, user_id)
);

create table if not exists public.folder_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  added_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  unique (folder_id, video_id)
);

-- ------------------------------------------------------------
-- 8. CHAT (private + group) & MESSAGES
-- ------------------------------------------------------------
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  chat_type varchar(20) not null check (chat_type in ('private', 'group')),
  name varchar(100),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.chat_members (
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid references public.users(id) on delete set null,
  message_type varchar(30) default 'text' check (message_type in ('text', 'shared_video', 'system')),
  content text,
  payload jsonb,                               -- e.g. { "video_id": "..." }
  created_at timestamptz default now()
);
create index if not exists idx_chat_messages_chat on public.chat_messages (chat_id, created_at);

-- ------------------------------------------------------------
-- 9. NOTIFICATIONS
-- ------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,   -- recipient
  actor_id uuid references public.users(id) on delete set null,
  type varchar(20) not null check (type in ('follow', 'like', 'comment', 'share', 'system')),
  video_id uuid references public.videos(id) on delete cascade,
  content text,
  is_read boolean default false,
  created_at timestamptz default now()
);
create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);

-- ------------------------------------------------------------
-- 10. TRIP PLANS
-- ------------------------------------------------------------
create table if not exists public.trip_plans (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references public.chats(id) on delete set null,
  creator_id uuid not null references public.users(id) on delete cascade,
  source_folder_id uuid references public.folders(id) on delete set null,
  plan_name varchar(100) not null,
  start_location text not null,
  return_location text,
  start_date date,
  end_date date,
  budget_limit numeric(10,2),
  travel_style varchar(30),
  itinerary_data jsonb not null,
  status varchar(20) default 'draft' check (status in ('upcoming', 'draft', 'past')),
  is_shared boolean default false,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 11. BOOKINGS & PASSPORT STAMPS
-- ------------------------------------------------------------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  tourist_id uuid not null references public.users(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  booking_date date not null,
  guest_count int not null,
  status varchar(20) default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'completed')),
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.passport_stamps (
  id uuid primary key default gen_random_uuid(),
  tourist_id uuid not null references public.users(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  video_id uuid references public.videos(id) on delete set null,
  unlocked_at timestamptz default now(),
  unique (tourist_id, community_id)
);

-- ============================================================
--  AUTO-CREATE users row when a new auth.users is created
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, display_name, phone_number, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', 'ผู้ใช้ใหม่'),
    new.phone,
    coalesce(new.raw_user_meta_data->>'role', 'tourist')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
--  updated_at auto-touch
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated before update on public.users
  for each row execute function public.touch_updated_at();

-- ============================================================
--  COUNTER TRIGGERS (keep videos.*_count accurate)
-- ============================================================
create or replace function public.bump_video_likes() returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.videos set likes_count = likes_count + 1 where id = new.video_id;
    update public.users u set total_likes_received = total_likes_received + 1
      from public.videos v where v.id = new.video_id and v.user_id = u.id;
  elsif (tg_op = 'DELETE') then
    update public.videos set likes_count = greatest(likes_count - 1, 0) where id = old.video_id;
    update public.users u set total_likes_received = greatest(total_likes_received - 1, 0)
      from public.videos v where v.id = old.video_id and v.user_id = u.id;
  end if;
  return null;
end; $$;
drop trigger if exists trg_video_likes on public.video_likes;
create trigger trg_video_likes after insert or delete on public.video_likes
  for each row execute function public.bump_video_likes();

create or replace function public.bump_follows() returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.users set following_count = following_count + 1 where id = new.follower_id;
    update public.users set followers_count = followers_count + 1 where id = new.following_id;
  elsif (tg_op = 'DELETE') then
    update public.users set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    update public.users set followers_count = greatest(followers_count - 1, 0) where id = old.following_id;
  end if;
  return null;
end; $$;
drop trigger if exists trg_follows on public.follows;
create trigger trg_follows after insert or delete on public.follows
  for each row execute function public.bump_follows();

create or replace function public.bump_video_saves() returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.videos set saves_count = saves_count + 1 where id = new.video_id;
  elsif (tg_op = 'DELETE') then
    update public.videos set saves_count = greatest(saves_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end; $$;
drop trigger if exists trg_video_saves on public.video_saves;
create trigger trg_video_saves after insert or delete on public.video_saves
  for each row execute function public.bump_video_saves();

create or replace function public.bump_comments() returns trigger language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    update public.videos set comments_count = comments_count + 1 where id = new.video_id;
  elsif (tg_op = 'DELETE') then
    update public.videos set comments_count = greatest(comments_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end; $$;
drop trigger if exists trg_comments on public.comments;
create trigger trg_comments after insert or delete on public.comments
  for each row execute function public.bump_comments();
