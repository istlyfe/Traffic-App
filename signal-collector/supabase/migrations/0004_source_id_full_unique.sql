-- Fix: PostgREST upserts use plain ON CONFLICT (source_id), which cannot
-- target a PARTIAL unique index. A full unique index works because Postgres
-- treats NULLs as distinct, so the many user-created intersections with
-- source_id IS NULL never collide.

drop index if exists public.idx_intersections_source_id;

create unique index if not exists idx_intersections_source_id_unique
  on public.intersections (source_id);
