// Run with `npm test` (node --test). Covers the shared roll-call rule in roll.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchRoll, timeTo } from "../roll.js";

const T0 = Date.parse("2026-10-27T09:00:00Z");
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const roster = [{ id: "a", name: "Anna Lee" }, { id: "b", name: "Ben Ong" }, { id: "c", name: "Cara Tan" }];
const checkin = (device_id, name, sec) => ({ device_id, name, status: "safe", first_at: at(sec), at: at(sec) });
const seconds = (r) => [...r.accountedAt.values()].map((t) => (t - T0) / 1000).sort((x, y) => x - y);

test("exact name match ignores case and extra spaces", () => {
  const r = matchRoll({ roster, checkins: [checkin("d1", "  anna   LEE ", 30)], marks: [] });
  assert.equal(r.personOf.get("d1").id, "a");
  assert.deepEqual(r.missing.map((p) => p.id), ["b", "c"]);
});

test("visitors and second phones don't count towards accounted (issue #3)", () => {
  const checkins = [checkin("d1", "Anna Lee", 30), checkin("d2", "Visitor 1", 40), checkin("d3", "Visitor 2", 50), checkin("d4", "anna lee", 60)];
  const r = matchRoll({ roster, checkins, marks: [] });
  assert.equal(r.accountedAt.size, 1);
  assert.deepEqual(seconds(r), [30]);
  assert.deepEqual(r.unmatched.map((c) => c.device_id), ["d2", "d3"]);
  assert.equal(timeTo(seconds(r), roster.length, 1), null);
});

test("a person is accounted for at their earliest check-in", () => {
  const r = matchRoll({ roster, checkins: [checkin("d1", "Ben Ong", 90), checkin("d2", "Ben Ong", 20)], marks: [] });
  assert.deepEqual(seconds(r), [20]);
});

test("an admin link wins over a different typed name (issue #1)", () => {
  const checkins = [checkin("d1", "Anna Lee", 30)];
  const marks = [{ roster_id: "b", status: "safe", at: at(45), checkin_device: "d1" }];
  const r = matchRoll({ roster, checkins, marks });
  assert.equal(r.personOf.get("d1").id, "b");
  assert.deepEqual(r.missing.map((p) => p.id).sort(), ["a", "c"]);
});

test("a link to a check-in that no longer exists doesn't account for anyone", () => {
  const marks = [{ roster_id: "c", status: "safe", at: at(45), checkin_device: "gone" }];
  const r = matchRoll({ roster, checkins: [], marks });
  assert.equal(r.accountedAt.size, 0);
  assert.deepEqual(r.markedSafe, []);
});

test("a mark without a device means marked safe by an admin, at the mark's time", () => {
  const marks = [{ roster_id: "c", status: "safe", at: at(120), checkin_device: null }];
  const r = matchRoll({ roster, checkins: [checkin("d1", "Anna Lee", 30)], marks });
  assert.deepEqual(r.markedSafe.map((p) => p.id), ["c"]);
  assert.deepEqual(seconds(r), [30, 120]);
});

test("a mark for someone who also checked in isn't counted twice", () => {
  const marks = [{ roster_id: "a", status: "safe", at: at(10), checkin_device: null }];
  const r = matchRoll({ roster, checkins: [checkin("d1", "Anna Lee", 30)], marks });
  assert.deepEqual(r.markedSafe, []);
  assert.deepEqual(seconds(r), [30]);
});

test("timeTo needs the full share of expected staff", () => {
  assert.equal(timeTo([10, 20, 30], 3, 1), 30);
  assert.equal(timeTo([10, 20, 30], 3, 0.5), 20);
  assert.equal(timeTo([10, 20], 3, 1), null);
  assert.equal(timeTo([10], 0, 1), null);
});

test("the AI helper's copy of the rule matches roll.js", () => {
  const block = (path) => {
    const text = readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const m = text.match(/\/\/ ---- roll rule: start ----\n[\s\S]*?\/\/ ---- roll rule: end ----/);
    assert.ok(m, "roll rule markers missing in " + path);
    return m[0];
  };
  assert.equal(block("../supabase/functions/assist/index.ts"), block("../roll.js"));
});
