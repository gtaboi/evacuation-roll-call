// Paste your Supabase project values here (Supabase → Project Settings → API).
// The anon key is meant to be public; access is enforced by the row level security in supabase/schema.sql.
export const SUPABASE_URL = "https://dhtultcxusihzjqvcwiv.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRodHVsdGN4dXNpaHpqcXZjd2l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NTk0MjIsImV4cCI6MjEwODEzNTQyMn0.Gx_dUYMUcMddle5tZw4vNnojzT1JdnHDdXvNIgxIB8Y"; // anon public key

export const options = {
  // Admin sign-in methods to offer. "email" is email + password (logins created in Supabase).
  // Add "google" or "azure" (Microsoft) after enabling them in Supabase → Authentication → Providers.
  providers: ["email"],
  // Check-in radius around an assembly point, in metres. Applied when an admin saves a point.
  defaultRadiusM: 100,
  // Optional Google Maps browser key (Maps JavaScript API + Places API (New)), restricted to this site's address.
  // With a key, admins get place suggestions and an in-page map to set the pin. Without one, "Pick on map" opens Google Maps in a new tab.
  googleMapsApiKey: "",
};
