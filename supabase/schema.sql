-- Evacuation Roll Call — Supabase schema.
-- Run once in Supabase → SQL Editor. Safe to re-run: it drops and recreates policies and functions.
-- Last line: replace the email with your own to make yourself the first admin.

-- ---------- tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  name text,
  updated_at timestamptz not null default now()
);

create table if not exists public.admins (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

-- One row per evacuation or drill. The newest row is the current event.
create table if not exists public.events (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  active boolean not null default true,
  weather text check (weather in ('dry', 'wet')),
  point jsonb,               -- {name, directions, lat, lng, radius}
  started_by uuid references auth.users
);

-- Staff don't sign in: one row per phone per event. device_id is a random value kept on the phone.
create table if not exists public.checkins (
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

-- Expected staff, matched to check-ins by full name. (email is unused, kept for older installs.)
create table if not exists public.roster (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) <= 60),
  email text check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table if not exists public.marks (
  event_id bigint not null references public.events on delete cascade,
  roster_id uuid not null references public.roster on delete cascade,
  status text not null default 'safe' check (status in ('safe', 'help')),
  at timestamptz not null default now(),
  checkin_device text,       -- set when an admin links this person to a check-in whose typed name didn't match
  primary key (event_id, roster_id)
);
alter table public.marks add column if not exists checkin_device text;

create table if not exists public.event_summaries (
  event_id bigint primary key references public.events on delete cascade,
  data jsonb not null
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  target_min int not null default 10 check (target_min between 1 and 120),
  points jsonb not null default '{}'::jsonb   -- {dry: {...}, wet: {...}}
);

-- ---------- helper functions ----------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

-- A safe check-in must be inside the active point's radius; "I need help" is always allowed.
create or replace function public.checkin_allowed(p_event bigint, p_status text, p_distance numeric)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from events e
    where e.id = p_event and e.active
      and (p_status = 'help'
           or (p_status = 'safe'
               and p_distance is not null
               and (e.point ->> 'lat') is not null
               and p_distance <= coalesce((e.point ->> 'radius')::numeric, 100)))
  );
$$;

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

-- ---------- row level security ----------

alter table public.profiles enable row level security;
alter table public.admins enable row level security;
alter table public.events enable row level security;
alter table public.checkins enable row level security;
alter table public.roster enable row level security;
alter table public.marks enable row level security;
alter table public.event_summaries enable row level security;
alter table public.settings enable row level security;

drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles write own" on public.profiles;
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles write own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "admins read" on public.admins;
drop policy if exists "admins manage" on public.admins;
create policy "admins read" on public.admins for select to authenticated
  using (public.is_admin() or email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "admins manage" on public.admins for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "events read" on public.events;
drop policy if exists "events manage" on public.events;
create policy "events read" on public.events for select to anon, authenticated using (true);
create policy "events manage" on public.events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Only admins read check-ins directly; staff use public_checkin / my_checkin / roll_counts.
drop policy if exists "checkins admin read" on public.checkins;
drop policy if exists "checkins admin delete" on public.checkins;
create policy "checkins admin read" on public.checkins for select to authenticated using (public.is_admin());
create policy "checkins admin delete" on public.checkins for delete to authenticated using (public.is_admin());

drop policy if exists "roster admin" on public.roster;
create policy "roster admin" on public.roster for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "marks admin" on public.marks;
create policy "marks admin" on public.marks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "summaries admin" on public.event_summaries;
create policy "summaries admin" on public.event_summaries for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "settings admin" on public.settings;
create policy "settings admin" on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- realtime ----------

do $$
declare t text;
begin
  foreach t in array array['events', 'checkins', 'profiles', 'roster', 'marks', 'event_summaries', 'settings', 'admins'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

insert into public.settings (id) values (1) on conflict do nothing;

-- ---------- first admin: put your own sign-in email here ----------
insert into public.admins (email) values (lower('you@example.com')) on conflict do nothing;
