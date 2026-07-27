-- Re-point sessions from hand-created intersections to the official
-- Broward GIS signals, then remove the leftovers.
--
-- Why: intersections added by hand in the field (source_id IS NULL) have
-- informal names and hand-dropped coordinates, so they neither dedupe nor
-- link to the county's published timing. The imported GIS signals
-- (source_id LIKE 'bcgis:%') are surveyed positions with stable ids.
--
-- Matching is by POSITION, not name: a GPS pin dropped at the stop bar is
-- within a few tens of metres of the surveyed signal, whereas the typed
-- names vary ("Sheridan &I95 3").
--
-- Run STEP 1, eyeball the distances, then run STEP 2 and STEP 3.
-- Everything is inside a transaction you must COMMIT yourself.

-- ===================================================================
-- STEP 1 — REVIEW. Nothing is modified.
-- ===================================================================
with user_ix as (
  select id, name, latitude, longitude
  from public.intersections
  where source_id is null
)
select distinct on (u.id)
  u.name                                   as hand_typed_name,
  g.name                                   as official_name,
  g.source_id,
  round((111320 * sqrt(
      power(g.latitude  - u.latitude, 2) +
      power((g.longitude - u.longitude) * cos(radians(u.latitude)), 2)
  ))::numeric, 1)                          as metres_apart,
  (select count(*) from public.collection_sessions s where s.intersection_id = u.id)
                                           as sessions_affected
from user_ix u
join public.intersections g
  on  g.source_id is not null
  and abs(g.latitude  - u.latitude)  < 0.01   -- ~1.1 km box, then rank by true distance
  and abs(g.longitude - u.longitude) < 0.01
order by u.id,
         111320 * sqrt(
           power(g.latitude  - u.latitude, 2) +
           power((g.longitude - u.longitude) * cos(radians(u.latitude)), 2)
         );

-- Expect tens of metres. Anything over ~150 m is probably NOT the same
-- intersection — exclude that id from STEP 2 before running it.


-- ===================================================================
-- STEP 2 — RE-LINK sessions to the official signal.
-- ===================================================================
begin;

with user_ix as (
  select id, latitude, longitude
  from public.intersections
  where source_id is null
),
best as (
  select distinct on (u.id)
    u.id as user_id,
    g.id as gis_id,
    111320 * sqrt(
      power(g.latitude  - u.latitude, 2) +
      power((g.longitude - u.longitude) * cos(radians(u.latitude)), 2)
    ) as metres
  from user_ix u
  join public.intersections g
    on  g.source_id is not null
    and abs(g.latitude  - u.latitude)  < 0.01
    and abs(g.longitude - u.longitude) < 0.01
  order by u.id,
           111320 * sqrt(
             power(g.latitude  - u.latitude, 2) +
             power((g.longitude - u.longitude) * cos(radians(u.latitude)), 2)
           )
)
update public.collection_sessions s
set    intersection_id = b.gis_id
from   best b
where  s.intersection_id = b.user_id
  and  b.metres <= 150;          -- safety rail: only confident matches

-- Check the row count looks right, then:
commit;
-- (or: rollback;)


-- ===================================================================
-- STEP 3 — DELETE the now-unreferenced hand-created intersections.
-- ===================================================================
begin;

delete from public.intersections i
where i.source_id is null
  and not exists (
    select 1 from public.collection_sessions s where s.intersection_id = i.id
  );

commit;

-- Afterwards, in the app: Settings -> "Restore my data from cloud" (or just
-- reopen it) so the phone picks up the corrected names and drops the
-- deleted local copies.
