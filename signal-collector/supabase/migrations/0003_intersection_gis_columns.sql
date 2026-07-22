-- GIS import support: device type, maintaining agency and a stable
-- source_id used as the idempotency key for re-runnable seed imports.

alter table public.intersections
  add column if not exists device_type text,
  add column if not exists maintaining_agency text,
  add column if not exists source_id text;

-- Unique only where present: user-created intersections have no source_id.
create unique index if not exists idx_intersections_source_id
  on public.intersections (source_id)
  where source_id is not null;
