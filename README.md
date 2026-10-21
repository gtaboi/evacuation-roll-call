# Evacuation Roll Call

A web app for tracking who is safe during an evacuation. Staff sign in, go to the assembly point and tap **Check in**. The app uses the phone's GPS and only accepts a "safe" check-in within 100 m of the active assembly point. "I need help" always goes through. Admins start and end evacuations, see who is still missing, and track how fast everyone was accounted for.

- **Hosting:** GitHub Pages (static files only)
- **Sign-in and database:** [Supabase](https://supabase.com) (free tier is enough)

## Roles

| | Staff (anyone who signs in) | Admin |
|---|---|---|
| Check in safe (GPS within radius) / ask for help | ✓ | ✓ |
| See the live counts and who has checked in | ✓ | ✓ |
| Start / end an evacuation, pick dry or wet weather point | | ✓ |
| Expected staff list, "Not checked in", Mark safe | | ✓ |
| Performance: time to 90% / 100%, curve, past evacuations | | ✓ |
| Manage admins | | ✓ |

Rules are enforced by the database (row level security in `supabase/schema.sql`), not just hidden in the page.

## Setup (about 15 minutes)

### 1. Create the Supabase project
1. Sign up at supabase.com and create a new project (any region close to your site).
2. Open **SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql).
3. On the last line, replace `you@example.com` with **your** email, then click **Run**. That email becomes the first admin.

### 2. Configure sign-in
In Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://hermannwwr-cmyk.github.io/evacuation-roll-call/`
- **Redirect URLs:** add the same URL.

Email sign-in links work out of the box. Supabase's built-in email sender only allows a few emails per hour, so before rolling out to many staff, set up your own SMTP under **Authentication → Emails → SMTP Settings**, or enable Google / Microsoft sign-in under **Authentication → Providers**. Then add `"google"` or `"azure"` to `providers` in `config.js`.

### 3. Connect the app
In Supabase → **Project Settings → API**, copy the **Project URL** and the **anon public** key into [`config.js`](config.js):

```js
export const SUPABASE_URL = "https://xxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
```

The anon key is designed to be public; the database rules decide what each person can do. Commit and push; GitHub Pages redeploys in a minute or two.

### 4. First run (as admin)
1. Open the site and sign in with the email from step 1.
2. **Assembly points:** go to each point, tap **Use my location**, add a name and directions, and **Save**. Use **Check on map** to confirm the pin.
3. **Expected staff:** add each person's name and work email (the email they sign in with).
4. **Admins:** add anyone else who should run evacuations.
5. Run a short drill: **Start · dry weather**, have a few people check in, **End evacuation**, then look at **Past evacuations**.

## How GPS check-in works
- Location is read only when someone taps a check-in button. The app stores the **distance** from the point and the GPS accuracy, not the coordinates.
- A safe check-in needs the distance to be within the point's radius (default 100 m, adjustable per point). Phones indoors can be off by 20–50 m, so check in outdoors at the point.
- If someone can't share location (blocked, no signal, old phone), an admin confirms them another way and uses **Mark safe**.
- The distance is measured by the phone, so a determined person could fake it. The check stops casual "checked in from my desk" mistakes, not deliberate cheating.

## Files
- `index.html`, `styles.css`, `app.js`: the app
- `config.js`: your Supabase project settings
- `supabase/schema.sql`: tables, security rules and realtime setup
- `evacuation-roll-call.html`: the earlier claude.ai artifact version (only runs on claude.ai)
