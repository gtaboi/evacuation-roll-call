// Copies SUPABASE_URL, SUPABASE_ANON_KEY and GOOGLE_MAPS_API_KEY from .env into config.js.
// The browser can't read .env, so config.js stays the file the site loads; everything else in it is kept.
// Usage (from the repo root): node tools/env-to-config.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

let env;
try {
  env = readEnv(join(root, ".env"));
} catch {
  console.error("No .env found. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

// Refuse keys that must never reach the browser.
const anon = env.SUPABASE_ANON_KEY || "";
try {
  const role = JSON.parse(Buffer.from(anon.split(".")[1] || "", "base64url").toString()).role;
  if (role && role !== "anon") {
    console.error("SUPABASE_ANON_KEY has role \"" + role + "\". Only the anon public key may go in config.js.");
    process.exit(1);
  }
} catch { /* not a JWT (e.g. empty or a newer publishable key); leave it to Supabase */ }

const file = join(root, "config.js");
let config = readFileSync(file, "utf8");
const set = (pattern, value, name) => {
  if (!pattern.test(config)) { console.error("Couldn't find " + name + " in config.js."); process.exit(1); }
  config = config.replace(pattern, (_m, before, _old, after) => before + JSON.stringify(value) + after);
};
set(/(export const SUPABASE_URL = )("[^"]*")(;)/, env.SUPABASE_URL || "", "SUPABASE_URL");
set(/(export const SUPABASE_ANON_KEY = )("[^"]*")(;)/, anon, "SUPABASE_ANON_KEY");
set(/(googleMapsApiKey: )("[^"]*")(,)/, env.GOOGLE_MAPS_API_KEY || "", "googleMapsApiKey");
writeFileSync(file, config);

console.log("config.js updated from .env. Bump the ?v= numbers in index.html and app.js before you push.");
