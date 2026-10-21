# Evacuation Roll Call

A web app for tracking who is safe during an evacuation. Staff open the page, enter their **full name** and tap **Check in** at the assembly point. There's no account or password for staff. The app uses the phone's GPS and only accepts a "safe" check-in within 100 m of the active assembly point. "I need help" always goes through. Admins sign in to start and end evacuations, see who is still missing, and track how fast everyone was accounted for.

- **Hosting:** GitHub Pages (static files only)
- **Database and admin sign-in:** [Supabase](https://supabase.com) (free tier is enough)

## Roles

| | Staff (no sign-in) | Admin (signs in) |
|---|---|---|
| Check in safe (GPS within radius) / ask for help, with full name | ✓ | ✓ |
| See live counts (safe / need help / checked in) | ✓ | ✓ |
| See names of who has checked in | | ✓ |
| Start / end an evacuation, pick dry or wet weather point | | ✓ |
| Expected staff list, "Not checked in", Mark safe | | ✓ |
| Performance: time to 90% / 100%, curve, past evacuations | | ✓ |
| Manage admins | | ✓ |

Rules are enforced by the database (row level security and functions in `supabase/schema.sql`), not just hidden in the page. Staff can only check in through a database function that checks the evacuation is running and the distance is inside the radius.

## Setup (about 15 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com and create a new project (any region close to your site).
2. Open **SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql).
3. On the last line, replace `you@example.com` with **your** email, then click **Run**. That email is on the admin list.

**Already ran an older `schema.sql`?** Run [`supabase/002-name-only-checkin.sql`](supabase/002-name-only-checkin.sql) once instead. It switches staff to name-only check-in (and deletes any test check-ins).

### 2. Create admin logins
Admins sign in with **email and password**. For each admin:
1. Supabase → **Authentication → Users → Add user → Create new user**, enter their email and a password, tick **Auto confirm user**.
2. Make sure the same email is on the admin list (the first one comes from step 1; add others from the app's **Admins** section).

A login that isn't on the admin list is signed straight out again.

For **Forgot password?** to work, set Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://hermannwwr-cmyk.github.io/evacuation-roll-call/`
- **Redirect URLs:** add the same URL.

### 3. Connect the app
In Supabase → **Project Settings → API**, copy the **Project URL** and the **anon public** key into [`config.js`](config.js):

```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
```

The anon key is designed to be public; the database rules decide what each person can do. Commit and push; GitHub Pages redeploys in a minute or two.

### 4. First run (as admin)
1. Open the site, tap **Admin sign in**, and sign in.
2. **Assembly points:** go to each point, tap **Use my location**, add a name and directions, and **Save**. Use **Check on map** to confirm the pin.
3. **Expected staff:** add each person's full name, spelled the way they'll type it.
4. **Admins:** add anyone else who should run evacuations (and create their login, step 2).
5. Run a short drill: **Start · dry weather**, have a few people check in, **End evacuation**, then look at **Past evacuations**.

## How check-in works
- Staff type their full name once; the phone remembers it, and a random ID stored on the phone lets them update their own check-in (for example from "safe" to "need help").
- Check-ins are matched to the expected staff list by name, ignoring capitals and extra spaces. A name that doesn't match shows as "Not on staff list" for admins, who can mark the right person safe by hand.
- Location is read only when someone taps a check-in button. The app stores the **distance** from the point and the GPS accuracy, not the coordinates.
- A safe check-in needs the distance to be within the point's radius (default 100 m, adjustable per point). Phones indoors can be off by 20–50 m, so check in outdoors at the point.
- If someone can't share location (blocked, no signal, old phone), an admin confirms them another way and uses **Mark safe**.

## Limits to know
- Without accounts, anyone with the link can check in under any name while an evacuation is running. Keep the link inside your organisation.
- The distance is measured by the phone, so a determined person could fake it. The check stops casual "checked in from my desk" mistakes, not deliberate cheating.

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `config.js`: your Supabase project settings
- `supabase/schema.sql`: tables, security rules, functions and realtime setup (fresh install)
- `supabase/002-name-only-checkin.sql`: upgrade for projects set up before name-only check-in
- `evacuation-roll-call.html`: the earlier claude.ai artifact version (only runs on claude.ai)
