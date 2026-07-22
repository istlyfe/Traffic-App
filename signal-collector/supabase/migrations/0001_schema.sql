-- SignalCollector initial schema
-- Apply with: supabase db push   (or run in the Supabase SQL editor)

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- profiles: one row per auth user, created automatically by trigger
-- ------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------
-- devices
-- ------------------------------------------------------------------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  model text,
  app_version text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- intersections (ids are client-generated UUIDs so offline-created
-- intersections keep stable identity across sync)
-- ------------------------------------------------------------------
create table if not exists public.intersections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  city text,
  state text,
  timezone text,
  source text not null default 'user' check (source in ('seed', 'user', 'import')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- movements
-- ------------------------------------------------------------------
create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  intersection_id uuid not null references public.intersections (id) on delete cascade,
  approach_direction text not null
    check (approach_direction in ('northbound', 'southbound', 'eastbound', 'westbound')),
  movement_type text not null
    check (movement_type in ('through', 'left_turn', 'right_turn', 'pedestrian', 'unknown')),
  description text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- collection_sessions (id = client-generated UUID)
-- The mobile schema denormalizes approach/movement onto the session so
-- collection works offline before a movements row exists remotely.
-- ------------------------------------------------------------------
create table if not exists public.collection_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  intersection_id uuid references public.intersections (id) on delete set null,
  movement_id uuid references public.movements (id) on delete set null,
  approach_direction text
    check (approach_direction in ('northbound', 'southbound', 'eastbound', 'westbound')),
  movement_type text
    check (movement_type in ('through', 'left_turn', 'right_turn', 'pedestrian', 'unknown')),
  movement_description text,
  started_at timestamptz not null,
  ended_at timestamptz,
  notes text,
  status text not null default 'active' check (status in ('active', 'completed', 'discarded')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- signal_observations
-- client_generated_id is the idempotency key: retried uploads upsert on
-- it, so a retry can never create a duplicate observation.
-- ------------------------------------------------------------------
create table if not exists public.signal_observations (
  id uuid primary key default gen_random_uuid(),
  client_generated_id uuid not null unique,
  session_id uuid not null references public.collection_sessions (id) on delete cascade,
  intersection_id uuid references public.intersections (id) on delete set null,
  movement_id uuid references public.movements (id) on delete set null,
  state text not null check (state in
    ('RED', 'YELLOW', 'GREEN', 'FLASHING_RED', 'FLASHING_YELLOW', 'DARK', 'UNKNOWN')),
  observed_at timestamptz not null,
  device_timestamp_ms bigint not null,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  heading_degrees double precision check (heading_degrees >= 0 and heading_degrees < 360),
  speed_mps double precision check (speed_mps >= 0),
  accuracy_meters double precision check (accuracy_meters >= 0),
  altitude_meters double precision,
  source text not null default 'manual' check (source in ('manual', 'import')),
  sync_status text not null default 'synced',
  note text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- location_samples
-- ------------------------------------------------------------------
create table if not exists public.location_samples (
  id uuid primary key default gen_random_uuid(),
  client_generated_id uuid not null unique,
  session_id uuid not null references public.collection_sessions (id) on delete cascade,
  observed_at timestamptz not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  heading_degrees double precision check (heading_degrees >= 0 and heading_degrees < 360),
  speed_mps double precision check (speed_mps >= 0),
  accuracy_meters double precision check (accuracy_meters >= 0)
);

-- ------------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------------
create index if not exists idx_movements_intersection on public.movements (intersection_id);
create index if not exists idx_sessions_user on public.collection_sessions (user_id);
create index if not exists idx_sessions_intersection on public.collection_sessions (intersection_id);
create index if not exists idx_sessions_movement on public.collection_sessions (movement_id);
create index if not exists idx_obs_session on public.signal_observations (session_id);
create index if not exists idx_obs_intersection on public.signal_observations (intersection_id);
create index if not exists idx_obs_movement on public.signal_observations (movement_id);
create index if not exists idx_obs_observed_at on public.signal_observations (observed_at);
create index if not exists idx_obs_client_id on public.signal_observations (client_generated_id);
create index if not exists idx_samples_session on public.location_samples (session_id);
create index if not exists idx_samples_observed_at on public.location_samples (observed_at);
