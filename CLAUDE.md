# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Evacuation Roll Call: staff check in at an assembly point during an evacuation; admins run the roll call and track performance. A static site on GitHub Pages (`https://hermannwwr-cmyk.github.io/evacuation-roll-call/`) backed by Supabase (Postgres + Auth + Realtime). README.md has the full Supabase setup steps.

## Commands

There is no build step, package.json, linter or test suite. The site is plain ES modules loaded straight by the browser; the Supabase client comes from jsDelivr (`@supabase/supabase-js@2.45.4/+esm`).

- **Run locally:** serve the folder over HTTP (ES modules don't load from `file://`) and open `index.html`. Geolocation needs `localhost` or HTTPS.
- **Syntax check:** `node --check` won't parse `app.js` as a module under its `.js` name; copy it to a `.mjs` file first and check that.
- **Deploy:** push to `main`. GitHub Pages serves the repo root; `gh api repos/hermannwwr-cmyk/evacuation-roll-call/pages/builds/latest` shows the build status.
- **Settings from `.env`:** `node tools/env-to-config.mjs` copies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `GOOGLE_MAPS_API_KEY` from the git-ignored `.env` into `config.js` (the only file the browser reads). It refuses non-`anon` Supabase keys. Bump `?v=` afterwards.
- **Database changes:** there is no migration runner. SQL is pasted into the Supabase SQL Editor by the project owner.

## Release rule: bump the cache version

Pages caches files for ~10 minutes and phones keep stale copies, so asset URLs carry `?v=N`. On every release, bump the same number in all three places: `index.html` (`styles.css?v=` and `app.js?v=`) and the `./config.js?v=` import at the top of `app.js`.

## Architecture

**Two roles, two security paths.**
- **Staff never sign in.** They type a full name and check in through `security definer` Postgres functions: `public_checkin`, `my_checkin`, `roll_counts`. They have no direct table access to `checkins`. A random `device_id` kept in `localStorage` (`rollcall.device`) identifies the phone, so a person can update their own check-in. `public_checkin` calls `checkin_allowed()`, which enforces that the event is active and that a `safe` check-in's distance is within `events.point.radius` (default 100 m). `help` always passes.
- **Admins sign in** with Supabase email/password (accounts are created in the Supabase dashboard; there is no sign-up in the app). Admin rights come from the `admins` table (lowercase email), checked by `is_admin()` from the JWT email. RLS gates every admin table with `is_admin()`. A signed-in user who isn't on the list is signed straight back out.

**Data model** (`supabase/schema.sql`):
- `events`: the newest row is "the current event". Starting an event deactivates any active one and inserts a new row. `events.point` holds a snapshot of the dry- or wet-weather assembly point (`{name, directions, lat, lng, radius}`), copied from `settings.points` at start or switch time. Later edits to settings don't affect a running event until an admin taps "Send point to staff".
- `checkins`: primary key `(event_id, device_id)`. Stores distance and accuracy, never coordinates.
- `roster` (expected staff) is matched to check-ins **by normalized name** (trimmed, collapsed spaces, lowercase) in the client (`normName` / `rollState` in `app.js`). `marks` records admin "Mark safe" per event and roster entry.
- `event_summaries`: written by the client when an admin ends an event (times, t50/t90/t100). Performance history is read only from here.
- `settings`: a single row (`id = 1`) holding the target minutes and both assembly points.

**Client (`app.js`)** is one module with a single state object `S` and a full re-render (`render()`) after every data load.
- Writes go through `run(action, fn)`, which sets `busy`, maps errors to messages, and finishes with `refreshAll()`.
- `refreshAll()` reloads the current event plus the staff RPCs, and all admin tables when `S.isAdmin`.
- Realtime `postgres_changes` just triggers a debounced `refreshAll()`. Anonymous staff only subscribe to `events` (RLS hides the rest), so a 15 s poll keeps their counts fresh.
- Views are switched by `data-view="user|admin"` attributes toggled in `applyView()`. Screens (`setup` / `signin` / `app`) are switched by `showScreen()`.
- `styles.css` ends with `[hidden] { display: none !important; }`. Display rules on `.card` and `.wrap` would otherwise override the `hidden` attribute.

**`config.js`** holds the Supabase URL and the **anon** key (public by design; RLS and the functions are the security boundary), plus `options.providers`, `options.defaultRadiusM` and the optional `options.googleMapsApiKey`. An empty URL or key shows the setup screen.

**AI helper** (`supabase/functions/assist/index.ts`, a Deno Supabase Edge Function): the only server-side code. The browser calls it with `sb.functions.invoke("assist", {body: {task, event_id}})`, task `match` or `report`. It creates a Supabase client with the caller's own JWT, checks `is_admin()`, reads data under normal RLS, and calls an OpenAI-compatible `/chat/completions` endpoint configured by the function secrets `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` (OpenCode Go + `glm-5.3-flash`; Go rejects requests without an `x-opencode-session` header). `match` validates the model's JSON against the real names before returning. Accepting a match upserts a `marks` row with `checkin_device` set, which `rollState()` treats as "this check-in is that roster person" (a mark without `checkin_device` means "marked safe by an admin"). Debriefs are saved into `event_summaries.data.report`. The function can't be run locally here (no Deno); deploy it through the Supabase dashboard or CLI.

**Google Maps** is used only in the admin "Assembly points" form and is loaded lazily (`loadGoogleMaps()`), only when a key is set. Place suggestions use the Places API (New) programmatic `AutocompleteSuggestion` (the legacy `Autocomplete` widget isn't available to new Google Cloud customers). The map picker keeps a fixed CSS pin over the map centre and reads `map.getCenter()`, so it needs no marker library or Map ID. Without a key, "Pick on map" opens google.com/maps in a new tab, and `parseCoords()` reads pasted `lat, lng` text or full Maps links from each point's "Paste from Google Maps" box. Latitude, longitude and radius are hidden inputs (no visible fields); radius is always `defaultRadiusM` when a point is saved.

## SQL files

- `supabase/schema.sql` is the fresh-install script and must always describe the current full state.
- Existing projects upgrade with numbered files (`supabase/002-name-only-checkin.sql`). For any schema change, update `schema.sql` **and** add the next numbered upgrade file.
- The committed `schema.sql` keeps `you@example.com` as the first-admin placeholder on its last line. The owner's local copy may have a real address there that shouldn't be committed.

## `evacuation-roll-call.html`

An older, separate version built as a claude.ai Artifact: published at `https://claude.ai/artifact/L27hU61mxfmmXHV63F3ye7` and updated with the Artifact tool. It only runs inside claude.ai and uses that runtime (`window.claude.use("db")` / `use("user")`, roles from the artifact's share levels). It shares no code with the Pages app beyond the original styles, so changes to one aren't automatically wanted in the other.
