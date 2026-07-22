-- Row Level Security for SignalCollector.
--
-- Model:
--  * Users own their sessions, observations and location samples outright.
--  * Intersections are a shared/public catalog: any signed-in user can read
--    them and propose new ones; only the creator may update or delete their
--    own proposals.
--  * Nobody can read or modify another user's observations.
--
-- The mobile app only ever holds the anon key; every request is constrained
-- by these policies. The service-role key must never ship in the app.

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.intersections enable row level security;
alter table public.movements enable row level security;
alter table public.collection_sessions enable row level security;
alter table public.signal_observations enable row level security;
alter table public.location_samples enable row level security;

-- profiles ---------------------------------------------------------
create policy "profiles: read own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles: update own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- devices ----------------------------------------------------------
create policy "devices: crud own"
  on public.devices for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- intersections ----------------------------------------------------
create policy "intersections: read for authenticated"
  on public.intersections for select
  to authenticated
  using (true);

create policy "intersections: propose new"
  on public.intersections for insert
  to authenticated
  with check (created_by = auth.uid() or source = 'seed');

create policy "intersections: update own proposals"
  on public.intersections for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "intersections: delete own proposals"
  on public.intersections for delete
  to authenticated
  using (created_by = auth.uid());

-- movements --------------------------------------------------------
create policy "movements: read for authenticated"
  on public.movements for select
  to authenticated
  using (true);

create policy "movements: insert for authenticated"
  on public.movements for insert
  to authenticated
  with check (true);

-- collection_sessions ----------------------------------------------
create policy "sessions: crud own"
  on public.collection_sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- signal_observations (ownership via parent session) ----------------
create policy "observations: read own"
  on public.signal_observations for select
  using (exists (
    select 1 from public.collection_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ));

create policy "observations: insert own"
  on public.signal_observations for insert
  with check (exists (
    select 1 from public.collection_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ));

create policy "observations: update own"
  on public.signal_observations for update
  using (exists (
    select 1 from public.collection_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.collection_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ));

create policy "observations: delete own"
  on public.signal_observations for delete
  using (exists (
    select 1 from public.collection_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ));

-- location_samples ---------------------------------------------------
create policy "samples: read own"
  on public.location_samples for select
  using (exists (
    select 1 from public.collection_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ));

create policy "samples: insert own"
  on public.location_samples for insert
  with check (exists (
    select 1 from public.collection_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ));

create policy "samples: delete own"
  on public.location_samples for delete
  using (exists (
    select 1 from public.collection_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ));
