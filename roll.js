// Roll-call rules shared by the website (app.js) and the AI helper (supabase/functions/assist/index.ts).
// Pure functions only: no DOM, no Supabase. The block between the "roll rule" markers is copied verbatim
// into index.ts (the Edge Function is deployed on its own); tests/roll.test.mjs fails if the copies differ.

// ---- roll rule: start ----
const normName = (n) => (n || "").trim().replace(/\s+/g, " ").toLowerCase();

// Who each check-in belongs to, and who on the staff list is accounted for.
// A check-in belongs to a staff-list person by an admin link (a mark carrying checkin_device), which wins,
// or else by exact normalized name. A link only counts while its check-in exists. A mark without a device
// means "marked safe by an admin". Each person is accounted for once, at their earliest check-in
// (first_at), or at the mark's time if they were only marked safe.
function matchRoll({ roster, checkins, marks }) {
  const rosterById = new Map(), rosterByName = new Map(), linkByDevice = new Map();
  for (const p of roster) { rosterById.set(p.id, p); rosterByName.set(normName(p.name), p); }
  for (const m of marks) if (m.checkin_device) linkByDevice.set(m.checkin_device, m.roster_id);
  const personOf = new Map();
  const accountedAt = new Map();
  const unmatched = [];
  for (const c of checkins) {
    const linkedId = linkByDevice.get(c.device_id);
    const p = (linkedId && rosterById.get(linkedId)) || rosterByName.get(normName(c.name)) || null;
    personOf.set(c.device_id, p);
    if (!p) { unmatched.push(c); continue; }
    const t = Date.parse(c.first_at);
    if (!accountedAt.has(p.id) || t < accountedAt.get(p.id)) accountedAt.set(p.id, t);
  }
  const markedSafe = [];
  for (const m of marks) {
    const p = rosterById.get(m.roster_id);
    if (!p || m.checkin_device || accountedAt.has(p.id)) continue;
    markedSafe.push(p);
    accountedAt.set(p.id, Date.parse(m.at));
  }
  const missing = roster.filter((p) => !accountedAt.has(p.id));
  return { personOf, accountedAt, markedSafe, missing, unmatched };
}
// ---- roll rule: end ----

// Seconds from the start of the event until `share` (0–1) of the expected staff were accounted for, or null.
function timeTo(times, expected, share) {
  if (!expected) return null;
  const need = Math.ceil(share * expected);
  return times.length >= need ? times[need - 1] : null;
}

export { normName, matchRoll, timeTo };
