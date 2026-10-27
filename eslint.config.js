import js from "@eslint/js";
import globals from "globals";

export default [
  // The Edge Function is Deno/TypeScript, the promo and the Artifact are separate projects.
  { ignores: ["supabase/**", "promo/**", "evacuation-roll-call.html", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: { sourceType: "module", globals: { ...globals.browser, google: "readonly" } },
    // `x == null` is used on purpose to catch null and undefined together.
    rules: { eqeqeq: ["error", "always", { null: "ignore" }] },
  },
  { files: ["tools/**/*.mjs", "tests/**/*.mjs"], languageOptions: { globals: globals.node } },
];
