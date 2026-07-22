-- Seed data for SignalCollector.
-- Apply after migrations: supabase db push && psql ... -f supabase/seed.sql
-- (or paste into the Supabase SQL editor)

-- ------------------------------------------------------------------
-- Seed intersections (Austin, TX examples)
-- ------------------------------------------------------------------
insert into public.intersections (id, name, latitude, longitude, city, state, timezone, source)
values
  ('11111111-1111-4111-8111-111111111101', 'Congress Ave & E 5th St',    30.26640, -97.74310, 'Austin', 'TX', 'America/Chicago', 'seed'),
  ('11111111-1111-4111-8111-111111111102', 'Guadalupe St & W 24th St',   30.28870, -97.74200, 'Austin', 'TX', 'America/Chicago', 'seed'),
  ('11111111-1111-4111-8111-111111111103', 'S Lamar Blvd & Barton Springs Rd', 30.26380, -97.76350, 'Austin', 'TX', 'America/Chicago', 'seed'),
  ('11111111-1111-4111-8111-111111111104', 'Airport Blvd & E 45th St',   30.30460, -97.71660, 'Austin', 'TX', 'America/Chicago', 'seed'),
  ('11111111-1111-4111-8111-111111111105', 'Burnet Rd & W Anderson Ln',  30.35880, -97.73930, 'Austin', 'TX', 'America/Chicago', 'seed')
on conflict (id) do nothing;

-- Common movements at the seed intersections
insert into public.movements (id, intersection_id, approach_direction, movement_type, description)
values
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111101', 'northbound', 'through',   'Congress Ave NB through'),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111101', 'northbound', 'left_turn', 'Congress Ave NB protected left'),
  ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111102', 'southbound', 'through',   'Guadalupe SB through'),
  ('22222222-2222-4222-8222-222222222204', '11111111-1111-4111-8111-111111111103', 'eastbound',  'through',   'Barton Springs EB through'),
  ('22222222-2222-4222-8222-222222222205', '11111111-1111-4111-8111-111111111104', 'westbound',  'right_turn','E 45th WB right')
on conflict (id) do nothing;

-- ------------------------------------------------------------------
-- Synthetic demonstration session
--
-- Sessions require a real auth user (RLS + FK to auth.users). After you
-- have signed in to the app at least once, find your user id:
--   select id, email from auth.users;
-- then run this block, replacing YOUR_USER_ID.
-- ------------------------------------------------------------------
-- Uncomment and edit:
--
-- do $$
-- declare
--   demo_user uuid := 'YOUR_USER_ID';
--   demo_session uuid := '33333333-3333-4333-8333-333333333301';
--   t0 timestamptz := now() - interval '2 hours';
--   t0_ms bigint := (extract(epoch from (now() - interval '2 hours')) * 1000)::bigint;
-- begin
--   insert into public.collection_sessions
--     (id, user_id, intersection_id, approach_direction, movement_type,
--      started_at, ended_at, notes, status)
--   values
--     (demo_session, demo_user, '11111111-1111-4111-8111-111111111101',
--      'northbound', 'through', t0, t0 + interval '6 minutes',
--      'Synthetic demo session: three clean RED->GREEN->YELLOW->RED cycles.',
--      'completed')
--   on conflict (id) do nothing;
--
--   -- Three complete cycles: RED 60s, GREEN 45s, YELLOW 5s (~110s cycle)
--   insert into public.signal_observations
--     (client_generated_id, session_id, intersection_id, state, observed_at,
--      device_timestamp_ms, latitude, longitude, accuracy_meters, source)
--   select
--     gen_random_uuid(), demo_session, '11111111-1111-4111-8111-111111111101',
--     v.state, t0 + (v.offset_s || ' seconds')::interval,
--     t0_ms + v.offset_s * 1000,
--     30.26640, -97.74310, 8.0, 'import'
--   from (values
--     ('RED',      0), ('GREEN',   60), ('YELLOW', 105), ('RED',    110),
--     ('GREEN',  170), ('YELLOW', 215), ('RED',    220),
--     ('GREEN',  280), ('YELLOW', 325), ('RED',    330)
--   ) as v(state, offset_s)
--   on conflict (client_generated_id) do nothing;
-- end $$;
