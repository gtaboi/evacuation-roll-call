-- 002: staff check in with their full name only; only admins sign in.
-- Run once in Supabase → SQL Editor on a project that already ran schema.sql.
-- It recreates the checkins table, so any test check-ins are deleted.

drop table if exists public.checkins cascade;

-- One row per phone per event. device_id is a random value kept on the phone, so a person can update their own check-in.
create table public.checkins (
  event_id bigint not null references public.events on delete cascade,
  device_id text not null check (char_length(device_id) between 20 and 64),
  name text not null check (char_length(name) between 1 and 60),
  status text not null check (status in ('safe', 'help')),
  note text check (char_length(note) <= 80),
  distance_m numeric,        -- distance from the assembly point when checking in
  accuracy_m numeric,        -- phone-reported GPS accuracy
  first_at timestamptz not null default now(),
  at timestamptz not null default now(),
  primary key (event_id, device_id)
);

alter table public.checkins enable row level security;

-- Only admins read check-ins directly; staff go through the functions below.
create policy "checkins admin read" on public.checkins for select to authenticated using (public.is_admin());
create policy "checkins admin delete" on public.checkins for delete to authenticated using (public.is_admin());

-- Staff (not signed in) need to see the current event and its assembly point.
drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select to anon, authenticated using (true);

-- Check in or update this phone's check-in. Safe check-ins must be inside the point's radius.
create or replace function public.public_checkin(
  p_event bigint, p_device text, p_name text, p_status text,
  p_note text default null, p_distance numeric default null, p_accuracy numeric default null)
returns public.checkins language plpgsql security definer set search_path = public as $$
declare r public.checkins;
begin
  if p_device is null or char_length(p_device) not between 20 and 64 then
    raise exception 'invalid device id' using errcode = '22023';
  end if;
  if coalesce(btrim(p_name), '') = '' or char_length(btrim(p_name)) > 60 then
    raise exception 'full name required' using errcode = '22023';
  end if;
  if not public.checkin_allowed(p_event, p_status, p_distance) then
    raise exception 'check-in not allowed' using errcode = '42501';
  end if;
  insert into checkins (event_id, device_id, name, status, note, distance_m, accuracy_m)
  values (p_event, p_device, btrim(p_name), p_status, nullif(left(btrim(coalesce(p_note, '')), 80), ''),
          round(p_distance), round(p_accuracy))
  on conflict (event_id, device_id) do update
    set name = excluded.name, status = excluded.status, note = excluded.note,
        distance_m = excluded.distance_m, accuracy_m = excluded.accuracy_m, at = now()
  returning * into r;
  return r;
end $$;

-- This phone's own check-in for an event, if any.
create or replace function public.my_checkin(p_event bigint, p_device text)
returns setof public.checkins language sql stable security definer set search_path = public as $$
  select * from checkins where event_id = p_event and device_id = p_device;
$$;

-- Live counts for the staff page, without exposing names.
create or replace function public.roll_counts(p_event bigint)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'safe', count(*) filter (where status = 'safe'),
    'help', count(*) filter (where status = 'help'),
    'total', count(*))
  from checkins where event_id = p_event;
$$;

grant execute on function public.public_checkin(bigint, text, text, text, text, numeric, numeric) to anon, authenticated;
grant execute on function public.my_checkin(bigint, text) to anon, authenticated;
grant execute on function public.roll_counts(bigint) to anon, authenticated;

-- Put check-ins back on the realtime feed (dropping the table removed it).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'checkins') then
    alter publication supabase_realtime add table public.checkins;
  end if;
end $$;
