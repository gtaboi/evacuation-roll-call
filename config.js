// Paste your Supabase project values here (Supabase → Project Settings → API).
// The anon key is meant to be public; access is enforced by the row level security in supabase/schema.sql.
export const SUPABASE_URL = "";        // e.g. "https://abcdefghijklm.supabase.co"
export const SUPABASE_ANON_KEY = "";   // the "anon public" key

export const options = {
  // Sign-in methods to offer. "email" sends a one-time sign-in link and needs no extra setup.
  // Add "google" or "azure" (Microsoft) after enabling them in Supabase → Authentication → Providers.
  providers: ["email"],
  // Default check-in radius around an assembly point, in metres. Admins can change it per point.
  defaultRadiusM: 100,
};
