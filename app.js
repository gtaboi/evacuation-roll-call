import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, options } from "./config.js?v=10";

const $ = (id) => document.getElementById(id);
const WEATHER = { dry: "Dry weather", wet: "Wet weather" };
const DEFAULT_RADIUS = options.defaultRadiusM || 100;

const S = {
  uid: null, email: null, isAdmin: false, view: "user",
  event: null,          // newest events row
  mine: null,           // this phone's check-in for the current event
  counts: { safe: 0, help: 0, total: 0 },
  checkins: [],         // admin: all check-ins for the current event
  roster: [],           // admin: expected staff
  marks: {},            // admin: roster_id -> {status, at}
  summaries: [],        // admin: [{event_id, data}]
  settings: { target_min: 10, points: {} },
  admins: [],
  selected: null,       // event_id shown in the chart; null = current
  matches: [],          // admin: AI-suggested links {device_id, checkin_name, roster_id, roster_name, reason}
  matching: false,
  reporting: false,
  busy: false,
};
let sb = null, channel = null;

// ---------- this phone ----------

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

// A random id kept on the phone, so a person can update their own check-in without an account.
let memDevice = null;
function deviceId() {
  try {
    let d = localStorage.getItem("rollcall.device");
    if (!d) { d = randomHex(16); localStorage.setItem("rollcall.device", d); }
    return d;
  } catch {
    return memDevice || (memDevice = randomHex(16));
  }
}
function savedName() {
  try { return localStorage.getItem("rollcall.name") || ""; } catch { return ""; }
}
function rememberName(name) {
  try { localStorage.setItem("rollcall.name", name); } catch { /* not kept on this phone */ }
}

// ---------- formatting ----------

const ms = (t) => (t ? Date.parse(t) : null);
const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDate = (t) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
function fmtAgo(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + " min ago";
  return Math.floor(m / 60) + " h " + (m % 60) + " min ago";
}
function fmtDur(sec) {
  if (sec == null) return "–";
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return h + "h " + String(m).padStart(2, "0") + "m";
  return m + "m " + String(s).padStart(2, "0") + "s";
}
const fmtM = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m");
const mapUrl = (p) => "https://www.google.com/maps/search/?api=1&query=" + p.lat + "," + p.lng;
const normName = (n) => (n || "").trim().replace(/\s+/g, " ").toLowerCase();

function showError(text) {
  $("error").textContent = text || "";
  $("error").hidden = !text;
}

function errText(e, action) {
  const code = e && (e.code || "");
  if (code === "42501" || /row-level security|permission/i.test((e && e.message) || ""))
    return "You don't have permission to " + action + ".";
  if (code === "23505") return "That entry already exists.";
  return "Couldn't " + action + ". Check your connection and try again.";
}

async function run(action, fn) {
  if (S.busy) return false;
  S.busy = true; showError(""); render();
  try { await fn(); return true; }
  catch (e) { console.error(e); showError(e.userMessage || errText(e, action)); return false; }
  finally { S.busy = false; await refreshAll(); }
}

// Supabase returns {data, error}; throw the error so run() can report it.
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// ---------- location ----------

function getPosition(timeout) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: "unsupported" });
    navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), reject,
      { enableHighAccuracy: true, timeout, maximumAge: 0 });
  });
}

function distanceM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function gpsErrorText(e) {
  if (e && e.code === 1) return "Location is blocked for this site. Allow location for this page in your browser settings, then tap again. If you can't, tell a warden: an admin can mark you safe.";
  if (e && e.code === 3) return "Your phone couldn't find your location in time. Step into open sky and tap again.";
  if (e && e.code === "unsupported") return "This browser can't share location. Try another browser, or tell a warden so an admin can mark you safe.";
  return "Your phone couldn't find your location. Turn on location services and tap again.";
}

function setGps(kind, text) {
  const el = $("gps");
  el.hidden = !text;
  el.className = "gps" + (kind ? " " + kind : "");
  $("gpsText").textContent = text || "";
}

// ---------- data ----------

async function loadEvent() {
  const rows = await q(sb.from("events").select("*").order("started_at", { ascending: false }).limit(1));
  S.event = rows[0] || null;
}
async function loadMine() {
  if (!S.event) { S.mine = null; S.counts = { safe: 0, help: 0, total: 0 }; return; }
  const [mine, counts] = await Promise.all([
    q(sb.rpc("my_checkin", { p_event: S.event.id, p_device: deviceId() })),
    q(sb.rpc("roll_counts", { p_event: S.event.id })),
  ]);
  S.mine = (mine && mine[0]) || null;
  S.counts = counts || { safe: 0, help: 0, total: 0 };
}
async function loadAdminData() {
  if (!S.isAdmin) return;
  const ev = S.event;
  const [checkins, roster, settings, admins, sums, marks] = await Promise.all([
    ev ? q(sb.from("checkins").select("*").eq("event_id", ev.id)) : Promise.resolve([]),
    q(sb.from("roster").select("*").order("name")),
    q(sb.from("settings").select("*").eq("id", 1)),
    q(sb.from("admins").select("*").order("email")),
    q(sb.from("event_summaries").select("*").order("event_id", { ascending: false }).limit(50)),
    ev ? q(sb.from("marks").select("*").eq("event_id", ev.id)) : Promise.resolve([]),
  ]);
  S.checkins = checkins;
  S.roster = roster;
  S.settings = settings[0] || { target_min: 10, points: {} };
  S.admins = admins;
  S.summaries = sums;
  S.marks = Object.fromEntries(marks.map((m) => [m.roster_id, m]));
}

let refreshing = null;
async function refreshAll() {
  if (!sb) return;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      await loadEvent();
      await Promise.all([loadMine(), loadAdminData()]);
    } catch (e) {
      console.error(e);
      showError("Couldn't load the latest roll call. Check your connection; the page retries automatically.");
    } finally {
      refreshing = null;
      render();
    }
  })();
  return refreshing;
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshAll, 250);
}

// Staff only hear about events; admins also hear check-ins and their own lists change.
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("roll-call");
  const tables = S.isAdmin ? ["events", "checkins", "roster", "marks", "event_summaries", "settings", "admins"] : ["events"];
  for (const t of tables) channel.on("postgres_changes", { event: "*", schema: "public", table: t }, scheduleRefresh);
  channel.subscribe();
}

// ---------- roll call (admin) ----------

function timeTo(times, expected, share) {
  if (!expected) return null;
  const need = Math.ceil(share * expected);
  return times.length >= need ? times[need - 1] : null;
}

// A check-in belongs to a staff-list person by exact (normalized) name, or by an admin link
// (a mark carrying checkin_device). Plain marks without a device are "marked safe by an admin".
function rollState() {
  const ev = S.event;
  const rosterById = new Map(S.roster.map((p) => [p.id, p]));
  const rosterByName = new Map(S.roster.map((p) => [normName(p.name), p]));
  const linkByDevice = new Map(Object.values(S.marks).filter((m) => m.checkin_device).map((m) => [m.checkin_device, m.roster_id]));
  const matched = new Set();
  const rows = S.checkins.map((c) => {
    const linkedId = linkByDevice.get(c.device_id);
    const p = (linkedId && rosterById.get(linkedId)) || rosterByName.get(normName(c.name));
    if (p) matched.add(p.id);
    return {
      key: c.device_id, device: c.device_id, name: c.name, status: c.status, note: c.note,
      distance: c.distance_m, accuracy: c.accuracy_m, at: ms(c.at), firstAt: ms(c.first_at), marked: false,
      onRoster: !!p, linkedTo: linkedId && p ? p : null,
    };
  });
  for (const p of S.roster) {
    if (matched.has(p.id)) continue;
    const m = S.marks[p.id];
    if (m && !m.checkin_device) rows.push({ key: p.id, name: p.name, status: m.status, at: ms(m.at), firstAt: ms(m.at), marked: true, rosterId: p.id, onRoster: true });
  }
  rows.sort((a, b) => (a.status === "help" ? 0 : 1) - (b.status === "help" ? 0 : 1) || b.at - a.at);
  const missing = ev ? S.roster.filter((p) => !matched.has(p.id) && !(S.marks[p.id] && !S.marks[p.id].checkin_device)) : [];
  const unmatched = rows.filter((r) => !r.marked && !r.onRoster);
  const times = ev ? rows.map((r) => Math.max(0, (r.firstAt - ms(ev.started_at)) / 1000)).sort((a, b) => a - b) : [];
  return { rows, missing, unmatched, times };
}

// ---------- rendering helpers ----------

function initialBadge(name) {
  const d = document.createElement("div");
  d.className = "initial";
  d.textContent = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return d;
}

function personRow(name, detail, extras) {
  const li = document.createElement("li");
  const who = document.createElement("div");
  who.className = "who";
  const b = document.createElement("b");
  b.textContent = name;
  who.append(b);
  if (detail) {
    const sm = document.createElement("small");
    sm.textContent = detail;
    who.append(sm);
  }
  li.append(initialBadge(name), who, ...extras);
  return li;
}

function pill(kind, text) {
  const s = document.createElement("span");
  s.className = "pill " + kind;
  s.textContent = text;
  return s;
}

function smallBtn(text, cls, onClick) {
  const b = document.createElement("button");
  b.className = "btn small " + (cls || "");
  b.textContent = text;
  b.disabled = S.busy;
  b.onclick = onClick;
  return b;
}

// ---------- rendering ----------

function showScreen(name) {
  $("setupScreen").hidden = name !== "setup";
  $("signinScreen").hidden = name !== "signin";
  $("appScreen").hidden = name !== "app";
  $("footer").hidden = name !== "app";
}

function applyView() {
  const admin = S.isAdmin && S.view === "admin";
  document.querySelectorAll("[data-view]").forEach((el) => {
    if (el.id === "missingBlock") return;
    el.hidden = el.dataset.view !== (admin ? "admin" : "user");
  });
  $("tabs").hidden = !S.isAdmin;
  $("tabUser").setAttribute("aria-current", admin ? "false" : "page");
  $("tabAdmin").setAttribute("aria-current", admin ? "page" : "false");
  $("tagline").textContent = admin
    ? "Admin: run the roll call and track how fast everyone is accounted for."
    : "Check in when you reach the assembly point.";
  $("meLabel").textContent = S.isAdmin ? "Signed in as " + S.email + " · admin" : "";
  $("authToggle").textContent = S.uid ? "Sign out" : "Admin sign in";
}

function renderStatus() {
  const box = $("status");
  box.classList.remove("active", "ended");
  const admin = S.isAdmin && S.view === "admin";
  const ev = S.event;
  if (ev && ev.active) {
    box.classList.add("active");
    $("statusTitle").textContent = "Evacuation in progress";
    $("statusSub").textContent = "Started " + fmtClock(ms(ev.started_at)) + " (" + fmtAgo(ms(ev.started_at)) + ")." + (admin ? "" : " Check in now.");
  } else if (ev) {
    box.classList.add("ended");
    $("statusTitle").textContent = "Evacuation ended";
    $("statusSub").textContent = "Ran " + fmtClock(ms(ev.started_at)) + "–" + fmtClock(ms(ev.ended_at || ev.started_at)) + " on " + fmtDate(ms(ev.started_at)) + ".";
  } else {
    $("statusTitle").textContent = "No evacuation in progress";
    $("statusSub").textContent = admin
      ? "Start one when the alarm sounds. Staff can then check in from this page."
      : "Check-in opens when an admin starts the roll call.";
  }

  const cc = $("coordControls");
  cc.hidden = !admin;
  cc.replaceChildren();
  if (admin) {
    const set = document.createElement("div");
    set.className = "startset";
    const mk = (text, cls, fn) => {
      const b = document.createElement("button");
      b.className = "btn" + (cls ? " " + cls : "");
      b.textContent = text;
      b.disabled = S.busy;
      b.onclick = fn;
      set.append(b);
    };
    if (ev && ev.active) {
      const other = ev.weather === "wet" ? "dry" : "wet";
      const saved = ev.weather && (S.settings.points || {})[ev.weather];
      if (saved && saved.name && JSON.stringify(saved) !== JSON.stringify(ev.point || null)) {
        mk("Send point to staff", "go", () => switchWeather(ev.weather));
      }
      mk("Switch to " + WEATHER[other].toLowerCase() + " point", "", () => switchWeather(other));
      mk("End evacuation", "", endEvent);
    } else {
      mk("Start · dry weather", "danger", () => startEvent("dry"));
      mk("Start · wet weather", "danger", () => startEvent("wet"));
    }
    cc.append(set);
  }

  const p = ev && ev.active && ev.point;
  $("pointCard").hidden = !(p && p.name);
  if (p && p.name) {
    $("pointLabel").textContent = (WEATHER[ev.weather] || "Assembly") + " · go to this assembly point";
    $("pointName").textContent = p.name;
    $("pointDir").textContent = p.directions || "";
    $("pointDir").hidden = !p.directions;
    const hasCoords = p.lat != null && p.lng != null;
    $("pointMap").hidden = !hasCoords;
    if (hasCoords) {
      const a = document.createElement("a");
      a.href = mapUrl(p); a.target = "_blank"; a.rel = "noopener";
      a.textContent = "Open in maps";
      $("pointMap").replaceChildren(a);
    }
  }
}

function renderMine() {
  const ev = S.event;
  const active = !!(ev && ev.active);
  const me = S.mine;
  const radius = (ev && ev.point && ev.point.radius) || DEFAULT_RADIUS;
  $("btnSafe").disabled = !active || S.busy;
  $("btnHelp").disabled = !active || S.busy;
  $("btnSafeLabel").textContent = me ? "Update: I'm safe" : "Check in: I'm safe";
  $("safeHint").textContent = "Uses your phone's location. You must be within " + radius + " m of the assembly point.";
  const box = $("mine");
  box.hidden = !me;
  if (me) {
    box.className = "mine " + me.status;
    $("mineTitle").textContent = (me.status === "help" ? "Help requested for " : "Checked in as safe: ") + me.name;
    const bits = [fmtClock(ms(me.at))];
    if (me.distance_m != null) bits.push(fmtM(me.distance_m) + " from the point");
    if (me.note) bits.push(me.note);
    $("mineSub").textContent = bits.join(" · ");
  }
  if (document.activeElement !== $("myName") && !$("myName").value) $("myName").value = savedName();
  $("uHelp").textContent = S.counts.help || 0;
  $("uSafe").textContent = S.counts.safe || 0;
  $("uTotal").textContent = S.counts.total || 0;
}

function renderPerformance(st) {
  const ev = S.event;
  const expected = S.roster.length;
  const acc = st.rows.length;
  const help = st.rows.filter((r) => r.status === "help").length;
  const live = !!(ev && ev.active);
  const start = ev && ms(ev.started_at);
  const span = ev ? ((live ? Date.now() : ms(ev.ended_at) || Date.now()) - start) / 1000 : 0;
  const pct = expected ? Math.min(100, Math.round((acc / expected) * 100)) : null;
  const t100 = timeTo(st.times, expected, 1);
  const targetMin = S.settings.target_min || 10;
  const target = targetMin * 60;

  $("liveMeta").textContent = ev ? (live ? "Elapsed " : "Lasted ") + fmtDur(span) : "";
  $("kAccV").textContent = !ev ? "–" : expected ? pct + "%" : String(acc);
  $("kAccS").textContent = !ev ? "No event yet" : expected ? acc + " of " + expected + " expected" : "Add expected staff for a %";
  $("kMissV").textContent = ev && expected ? st.missing.length : "–";
  $("kMiss").classList.toggle("hot", !!(live && st.missing.length));
  $("kHelpV").textContent = ev ? help : "–";
  $("kHelp").classList.toggle("bad", help > 0);
  if (t100 != null) {
    $("kTimeV").textContent = fmtDur(t100);
    $("kTimeS").textContent = (t100 <= target ? "Within " : "Over ") + targetMin + " min target";
  } else {
    $("kTimeV").textContent = ev ? fmtDur(span) : "–";
    $("kTimeS").textContent = !ev ? "Target " + targetMin + " min" : live ? "Still running · target " + targetMin + " min" : "Not everyone accounted for";
  }
  $("kTime").classList.toggle("bad", !!ev && (t100 != null ? t100 > target : span > target));
  $("progBar").style.width = (pct || 0) + "%";
  $("prog").setAttribute("aria-valuenow", pct || 0);

  const h = S.selected != null && S.summaries.find((x) => x.event_id === S.selected);
  if (h) {
    const d = h.data;
    $("chartSub").textContent = "Showing " + fmtDate(d.startedAt) + " " + fmtClock(d.startedAt);
    drawChart(d.times || [], d.expected, (d.endedAt - d.startedAt) / 1000, targetMin, true);
  } else {
    $("chartSub").textContent = ev ? (live ? "Live · updates as people check in" : "Latest event") : "";
    drawChart(st.times, expected, span, targetMin, !!ev);
  }
}

function niceStep(maxMin) {
  for (const s of [1, 2, 5, 10, 15, 30, 60]) if (maxMin / s <= 6) return s;
  return 120;
}

function drawChart(times, expected, spanSec, targetMin, hasEvent) {
  const el = $("chart");
  if (!hasEvent) {
    el.innerHTML = '<div class="msg info">The curve appears once an evacuation starts: how many people were accounted for, minute by minute.</div>';
    return;
  }
  const W = 640, H = 230, L = 40, R = 16, T = 14, B = 30;
  const target = targetMin * 60;
  const last = times.length ? times[times.length - 1] : 0;
  const maxMin = Math.max(1, Math.ceil(Math.max(spanSec, last, target * 1.05) / 60));
  const step = niceStep(maxMin);
  const xMaxMin = Math.ceil(maxMin / step) * step;
  const yMax = Math.max(1, expected || 0, times.length);
  const x = (sec) => L + (sec / 60 / xMaxMin) * (W - L - R);
  const y = (n) => T + (1 - n / yMax) * (H - T - B);
  const endSec = Math.max(spanSec, last);

  let grid = "", labels = "";
  for (let m = 0; m <= xMaxMin; m += step) {
    grid += `<line x1="${x(m * 60)}" x2="${x(m * 60)}" y1="${T}" y2="${H - B}" style="stroke:var(--grid)"/>`;
    labels += `<text x="${x(m * 60)}" y="${H - B + 18}" text-anchor="middle">${m}m</text>`;
  }
  const yTicks = [0, Math.round(yMax / 2), yMax].filter((v, i, a) => a.indexOf(v) === i);
  for (const v of yTicks) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--grid)"/>`;
    labels += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  let d = `M${x(0)},${y(0)}`;
  times.forEach((t, i) => { d += ` H${x(t)} V${y(i + 1)}`; });
  d += ` H${x(endSec)}`;
  const area = d + ` V${y(0)} Z`;
  const exp = expected ? `<line x1="${L}" x2="${W - R}" y1="${y(expected)}" y2="${y(expected)}" style="stroke:var(--muted)" stroke-width="1.5" stroke-dasharray="5 4"/>` : "";
  const tgt = `<line x1="${x(target)}" x2="${x(target)}" y1="${T}" y2="${H - B}" style="stroke:var(--idle)" stroke-width="1.5" stroke-dasharray="5 4"/>`;
  const endDot = `<circle cx="${x(endSec)}" cy="${y(times.length)}" r="5" style="fill:var(--safe);stroke:var(--surface)" stroke-width="2"/>`;
  el.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${times.length} people accounted for over ${Math.round(endSec / 60)} minutes${expected ? " out of " + expected + " expected" : ""}">` +
    grid + labels + tgt + exp +
    `<path d="${area}" style="fill:var(--safe)" fill-opacity="0.12"/>` +
    `<path d="${d}" fill="none" style="stroke:var(--safe)" stroke-width="2" stroke-linejoin="round"/>` +
    endDot +
    `<line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="stroke:var(--ink)" stroke-width="1" visibility="hidden"/>` +
    `</svg><div class="tip" hidden></div>`;

  const svg = el.querySelector("svg"), cross = el.querySelector(".cross"), tip = el.querySelector(".tip");
  svg.addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const sec = Math.max(0, Math.min(endSec, ((px - L) / (W - L - R)) * xMaxMin * 60));
    const n = times.filter((t) => t <= sec).length;
    cross.setAttribute("x1", x(sec)); cross.setAttribute("x2", x(sec));
    cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.textContent = fmtDur(sec) + " · " + n + (expected ? " of " + expected : "") + " accounted for";
    tip.style.left = (x(sec) / W) * r.width + "px";
    tip.style.top = (y(n) / H) * r.height + "px";
  });
  svg.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; });
}

function renderHistory() {
  const targetMin = S.settings.target_min || 10;
  const target = targetMin * 60;
  if (document.activeElement !== $("targetMin")) $("targetMin").value = targetMin;
  $("histWrap").hidden = S.summaries.length === 0;
  $("histEmpty").hidden = S.summaries.length > 0;
  const recent = S.summaries.slice(0, 5);
  const met = recent.filter((h) => h.data.t100 != null && h.data.t100 <= target).length;
  $("histSummary").textContent = recent.length
    ? "Last " + recent.length + (recent.length === 1 ? " event: " : " events: ") + met + " reached 100% within the " + targetMin + " min target."
    : "";
  $("histBody").replaceChildren(...S.summaries.map((h) => {
    const d = h.data;
    const tr = document.createElement("tr");
    tr.tabIndex = 0;
    tr.setAttribute("aria-selected", String(S.selected === h.event_id));
    const cells = [
      fmtDate(d.startedAt) + " " + fmtClock(d.startedAt),
      d.weather ? WEATHER[d.weather].replace(" weather", "") : "–",
      fmtDur((d.endedAt - d.startedAt) / 1000),
      d.expected ? d.accounted + "/" + d.expected : String(d.accounted),
      fmtDur(d.t90), fmtDur(d.t100), String(d.help),
    ];
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      if (i > 1) td.className = "num";
      td.textContent = c;
      tr.append(td);
    });
    const td = document.createElement("td");
    td.append(d.t100 == null ? pill("help", "Incomplete") : d.t100 <= target ? pill("safe", "Met target") : pill("missing", "Over target"));
    tr.append(td);
    const pick = () => { S.selected = S.selected === h.event_id ? null : h.event_id; render(); };
    tr.onclick = pick;
    tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } };
    return tr;
  }));

  // AI debrief for the selected past evacuation.
  const sel = S.selected != null && S.summaries.find((x) => x.event_id === S.selected);
  $("reportCard").hidden = !sel;
  if (sel) {
    const d = sel.data;
    $("reportHead").textContent = "Debrief · " + fmtDate(d.startedAt) + " " + fmtClock(d.startedAt);
    $("reportText").textContent = d.report || "";
    $("reportMeta").textContent = d.report
      ? "Written by AI on " + fmtDate(d.reportAt) + " from this evacuation's numbers. Check it before sharing."
      : "Writes a short summary of this evacuation: result against the target, who needed help or was late, and what to improve.";
    $("reportBtn").textContent = S.reporting ? "Writing…" : d.report ? "Rewrite" : "Write debrief";
    $("reportBtn").disabled = S.busy || S.reporting;
  }
}

function renderPoints() {
  const form = $("pointsForm");
  if (form.contains(document.activeElement) || form.dataset.dirty === "1") return;
  const pts = S.settings.points || {};
  for (const k of ["dry", "wet"]) {
    const p = pts[k] || {};
    $(k + "Name").value = p.name || "";
    $(k + "Dir").value = p.directions || "";
    $(k + "Lat").value = p.lat != null ? p.lat : "";
    $(k + "Lng").value = p.lng != null ? p.lng : "";
    $(k + "Radius").value = p.radius || DEFAULT_RADIUS;
    renderMapLink(k);
  }
}

function renderMapLink(k) {
  const lat = parseFloat($(k + "Lat").value), lng = parseFloat($(k + "Lng").value);
  const el = $(k + "Map");
  el.replaceChildren();
  if (isFinite(lat) && isFinite(lng)) {
    const a = document.createElement("a");
    a.href = mapUrl({ lat, lng }); a.target = "_blank"; a.rel = "noopener";
    a.textContent = "Pin set: check on map";
    el.append(a);
  } else {
    el.textContent = "No pin yet";
  }
}

function renderAdminLists(st) {
  $("rollMeta").textContent = S.event ? fmtDate(ms(S.event.started_at)) + " " + fmtClock(ms(S.event.started_at)) : "";

  $("missingBlock").hidden = !(S.event && st.missing.length);
  $("missingList").replaceChildren(...st.missing.map((p) =>
    personRow(p.name, "", [pill("missing", "Missing"), smallBtn("Mark safe", "go", () => setMark(p.id, true))])));

  const ul = $("roster");
  ul.hidden = st.rows.length === 0;
  $("emptyRoster").hidden = st.rows.length > 0;
  $("emptyRoster").textContent = S.event
    ? "No one has checked in yet. Names appear here as people tap “Check in”."
    : "The roll call appears here once an evacuation starts.";
  ul.replaceChildren(...st.rows.map((r) => {
    const t = document.createElement("time");
    t.className = "mono";
    t.textContent = fmtClock(r.at);
    const extras = [pill(r.status, r.status === "help" ? "Needs help" : "Safe"), t];
    if (r.marked) extras.push(smallBtn("Undo", "", () => setMark(r.rosterId, false)));
    if (r.linkedTo) extras.push(smallBtn("Unlink", "", () => setMark(r.linkedTo.id, false)));
    let detail;
    if (r.marked) detail = "Marked safe by an admin";
    else {
      const bits = [];
      if (r.linkedTo) bits.push("Linked to " + r.linkedTo.name);
      if (r.distance != null) bits.push(fmtM(r.distance) + " from point" + (r.accuracy ? " (±" + Math.round(r.accuracy) + " m)" : ""));
      else if (r.status === "help") bits.push("Location unknown");
      if (!r.onRoster && S.roster.length) bits.push("Not on staff list");
      if (r.note) bits.push(r.note);
      detail = bits.join(" · ");
    }
    return personRow(r.name, detail, extras);
  }));

  // AI name matching: offered while typed names and missing staff are both left over.
  const canMatch = !!(S.event && st.unmatched.length && st.missing.length);
  $("matchCard").hidden = !canMatch && !S.matches.length;
  $("matchHint").textContent = canMatch
    ? st.unmatched.length + (st.unmatched.length === 1 ? " check-in doesn't" : " check-ins don't") + " match the staff list."
    : "Suggested matches";
  if (S.matchNote && !S.matches.length) $("matchHint").textContent = S.matchNote;
  $("matchBtn").hidden = !canMatch;
  $("matchBtn").disabled = S.busy || S.matching;
  $("matchBtn").textContent = S.matching ? "Matching…" : "Suggest matches";
  const live = S.matches.filter((m) => st.unmatched.some((r) => r.device === m.device_id) && st.missing.some((p) => p.id === m.roster_id));
  $("matchList").hidden = live.length === 0;
  $("matchList").replaceChildren(...live.map((m) =>
    personRow(m.checkin_name + " → " + m.roster_name, m.reason || "Likely the same person", [
      smallBtn("Link", "go", () => linkCheckin(m)),
      smallBtn("Dismiss", "", () => { S.matches = S.matches.filter((x) => x !== m); render(); }),
    ])));

  $("rosterCount").textContent = S.roster.length;
  $("rosterList").hidden = S.roster.length === 0;
  $("rosterList").replaceChildren(...S.roster.map((p) =>
    personRow(p.name, "", [smallBtn("Remove", "", () => removePerson(p.id))])));
  $("adminCount").textContent = S.admins.length;
  $("adminList").replaceChildren(...S.admins.map((a) =>
    personRow(a.email, a.email === S.email ? "You" : "",
      a.email === S.email ? [] : [smallBtn("Remove", "", () => removeAdmin(a.email))])));
}

function render() {
  if (!sb || $("appScreen").hidden) return;
  applyView();
  renderStatus();
  renderMine();
  if (S.isAdmin && S.view === "admin") {
    const st = rollState();
    renderAdminLists(st);
    renderPerformance(st);
    renderHistory();
    renderPoints();
  }
}

// ---------- actions: staff ----------

async function checkIn(status) {
  const ev = S.event;
  if (!ev || !ev.active || S.busy) return;
  showError("");
  const name = $("myName").value.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) {
    setGps("far", "Enter your full name first, so admins can tick you off the list.");
    $("myName").focus();
    return;
  }
  rememberName(name);
  const point = ev.point;
  const radius = (point && point.radius) || DEFAULT_RADIUS;
  let coords = null, dist = null;

  if (status === "safe") {
    if (!point || point.lat == null || point.lng == null) {
      showError("This evacuation has no GPS position for the assembly point, so your check-in can't be confirmed. Tell a warden: an admin can mark you safe.");
      return;
    }
    setGps("", "Finding your location…");
    try { coords = await getPosition(15000); }
    catch (e) { setGps("far", gpsErrorText(e)); return; }
    dist = distanceM({ lat: coords.latitude, lng: coords.longitude }, point);
    if (dist > radius) {
      setGps("far", coords.accuracy > radius
        ? "Your phone can only place you within ±" + Math.round(coords.accuracy) + " m right now. Step into open sky, wait a few seconds and tap again."
        : "You're about " + fmtM(dist) + " from " + point.name + ". Check-in opens within " + radius + " m of the point.");
      return;
    }
    setGps("ok", "You're " + fmtM(dist) + " from " + point.name + " (±" + Math.round(coords.accuracy) + " m). Checking you in…");
  } else {
    // Help requests always go through; attach a distance only if the phone answers quickly.
    setGps("", "Sending your help request…");
    if (point && point.lat != null) {
      try {
        coords = await getPosition(6000);
        dist = distanceM({ lat: coords.latitude, lng: coords.longitude }, point);
      } catch { /* send without a location */ }
    }
  }

  const ok = await run(status === "safe" ? "check in" : "send your help request", async () => {
    try {
      S.mine = await q(sb.rpc("public_checkin", {
        p_event: ev.id, p_device: deviceId(), p_name: name, p_status: status,
        p_note: null,
        p_distance: dist != null ? Math.round(dist) : null,
        p_accuracy: coords ? Math.round(coords.accuracy) : null,
      }));
    } catch (e) {
      if (e.code === "42501") e.userMessage = "Check-in was refused: the evacuation may have ended, or you were outside " + radius + " m of the point. Refresh the page and try again.";
      if (e.code === "22023") e.userMessage = "Enter your full name, then tap again.";
      throw e;
    }
  });
  setGps(ok ? "ok" : "", ok ? (status === "safe" ? "Checked in. Stay at the assembly point until you're told it's safe." : "Help request sent. Stay where you are if it's safe to do so.") : "");
}

// ---------- actions: admin ----------

function readPoint(k) {
  const name = $(k + "Name").value.trim().slice(0, 80);
  if (!name) return null;
  const lat = parseFloat($(k + "Lat").value), lng = parseFloat($(k + "Lng").value);
  const radius = DEFAULT_RADIUS; // no longer edited per point
  const valid = isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return { name, directions: $(k + "Dir").value.trim().slice(0, 160), lat: valid ? lat : null, lng: valid ? lng : null, radius };
}

async function startEvent(weather) {
  const point = (S.settings.points || {})[weather] || null;
  S.selected = null;
  const ok = await run("start the evacuation", async () => {
    await q(sb.from("events").update({ active: false, ended_at: new Date().toISOString() }).eq("active", true));
    await q(sb.from("events").insert({ active: true, weather, point, started_by: S.uid }));
  });
  if (ok && (!point || point.lat == null)) {
    showError("Started, but the " + WEATHER[weather].toLowerCase() + " point has no GPS position, so staff can't check themselves in as safe. Add it under Assembly points and tap “Send point to staff”, or mark people safe.");
  }
}

function switchWeather(weather) {
  const ev = S.event;
  if (!ev || !ev.active) return;
  return run("switch the assembly point", () =>
    q(sb.from("events").update({ weather, point: (S.settings.points || {})[weather] || null }).eq("id", ev.id)));
}

function endEvent() {
  const ev = S.event;
  if (!ev) return;
  const st = rollState();
  const expected = S.roster.length;
  const times = st.times.map((t) => Math.round(t));
  const now = Date.now();
  return run("end the evacuation", async () => {
    await q(sb.from("event_summaries").upsert({
      event_id: ev.id,
      data: {
        startedAt: ms(ev.started_at), endedAt: now, weather: ev.weather || null, expected,
        accounted: st.rows.length, help: st.rows.filter((r) => r.status === "help").length,
        missingAtEnd: st.missing.length, times,
        t50: timeTo(times, expected, 0.5), t90: timeTo(times, expected, 0.9), t100: timeTo(times, expected, 1),
      },
    }));
    await q(sb.from("events").update({ active: false, ended_at: new Date(now).toISOString() }).eq("id", ev.id));
  });
}

function setMark(rosterId, safe) {
  const ev = S.event;
  if (!ev) return;
  return run("update this person", () => safe
    ? q(sb.from("marks").upsert({ event_id: ev.id, roster_id: rosterId, status: "safe", at: new Date().toISOString(), checkin_device: null }))
    : q(sb.from("marks").delete().eq("event_id", ev.id).eq("roster_id", rosterId)));
}

// ---------- AI helper (Supabase Edge Function "assist") ----------

async function callAssist(body) {
  const { data, error } = await sb.functions.invoke("assist", { body });
  if (!error) return data;
  let msg = "";
  const status = error.context && error.context.status;
  try { msg = (await error.context.json()).error || ""; } catch { /* no JSON body */ }
  if (!msg && (status === 404 || /Failed to send/i.test(error.message)))
    msg = "The AI helper isn't set up yet: deploy the “assist” function in Supabase (see the README).";
  const e = new Error(msg || error.message);
  e.userMessage = msg || "The AI helper didn't answer. Try again in a moment.";
  throw e;
}

async function suggestMatches() {
  if (!S.event || S.matching) return;
  S.matching = true; S.matchNote = ""; showError(""); render();
  try {
    const d = await callAssist({ task: "match", event_id: S.event.id });
    S.matches = d.matches || [];
    if (!S.matches.length) S.matchNote = "No likely matches. Mark people safe by hand if you've confirmed them.";
  } catch (e) {
    console.error(e);
    showError(e.userMessage || "Couldn't get suggestions.");
  } finally {
    S.matching = false;
    render();
  }
}

function linkCheckin(m) {
  const ev = S.event;
  const c = S.checkins.find((x) => x.device_id === m.device_id);
  if (!ev || !c) return;
  S.matches = S.matches.filter((x) => x !== m);
  return run("link this check-in", () => q(sb.from("marks").upsert({
    event_id: ev.id, roster_id: m.roster_id, status: c.status, at: new Date().toISOString(), checkin_device: m.device_id,
  })));
}

async function writeReport() {
  const h = S.summaries.find((x) => x.event_id === S.selected);
  if (!h || S.reporting) return;
  S.reporting = true; showError(""); render();
  try {
    const d = await callAssist({ task: "report", event_id: h.event_id });
    await run("save the debrief", () => q(sb.from("event_summaries")
      .update({ data: { ...h.data, report: d.report, reportAt: Date.now() } }).eq("event_id", h.event_id)));
  } catch (e) {
    console.error(e);
    showError(e.userMessage || "Couldn't write the debrief.");
  } finally {
    S.reporting = false;
    render();
  }
}

function removePerson(id) {
  return run("remove this person", () => q(sb.from("roster").delete().eq("id", id)));
}

function removeAdmin(email) {
  return run("remove this admin", () => q(sb.from("admins").delete().eq("email", email)));
}

// ---------- Google Maps (admin: assembly points) ----------

const MAPS_KEY = options.googleMapsApiKey || "";
let mapsPromise = null, mapsBroken = false;

function loadGoogleMaps() {
  if (!MAPS_KEY) return Promise.reject(new Error("no Google Maps key"));
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    window.__rollcallMapsReady = () => resolve(window.google.maps);
    window.gm_authFailure = () => {
      mapsBroken = true;
      $("mapUse").disabled = true;
      $("mapCoords").textContent = "Map unavailable";
      showError("Google Maps refused the API key. Check the key allows this site's address and has Maps JavaScript API and Places API (New) enabled.");
    };
    const s = document.createElement("script");
    s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(MAPS_KEY) + "&v=weekly&loading=async&callback=__rollcallMapsReady";
    s.async = true;
    s.onerror = () => { mapsPromise = null; reject(new Error("Google Maps failed to load")); };
    document.head.append(s);
  });
  return mapsPromise;
}

function fieldCoords(k) {
  const lat = parseFloat($(k + "Lat").value), lng = parseFloat($(k + "Lng").value);
  return isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
}

function setFieldCoords(k, lat, lng, note) {
  $(k + "Lat").value = lat.toFixed(6);
  $(k + "Lng").value = lng.toFixed(6);
  $("pointsForm").dataset.dirty = "1";
  renderMapLink(k);
  // After the form's own input handler, which would otherwise replace this with "Unsaved changes".
  setTimeout(() => { $("pointsNote").textContent = note; }, 0);
}

// Accepts "1.2345, 103.8" or a Google Maps link (pin !3d…!4d…, @lat,lng, or ?q=/query=lat,lng).
function parseCoords(text) {
  const patterns = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /^\s*\(?(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\)?\s*$/];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

// Place suggestions while an admin types a location name.
let placesSession = null, suggestTimer = null;
async function suggestPlaces(k) {
  const input = $(k + "Name"), list = $(k + "Suggest");
  const text = input.value.trim();
  if (text.length < 3) { list.hidden = true; list.replaceChildren(); return; }
  try {
    const maps = await loadGoogleMaps();
    const { AutocompleteSuggestion, AutocompleteSessionToken } = await maps.importLibrary("places");
    placesSession = placesSession || new AutocompleteSessionToken();
    const req = { input: text, sessionToken: placesSession };
    const near = fieldCoords(k) || fieldCoords(k === "dry" ? "wet" : "dry");
    if (near) req.locationBias = { center: near, radius: 2000 };
    const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
    if (input.value.trim() !== text) return; // the admin kept typing
    const items = suggestions.filter((s) => s.placePrediction).slice(0, 5).map((s) => {
      const li = document.createElement("li");
      li.tabIndex = 0;
      const span = document.createElement("span");
      span.textContent = s.placePrediction.text.toString();
      li.append(span);
      const choose = (e) => { e.preventDefault(); choosePlace(k, s.placePrediction); };
      li.addEventListener("pointerdown", choose);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") choose(e); });
      return li;
    });
    const powered = document.createElement("li");
    powered.className = "powered";
    powered.textContent = "Powered by Google";
    list.replaceChildren(...items, ...(items.length ? [powered] : []));
    list.hidden = items.length === 0;
  } catch (e) {
    console.error(e);
    list.hidden = true;
  }
}

async function choosePlace(k, prediction) {
  $(k + "Suggest").hidden = true;
  try {
    const place = prediction.toPlace();
    await place.fetchFields({ fields: ["displayName", "location"] });
    placesSession = null;
    $(k + "Name").value = (place.displayName || prediction.text.toString()).slice(0, 80);
    setFieldCoords(k, place.location.lat(), place.location.lng(),
      "Position from Google Maps. A place's pin is often the middle of the building: use “Pick on map” to move it to the exact gathering spot, then save.");
  } catch (e) {
    console.error(e);
    showError("Couldn't get that place's position from Google Maps. Try again, or use “Pick on map”.");
  }
}

// In-page map with a fixed centre pin; the admin moves the map under it.
let picker = null, pickerKey = null;
async function openPicker(k) {
  const radius = Math.min(1000, Math.max(20, parseInt($(k + "Radius").value, 10) || DEFAULT_RADIUS));
  const start = fieldCoords(k) || fieldCoords(k === "dry" ? "wet" : "dry");
  if (!MAPS_KEY) {
    // No key: open Google Maps itself; the admin pastes the coordinates back into the Paste box.
    const url = start ? "https://www.google.com/maps/@" + start.lat + "," + start.lng + ",19z"
      : $(k + "Name").value.trim() ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent($(k + "Name").value.trim())
      : "https://www.google.com/maps";
    window.open(url, "_blank", "noopener");
    $("pointsNote").textContent = "In Google Maps, right-click (computer) or long-press (phone) the exact spot and copy the coordinates, then paste them into " + WEATHER[k] + " → Paste from Google Maps.";
    return;
  }
  pickerKey = k;
  $("mapTitle").textContent = "Set the " + WEATHER[k].toLowerCase() + " assembly point";
  // Only enabled once the map has actually drawn, so a failed map can't save a 0,0 pin.
  $("mapUse").disabled = true;
  $("mapCoords").textContent = "Loading map…";
  $("mapDialog").showModal();
  try {
    const maps = await loadGoogleMaps();
    const { Map, Circle } = await maps.importLibrary("maps");
    if (!picker) {
      const map = new Map($("mapCanvas"), {
        center: { lat: 0, lng: 0 }, zoom: 2, mapTypeId: "hybrid", tilt: 0,
        gestureHandling: "greedy", streetViewControl: false, fullscreenControl: false, clickableIcons: false,
      });
      const circle = new Circle({ map, center: map.getCenter(), radius, strokeColor: "#00794a", strokeWeight: 2, fillColor: "#00794a", fillOpacity: 0.15, clickable: false });
      map.addListener("center_changed", () => {
        const c = map.getCenter();
        circle.setCenter(c);
        $("mapCoords").textContent = c.lat().toFixed(6) + ", " + c.lng().toFixed(6);
      });
      map.addListener("click", (e) => map.panTo(e.latLng));
      map.addListener("idle", () => {
        if (mapsBroken) return;
        const c = map.getCenter();
        $("mapCoords").textContent = c.lat().toFixed(6) + ", " + c.lng().toFixed(6);
        $("mapUse").disabled = false;
      });
      picker = { map, circle };
    }
    picker.circle.setRadius(radius);
    if (start) { picker.map.setCenter(start); picker.map.setZoom(19); }
    else {
      try {
        const c = await getPosition(8000);
        picker.map.setCenter({ lat: c.latitude, lng: c.longitude });
        picker.map.setZoom(18);
      } catch { /* leave the world view; the admin can search by name first */ }
    }
  } catch (e) {
    console.error(e);
    $("mapDialog").close();
    showError("Google Maps couldn't load. Check your connection and the API key, or paste coordinates from Google Maps instead.");
  }
}

// ---------- wiring ----------

$("btnSafe").addEventListener("click", () => checkIn("safe"));
$("btnHelp").addEventListener("click", () => checkIn("help"));
$("myName").addEventListener("change", () => rememberName($("myName").value.trim()));
$("authToggle").addEventListener("click", () => {
  if (S.uid) sb.auth.signOut();
  else { setAuthMode("signin"); showScreen("signin"); }
});

$("tabUser").addEventListener("click", (e) => { e.preventDefault(); S.view = "user"; history.replaceState(null, "", "#checkin"); render(); });
$("tabAdmin").addEventListener("click", (e) => { e.preventDefault(); S.view = "admin"; history.replaceState(null, "", "#admin"); render(); });

$("pointsForm").addEventListener("input", (e) => {
  $("pointsForm").dataset.dirty = "1";
  $("pointsNote").textContent = "Unsaved changes";
  const k = e.target.id.slice(0, 3);
  if (k === "dry" || k === "wet") renderMapLink(k);
});
for (const k of ["dry", "wet"]) {
  $(k + "Name").addEventListener("input", () => {
    if (!MAPS_KEY) return;
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => suggestPlaces(k), 300);
  });
  $(k + "Name").addEventListener("blur", () => setTimeout(() => { $(k + "Suggest").hidden = true; }, 150));
  $(k + "Paste").addEventListener("input", () => {
    const v = $(k + "Paste").value;
    if (!v.trim()) return;
    const c = parseCoords(v);
    if (c) {
      $(k + "Paste").value = "";
      setFieldCoords(k, c.lat, c.lng, "Pin set from Google Maps. Check on map, then save.");
    } else if (/goo\.gl|maps\.app/.test(v)) {
      setTimeout(() => { $("pointsNote").textContent = "Short share links can't be read. In Google Maps, copy the coordinates (they look like 1.2345, 103.8765) instead."; }, 0);
    }
  });
}
$("pointsForm").addEventListener("click", (e) => {
  const k = e.target.dataset && e.target.dataset.pick;
  if (k) openPicker(k);
});
$("mapCancel").addEventListener("click", () => $("mapDialog").close());
$("matchBtn").addEventListener("click", suggestMatches);
$("reportBtn").addEventListener("click", writeReport);
$("mapUse").addEventListener("click", () => {
  if (picker && pickerKey) {
    const c = picker.map.getCenter();
    setFieldCoords(pickerKey, c.lat(), c.lng(), "Pin set on the map. Save assembly points to keep it.");
  }
  $("mapDialog").close();
});
$("pointsForm").addEventListener("click", async (e) => {
  const k = e.target.dataset && e.target.dataset.locate;
  if (!k) return;
  e.target.disabled = true;
  $(k + "Map").textContent = "Finding your location…";
  try {
    const c = await getPosition(20000);
    $(k + "Lat").value = c.latitude.toFixed(6);
    $(k + "Lng").value = c.longitude.toFixed(6);
    $("pointsForm").dataset.dirty = "1";
    $("pointsNote").textContent = "Position recorded (±" + Math.round(c.accuracy) + " m). Save to keep it.";
    renderMapLink(k);
  } catch (err) {
    $(k + "Map").textContent = "";
    showError(gpsErrorText(err));
  } finally { e.target.disabled = false; }
});
$("pointsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const points = { dry: readPoint("dry"), wet: readPoint("wet") };
  if (!points.dry && !points.wet) { showError("Enter at least one assembly point before saving."); return; }
  const ok = await run("save the assembly points", () =>
    q(sb.from("settings").upsert({ id: 1, target_min: S.settings.target_min || 10, points })));
  if (ok) {
    delete $("pointsForm").dataset.dirty;
    const missingGps = ["dry", "wet"].filter((k) => points[k] && points[k].lat == null);
    $("pointsNote").textContent = missingGps.length
      ? "Saved. " + missingGps.map((k) => WEATHER[k]).join(" and ") + " has no GPS position yet, so staff can't check in there."
      : "Saved. Used the next time you start an evacuation.";
    renderPoints();
  }
});
$("targetForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = Math.round(Number($("targetMin").value));
  if (!(v >= 1 && v <= 120)) { showError("Set the target between 1 and 120 minutes."); return; }
  run("save the target", () => q(sb.from("settings").upsert({ id: 1, target_min: v, points: S.settings.points || {} })));
});
$("addPersonForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("personName").value.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!name) { showError("Type a name before tapping Add."); return; }
  if (S.roster.some((p) => normName(p.name) === normName(name))) { showError(name + " is already on the list."); return; }
  $("personName").value = "";
  run("add this person", () => q(sb.from("roster").insert({ name })));
});
$("addAdminForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = $("adminEmail").value.trim().toLowerCase();
  if (!email) return;
  $("adminEmail").value = "";
  run("add this admin", () => q(sb.from("admins").upsert({ email })));
});

// ---------- admin sign-in ----------

const AUTH_MODES = {
  signin: { title: "Admin sign in", intro: "Only admins sign in. Staff don't need an account to check in.", button: "Sign in", password: "Password", autocomplete: "current-password" },
  forgot: { title: "Reset your password", intro: "We'll email you a link to choose a new password.", button: "Send reset link" },
  reset: { title: "Choose a new password", intro: "Enter a new password for your admin account.", button: "Save new password", password: "New password (at least 8 characters)", autocomplete: "new-password" },
};
let authMode = "signin", recoverySession = null;

function setAuthMode(mode) {
  authMode = mode;
  const m = AUTH_MODES[mode];
  $("authTitle").textContent = m.title;
  $("authIntro").textContent = m.intro;
  $("authBtn").textContent = m.button;
  $("emailField").hidden = mode === "reset";
  $("email").required = mode !== "reset";
  $("passwordField").hidden = mode === "forgot";
  $("password").required = mode !== "forgot";
  if (m.password) { $("passwordLabel").textContent = m.password; $("password").autocomplete = m.autocomplete; }
  $("toCheckin").hidden = mode === "reset";
  $("toForgot").hidden = mode !== "signin";
  $("toSignin").hidden = mode !== "forgot";
  $("oauthButtons").hidden = mode !== "signin";
  $("authNote").hidden = true;
  showError("");
}

function authNote(text) {
  $("authNote").textContent = text;
  $("authNote").hidden = !text;
}

function authErrorText(error) {
  const msg = (error && error.message) || "";
  if (/invalid login credentials/i.test(msg)) return "Email or password is wrong. Check them and try again, or use “Forgot password?”.";
  if (/email not confirmed/i.test(msg)) return "This login hasn't been confirmed. In Supabase, open Authentication → Users and confirm it, or recreate it with “Auto confirm” ticked.";
  if (/password/i.test(msg) && /(short|least|weak)/i.test(msg)) return "That password is too short or too common. Use at least 8 characters.";
  if (/rate|too many/i.test(msg)) return "Too many attempts. Wait a few minutes, then try again.";
  return "Couldn't complete that: " + msg;
}

function setupSignin() {
  const providers = options.providers || ["email"];
  $("authForm").hidden = !providers.includes("email");
  setAuthMode("signin");
  $("toCheckin").addEventListener("click", () => { showError(""); showScreen("app"); render(); });
  $("toForgot").addEventListener("click", () => setAuthMode("forgot"));
  $("toSignin").addEventListener("click", () => setAuthMode("signin"));
  const labels = { google: "Sign in with Google", azure: "Sign in with Microsoft" };
  $("oauthButtons").replaceChildren(...providers.filter((p) => labels[p]).map((p) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = labels[p];
    b.onclick = async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: p, options: { redirectTo: location.origin + location.pathname } });
      if (error) showError("Couldn't start sign-in: " + error.message);
    };
    return b;
  }));
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;
    const back = location.origin + location.pathname;
    if (authMode !== "forgot" && password.length < 8 && authMode === "reset") { showError("Use a password of at least 8 characters."); return; }
    $("authBtn").disabled = true;
    showError(""); authNote("");
    try {
      if (authMode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return showError(authErrorText(error));
        $("password").value = "";
      } else if (authMode === "forgot") {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: back });
        if (error) return showError(authErrorText(error));
        authNote("If " + email + " has an admin login, a reset link is on its way. Open it on this device.");
      } else if (authMode === "reset") {
        const { error } = await sb.auth.updateUser({ password });
        if (error) return showError(authErrorText(error));
        $("password").value = "";
        const session = recoverySession;
        recoverySession = null;
        setAuthMode("signin");
        S.started = false; // re-run even if this admin was already loaded behind the reset screen
        await onSession(session);
      }
    } finally {
      $("authBtn").disabled = false;
    }
  });
}

async function onSession(session) {
  const uid = session && session.user ? session.user.id : null;
  if (S.started && uid === S.uid) return;
  S.started = true;
  S.uid = uid;
  S.email = uid ? (session.user.email || "").toLowerCase() : null;
  S.isAdmin = false;
  if (uid) {
    try { S.isAdmin = !!(await q(sb.rpc("is_admin"))); }
    catch (e) { console.error(e); }
    if (!S.isAdmin) {
      await sb.auth.signOut();
      showScreen("signin");
      showError("This login isn't on the admin list. Ask an existing admin to add " + S.email + " under Admins.");
      return;
    }
  }
  S.view = S.isAdmin && location.hash !== "#checkin" ? "admin" : "user";
  showScreen("app");
  subscribe();
  await refreshAll();
}

function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { showScreen("setup"); return; }
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  setupSignin();
  sb.auth.onAuthStateChange((event, session) => {
    // A password-reset link signs the admin in; ask for the new password before opening the app.
    if (event === "PASSWORD_RECOVERY") {
      recoverySession = session;
      setTimeout(() => { setAuthMode("reset"); showScreen("signin"); }, 0);
      return;
    }
    if (recoverySession) return;
    setTimeout(() => onSession(session), 0);
  });
  // Keep counts and timers fresh (staff don't get live check-in updates); reads only.
  setInterval(() => { if (S.event && S.event.active) refreshAll(); }, 15000);
  setInterval(() => { if (!$("appScreen").hidden) renderStatus(); }, 15000);
}

main();
