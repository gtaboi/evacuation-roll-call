-- 003: let admins link a check-in whose typed name doesn't match the staff list to the right person.
-- Run once in Supabase → SQL Editor on a project that already ran schema.sql (and 002).
-- A mark with checkin_device set means "this staff-list person is the one who checked in on that phone".

alter table public.marks add column if not exists checkin_device text;
