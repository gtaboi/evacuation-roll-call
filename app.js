import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, options } from "./config.js?v=2";

const $ = (id) => document.getElementById(id);
const WEATHER = { dry: "Dry weather", wet: "Wet weather" };
const DEFAULT_RADIUS = options.defaultRadiusM || 100;

const S = {
  uid: null, email: null, isAdmin: false, view: "user",
  event: null,          // newest events row
  checkins: [],         // rows for the current event
  profiles: {},         // id -> {email, name}
  roster: [],           // admin: expected staff
  marks: {},            // admin: roster_id -> {status, at}
  summaries: [],        // admin: [{event_id, data}]
  settings: { target_min: 10, points: {} },
  admins: [],
  selected: null,       // event_id shown in the chart; null = current
  busy: false,
};
let sb = null, channel = null;

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
async function loadCheckins() {
  S.checkins = S.event ? await q(sb.from("checkins").select("*").eq("event_id", S.event.id)) : [];
}
async function loadProfiles() {
  const rows = await q(sb.from("profiles").select("id,email,name"));
  S.profiles = Object.fromEntries(rows.map((r) => [r.id, r]));
}
async function loadAdminData() {
  if (!S.isAdmin) return;
  const [roster, settings, admins, sums, marks] = await Promise.all([
    q(sb.from("roster").select("*").order("name")),
    q(sb.from("settings").select("*").eq("id", 1)),
    q(sb.from("admins").select("*").order("email")),
    q(sb.from("event_summaries").select("*").order("event_id", { ascending: false }).limit(50)),
    S.event ? q(sb.from("marks").select("*").eq("event_id", S.event.id)) : Promise.resolve([]),
  ]);
  S.roster = roster;
  S.settings = settings[0] || { target_min: 10, points: {} };
  S.admins = admins;
  S.summaries = sums;
  S.marks = Object.fromEntries(marks.map((m) => [m.roster_id, m]));
}

let refreshing = null;
async function refreshAll() {
  if (!sb || !S.uid) return;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      await loadEvent();
      await Promise.all([loadCheckins(), loadProfiles(), loadAdminData()]);
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

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel("roll-call");
  for (const t of ["events", "checkins", "profiles", "roster", "marks", "event_summaries", "settings", "admins"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table: t }, scheduleRefresh);
  }
  channel.subscribe();
}

// ---------- roll call ----------

const current = () => S.checkins;
const nameOf = (uid) => (S.profiles[uid] && (S.profiles[uid].name || S.profiles[uid].email)) || "Someone";

function timeTo(times, expected, share) {
  if (!expected) return null;
  const need = Math.ceil(share * expected);
  return times.length >= need ? times[need - 1] : null;
}

function rollState() {
  const ev = S.event;
  const cur = current();
  const emailOf = (uid) => ((S.profiles[uid] && S.profiles[uid].email) || "").toLowerCase();
  const checkedEmails = new Set(cur.map((c) => emailOf(c.user_id)).filter(Boolean));
  const rows = cur.map((c) => ({
    key: c.user_id, uid: c.user_id, name: nameOf(c.user_id), status: c.status, note: c.note,
    distance: c.distance_m, accuracy: c.accuracy_m, at: ms(c.at), firstAt: ms(c.first_at), marked: false,
  }));
  for (const p of S.roster) {
    if (p.email && checkedEmails.has(p.email)) continue;
    const m = S.marks[p.id];
    if (m) rows.push({ key: p.id, name: p.name, status: m.status, at: ms(m.at), firstAt: ms(m.at), marked: true, rosterId: p.id });
  }
  rows.sort((a, b) => (a.status === "help" ? 0 : 1) - (b.status === "help" ? 0 : 1) || b.at - a.at);
  const missing = ev ? S.roster.filter((p) => !(p.email && checkedEmails.has(p.email)) && !S.marks[p.id]) : [];
  const times = ev ? rows.map((r) => Math.max(0, (r.firstAt - ms(ev.started_at)) / 1000)).sort((a, b) => a - b) : [];
  return { rows, missing, times };
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
  $("meLabel").textContent = "Signed in as " + (S.email || "") + (S.isAdmin ? " · admin" : "");
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
      ? "Start one when the alarm sounds. Everyone who signs in can then check in."
      : "An admin starts the roll call when the alarm sounds.";
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
  const me = current().find((c) => c.user_id === S.uid);
  const radius = (ev && ev.point && ev.point.radius) || DEFAULT_RADIUS;
  $("btnSafe").disabled = !active || S.busy;
  $("btnHelp").disabled = !active || S.busy;
  $("btnSafeLabel").textContent = me ? "Update: I'm safe" : "Check in: I'm safe";
  $("safeHint").textContent = "Uses your phone's location. You must be within " + radius + " m of the assembly point.";
  const box = $("mine");
  box.hidden = !me;
  if (me) {
    box.className = "mine " + me.status;
    $("mineTitle").textContent = me.status === "help" ? "You asked for help" : "You're checked in as safe";
    const bits = [fmtClock(ms(me.at))];
    if (me.distance_m != null) bits.push(fmtM(me.distance_m) + " from the point");
    if (me.note) bits.push(me.note);
    $("mineSub").textContent = bits.join(" · ");
  }
  const prof = S.profiles[S.uid];
  if (document.activeElement !== $("myName")) $("myName").value = (prof && prof.name) || "";
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
    a.textContent = "Check on map";
    el.append(a);
  } else {
    el.textContent = "No GPS position yet";
  }
}

function renderLists(st) {
  const admin = S.isAdmin && S.view === "admin";
  const nHelp = st.rows.filter((r) => r.status === "help").length;
  $("uHelp").textContent = nHelp;
  $("uSafe").textContent = st.rows.length - nHelp;
  $("uTotal").textContent = st.rows.length;
  $("rollMeta").textContent = S.event ? fmtDate(ms(S.event.started_at)) + " " + fmtClock(ms(S.event.started_at)) : "";

  $("missingBlock").hidden = !(admin && S.event && st.missing.length);
  if (admin) {
    $("missingList").replaceChildren(...st.missing.map((p) =>
      personRow(p.name, p.email || "No sign-in: mark safe yourself",
        [pill("missing", "Missing"), smallBtn("Mark safe", "go", () => setMark(p.id, true))])));
  }

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
    if (r.marked && admin) extras.push(smallBtn("Undo", "", () => setMark(r.rosterId, false)));
    let detail;
    if (r.marked) detail = "Marked safe by an admin";
    else {
      const bits = [];
      if (r.distance != null) bits.push(fmtM(r.distance) + " from point" + (r.accuracy ? " (±" + Math.round(r.accuracy) + " m)" : ""));
      else if (r.status === "help") bits.push("Location unknown");
      if (r.note) bits.push(r.note);
      detail = bits.join(" · ");
    }
    return personRow(r.name + (r.uid === S.uid ? " (you)" : ""), detail, extras);
  }));

  if (admin) {
    $("rosterCount").textContent = S.roster.length;
    $("rosterList").hidden = S.roster.length === 0;
    $("rosterList").replaceChildren(...S.roster.map((p) =>
      personRow(p.name, p.email || "No sign-in", [smallBtn("Remove", "", () => removePerson(p.id))])));
    $("knownEmails").replaceChildren(...Object.values(S.profiles).map((p) => {
      const o = document.createElement("option");
      o.value = p.email;
      if (p.name) o.label = p.name;
      return o;
    }));
    $("adminCount").textContent = S.admins.length;
    $("adminList").replaceChildren(...S.admins.map((a) =>
      personRow(a.email, a.email === S.email ? "You" : "",
        a.email === S.email ? [] : [smallBtn("Remove", "", () => removeAdmin(a.email))])));
  }
}

function render() {
  if (!S.uid) return;
  applyView();
  renderStatus();
  renderMine();
  const st = rollState();
  renderLists(st);
  if (S.isAdmin && S.view === "admin") {
    renderPerformance(st);
    renderHistory();
    renderPoints();
  }
}

// ---------- actions: staff ----------

async function saveName() {
  const name = $("myName").value.trim().slice(0, 60);
  const prof = S.profiles[S.uid];
  if (!name || (prof && prof.name === name)) return;
  await q(sb.from("profiles").upsert({ id: S.uid, email: S.email, name, updated_at: new Date().toISOString() }));
}

async function checkIn(status) {
  const ev = S.event;
  if (!ev || !ev.active || S.busy) return;
  showError("");
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

  const me = current().find((c) => c.user_id === S.uid);
  const now = new Date().toISOString();
  const ok = await run(status === "safe" ? "check in" : "send your help request", async () => {
    await saveName();
    await q(sb.from("checkins").upsert({
      event_id: ev.id, user_id: S.uid, status,
      note: $("note").value.trim().slice(0, 80) || null,
      distance_m: dist != null ? Math.round(dist) : null,
      accuracy_m: coords ? Math.round(coords.accuracy) : null,
      first_at: me ? me.first_at : now, at: now,
    }));
  });
  setGps(ok ? "ok" : "", ok ? (status === "safe" ? "Checked in. Stay at the assembly point until you're told it's safe." : "Help request sent. Stay where you are if it's safe to do so.") : "");
}

// ---------- actions: admin ----------

function readPoint(k) {
  const name = $(k + "Name").value.trim().slice(0, 80);
  if (!name) return null;
  const lat = parseFloat($(k + "Lat").value), lng = parseFloat($(k + "Lng").value);
  const radius = Math.min(1000, Math.max(20, parseInt($(k + "Radius").value, 10) || DEFAULT_RADIUS));
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
    ? q(sb.from("marks").upsert({ event_id: ev.id, roster_id: rosterId, status: "safe", at: new Date().toISOString() }))
    : q(sb.from("marks").delete().eq("event_id", ev.id).eq("roster_id", rosterId)));
}

function removePerson(id) {
  return run("remove this person", () => q(sb.from("roster").delete().eq("id", id)));
}

function removeAdmin(email) {
  return run("remove this admin", () => q(sb.from("admins").delete().eq("email", email)));
}

// ---------- wiring ----------

$("btnSafe").addEventListener("click", () => checkIn("safe"));
$("btnHelp").addEventListener("click", () => checkIn("help"));
$("myName").addEventListener("change", () => { saveName().catch(() => showError("Couldn't save your name. Check your connection.")); });
$("signOut").addEventListener("click", () => sb.auth.signOut());

$("tabUser").addEventListener("click", (e) => { e.preventDefault(); S.view = "user"; history.replaceState(null, "", "#checkin"); render(); });
$("tabAdmin").addEventListener("click", (e) => { e.preventDefault(); S.view = "admin"; history.replaceState(null, "", "#admin"); render(); });

$("pointsForm").addEventListener("input", (e) => {
  $("pointsForm").dataset.dirty = "1";
  $("pointsNote").textContent = "Unsaved changes";
  const k = e.target.id.slice(0, 3);
  if (k === "dry" || k === "wet") renderMapLink(k);
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
  const name = $("personName").value.trim().slice(0, 60);
  const email = $("personEmail").value.trim().toLowerCase() || null;
  if (!name) { showError("Type a name before tapping Add."); return; }
  if (email && S.roster.some((p) => p.email === email)) { showError(email + " is already on the list."); return; }
  $("personName").value = ""; $("personEmail").value = "";
  run("add this person", () => q(sb.from("roster").insert({ name, email })));
});
$("addAdminForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const email = $("adminEmail").value.trim().toLowerCase();
  if (!email) return;
  $("adminEmail").value = "";
  run("add this admin", () => q(sb.from("admins").upsert({ email })));
});

// ---------- sign-in ----------

function setupSignin() {
  const providers = options.providers || ["email"];
  $("emailForm").hidden = !providers.includes("email");
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
  $("emailForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("email").value.trim();
    $("emailBtn").disabled = true;
    showError("");
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    $("emailBtn").disabled = false;
    if (error) {
      showError(/rate/i.test(error.message)
        ? "Too many sign-in emails were sent recently. Wait a few minutes, then try again."
        : "Couldn't send the sign-in link: " + error.message);
      return;
    }
    $("emailSent").hidden = false;
    $("emailSent").textContent = "Check " + email + " for a sign-in link and open it on this device. It can take a minute to arrive.";
  });
}

async function onSession(session) {
  const uid = session && session.user ? session.user.id : null;
  if (uid === S.uid) return;
  if (!uid) {
    S.uid = null; S.email = null; S.isAdmin = false;
    if (channel) { sb.removeChannel(channel); channel = null; }
    showScreen("signin");
    return;
  }
  S.uid = uid;
  S.email = (session.user.email || "").toLowerCase();
  showScreen("app");
  try {
    const meta = session.user.user_metadata || {};
    const existing = await q(sb.from("profiles").select("name").eq("id", uid));
    const name = (existing[0] && existing[0].name) || meta.full_name || meta.name || null;
    await q(sb.from("profiles").upsert({ id: uid, email: S.email, name, updated_at: new Date().toISOString() }));
    S.isAdmin = !!(await q(sb.rpc("is_admin")));
  } catch (e) {
    console.error(e);
    showError("Signed in, but couldn't load your profile. Check your connection and reload.");
  }
  S.view = S.isAdmin && location.hash !== "#checkin" ? "admin" : "user";
  subscribe();
  await refreshAll();
}

function main() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { showScreen("setup"); return; }
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  setupSignin();
  sb.auth.onAuthStateChange((_event, session) => { setTimeout(() => onSession(session), 0); });
  // Keep timers fresh and recover from missed realtime messages; reads only.
  setInterval(() => { if (S.uid && S.event && S.event.active) refreshAll(); }, 20000);
  setInterval(() => { if (S.uid) renderStatus(); }, 15000);
}

main();
