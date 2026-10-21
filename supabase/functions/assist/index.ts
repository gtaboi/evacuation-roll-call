// Supabase Edge Function "assist": AI help for admins, using an OpenAI-compatible LLM (OpenCode Go).
//   task "match":  suggest which staff-list names unmatched check-ins belong to.
//   task "report": write a short debrief for a finished evacuation.
// The LLM key lives only in this function's secrets (LLM_API_KEY, LLM_BASE_URL, LLM_MODEL), never in the website.
// Data is read with the caller's own login, so the database's admin-only rules still apply.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const BASE = (Deno.env.get("LLM_BASE_URL") ?? "https://opencode.ai/zen/go/v1").replace(/\/+$/, "");
const MODEL = Deno.env.get("LLM_MODEL") ?? "deepseek-v4.1-flash";
const KEY = Deno.env.get("LLM_API_KEY") ?? "";

const normName = (n: string) => (n ?? "").trim().replace(/\s+/g, " ").toLowerCase();

async function llm(messages: { role: string; content: string }[], session: string, maxTokens: number) {
  const res = await fetch(BASE + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + KEY,
      "Content-Type": "application/json",
      "User-Agent": "evacuation-roll-call/1.0",
      // OpenCode Go routes and caches by a stable per-conversation session id.
      "x-opencode-session": session,
    },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.2, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error("The AI service answered " + res.status + ": " + (await res.text()).slice(0, 200));
  const body = await res.json();
  return String(body?.choices?.[0]?.message?.content ?? "").trim();
}

function parseJson(text: string) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const fmtSec = (s: number | null | undefined) =>
  s == null ? "not reached" : Math.floor(s / 60) + " min " + String(Math.round(s % 60)).padStart(2, "0") + " s";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!KEY) return json({ error: "The AI helper has no LLM_API_KEY secret set in Supabase." }, 500);

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: isAdmin } = await sb.rpc("is_admin");
    if (!isAdmin) return json({ error: "Only admins can use the AI helper." }, 403);

    const { task, event_id } = await req.json();
    const eventId = Number(event_id);
    if (!Number.isFinite(eventId)) return json({ error: "Missing event_id." }, 400);

    const [ev, checkins, roster, marks] = await Promise.all([
      sb.from("events").select("*").eq("id", eventId).maybeSingle(),
      sb.from("checkins").select("device_id,name,status,distance_m,first_at,at").eq("event_id", eventId),
      sb.from("roster").select("id,name"),
      sb.from("marks").select("roster_id,status,at,checkin_device").eq("event_id", eventId),
    ]);
    for (const r of [ev, checkins, roster, marks]) if (r.error) throw r.error;
    if (!ev.data) return json({ error: "That evacuation wasn't found." }, 404);

    const markByRoster = new Map(marks.data!.map((m) => [m.roster_id, m]));
    const linkedDevices = new Set(marks.data!.filter((m) => m.checkin_device).map((m) => m.checkin_device));
    const rosterByName = new Map(roster.data!.map((p) => [normName(p.name), p]));
    const matchedRoster = new Set<string>();
    for (const c of checkins.data!) {
      const p = rosterByName.get(normName(c.name));
      if (p) matchedRoster.add(p.id);
    }
    for (const m of marks.data!) matchedRoster.add(m.roster_id);

    if (task === "match") {
      const unmatched = checkins.data!.filter((c) => !rosterByName.has(normName(c.name)) && !linkedDevices.has(c.device_id));
      const open = roster.data!.filter((p) => !matchedRoster.has(p.id));
      if (!unmatched.length || !open.length) return json({ matches: [] });

      const answer = await llm([
        {
          role: "system",
          content: "You match names typed by people checking in during a workplace evacuation to an official staff list. " +
            "Only match when it is very likely the same person: typos, nicknames, initials, missing or swapped surname, different spacing. " +
            "Never guess between two plausible staff names. Each staff name can be used at most once. " +
            'Reply with JSON only: {"matches":[{"checkin":"<exact typed name>","staff":"<exact staff name>","reason":"<under 8 words>"}]}. ' +
            'Use names exactly as given. Return {"matches":[]} if nothing is likely.',
        },
        { role: "user", content: JSON.stringify({ typed_names: [...new Set(unmatched.map((c) => c.name))], staff_list: open.map((p) => p.name) }) },
      ], "rollcall-match-" + eventId, 1500);

      const openByName = new Map(open.map((p) => [p.name, p]));
      const used = new Set<string>();
      const matches = [];
      for (const m of parseJson(answer).matches ?? []) {
        const p = openByName.get(m.staff);
        const c = unmatched.find((x) => x.name === m.checkin);
        if (!p || !c || used.has(p.id)) continue; // ignore anything not exactly from the lists
        used.add(p.id);
        matches.push({ device_id: c.device_id, checkin_name: c.name, roster_id: p.id, roster_name: p.name, reason: String(m.reason ?? "").slice(0, 80) });
      }
      return json({ matches });
    }

    if (task === "report") {
      const [summary, settings] = await Promise.all([
        sb.from("event_summaries").select("data").eq("event_id", eventId).maybeSingle(),
        sb.from("settings").select("target_min").eq("id", 1).maybeSingle(),
      ]);
      if (!summary.data) return json({ error: "End the evacuation first; the debrief uses its final numbers." }, 400);
      const d = summary.data.data;
      const start = Date.parse(ev.data.started_at);
      const people = checkins.data!.map((c) => ({
        name: c.name,
        status: c.status,
        minutes_after_alarm: Math.round((Date.parse(c.first_at) - start) / 6000) / 10,
        distance_m: c.distance_m,
        on_staff_list: rosterByName.has(normName(c.name)) || linkedDevices.has(c.device_id),
      }));
      const markedSafe = roster.data!.filter((p) => markByRoster.has(p.id) && !markByRoster.get(p.id)!.checkin_device).map((p) => p.name);
      const neverAccounted = roster.data!.filter((p) => !matchedRoster.has(p.id)).map((p) => p.name);
      const facts = {
        date: new Date(start).toISOString(),
        weather_point: ev.data.weather, assembly_point: ev.data.point?.name ?? null,
        target_minutes_to_100_percent: settings.data?.target_min ?? 10,
        duration: fmtSec((d.endedAt - d.startedAt) / 1000),
        expected_staff: d.expected, accounted_for: d.accounted, need_help: d.help,
        time_to_50_percent: fmtSec(d.t50), time_to_90_percent: fmtSec(d.t90), time_to_100_percent: fmtSec(d.t100),
        checkins: people, marked_safe_by_admin: markedSafe, never_accounted_for: neverAccounted,
      };
      const report = await llm([
        {
          role: "system",
          content: "You write short debriefs for a workplace evacuation coordinator, using only the facts given. " +
            "Plain text, no markdown headings or tables, under 220 words. Cover: the result against the target; " +
            "how fast people were accounted for (50/90/100%); anyone who needed help, was marked safe by an admin, checked in late, " +
            "or was never accounted for, by name; then 2–3 concrete improvements for the next drill. Don't invent facts.",
        },
        { role: "user", content: JSON.stringify(facts) },
      ], "rollcall-report-" + eventId, 2500);
      return json({ report });
    }

    return json({ error: "Unknown task." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
