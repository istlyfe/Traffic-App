#!/usr/bin/env node
/**
 * Cross-check recorded signal observations against the county's published
 * controller timing.
 *
 * Input: CSV exported from Supabase (see README "Exporting observations"),
 * with columns: session_id, intersection, gis_id, approach_direction,
 * movement_type, started_at, state, observed_at, device_timestamp_ms.
 *
 * Output: per-session measured intervals, a data-quality summary (what the
 * recording actually supports), and — where a full cycle exists — a
 * side-by-side comparison against data/sheridan-street-timing.json.
 *
 * Usage:
 *   node scripts/analyze-observations.mjs observations.csv \
 *        [--timing data/sheridan-street-timing.json]
 */

import { readFileSync } from 'node:fs';

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** Minimal RFC-4180 reader (handles quoted fields containing commas). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.length === header.length && r.some((v) => v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i].trim()])));
}

/* ------------------------------------------------------------------ */
/* Mapping observations to published phases                            */
/* ------------------------------------------------------------------ */

const DIRECTION_CODE = {
  northbound: 'N', southbound: 'S', eastbound: 'E', westbound: 'W',
};
const MOVEMENT_CODE = { through: 'T', left_turn: 'L' };

/** "westbound"+"through" -> "WT", matching the controller's phase labels. */
function directionCode(approach, movement) {
  const a = DIRECTION_CODE[approach];
  const m = MOVEMENT_CODE[movement];
  return a && m ? a + m : null;
}

/**
 * Match a hand-typed intersection name to a published station.
 * Names in the field are informal ("Sheridan &I95 3"), so compare on
 * significant tokens: the cross-street ordinal/name.
 */
function matchStation(name, stations) {
  const norm = (s) =>
    s.toLowerCase()
      .replace(/\bavenue\b|\bave\b/g, 'ave')
      .replace(/\broad\b|\brd\b/g, 'rd')
      .replace(/\bstreet\b|\bst\b/g, 'st')
      .replace(/(\d+)(st|nd|rd|th)\b/g, '$1')
      .replace(/i-?95/g, 'i95')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  // Tokens shared by every station on the corridor carry no information.
  const GENERIC = new Set(['sheridan', 'st', 'ave', 'rd', 'n', 's', 'e', 'w', 'sr']);
  const target = norm(name);
  const targetNums = target.match(/\d+/g) ?? [];
  let best = null;
  for (const st of stations) {
    const cand = norm(st.name);
    const candNums = cand.match(/\d+/g) ?? [];
    let score = 0;
    // A shared cross-street number is the strongest signal.
    if (targetNums.length && candNums.length &&
        targetNums.some((n) => candNums.includes(n))) score += 10;
    for (const tok of new Set(target.split(' '))) {
      if (tok.length < 2) continue;
      if (cand.includes(tok)) {
        score += GENERIC.has(tok) ? 1 : 4; // a distinctive cross-street name
      } else if (!GENERIC.has(tok) && !/^\d+$/.test(tok)) {
        // A distinctive word the candidate lacks (e.g. "pembroke" against a
        // Sheridan station) is strong evidence this is a different place.
        score -= 3;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { station: st, score };
  }
  // 4 = one distinctive cross-street token, or a matching street number.
  return best && best.score >= 4 ? best.station : null;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith('--'));
const tIdx = args.indexOf('--timing');
const timingPath = tIdx === -1 ? 'data/sheridan-street-timing.json' : args[tIdx + 1];

if (!csvPath) {
  console.error('usage: node scripts/analyze-observations.mjs <observations.csv> [--timing timing.json]');
  process.exit(1);
}

const observations = parseCsv(readFileSync(csvPath, 'utf8'));
let stations = [];
try {
  stations = JSON.parse(readFileSync(timingPath, 'utf8'));
} catch {
  console.warn(`(no timing reference at ${timingPath} — skipping comparison)\n`);
}

// Group into sessions, ordered by the authoritative device timestamp.
const sessions = new Map();
for (const o of observations) {
  if (!sessions.has(o.session_id)) {
    sessions.set(o.session_id, {
      id: o.session_id,
      intersection: o.intersection,
      gisId: o.gis_id && o.gis_id !== 'null' ? o.gis_id : null,
      approach: o.approach_direction,
      movement: o.movement_type,
      startedAt: o.started_at,
      obs: [],
    });
  }
  sessions.get(o.session_id).obs.push({
    state: o.state,
    ms: Number(o.device_timestamp_ms),
    at: o.observed_at,
  });
}
for (const s of sessions.values()) s.obs.sort((a, b) => a.ms - b.ms);

/** Consecutive same-state pairs give the duration of the earlier state. */
function intervals(obs) {
  const out = [];
  for (let i = 0; i + 1 < obs.length; i++) {
    out.push({
      state: obs[i].state,
      seconds: (obs[i + 1].ms - obs[i].ms) / 1000,
      next: obs[i + 1].state,
    });
  }
  return out;
}

/** A complete cycle needs a RED onset, a GREEN, and a return to RED. */
function completeCycles(obs) {
  const cycles = [];
  const redIdx = obs.map((o, i) => (o.state === 'RED' ? i : -1)).filter((i) => i >= 0);
  for (let k = 0; k + 1 < redIdx.length; k++) {
    const slice = obs.slice(redIdx[k], redIdx[k + 1] + 1);
    if (slice.some((o) => o.state === 'GREEN')) {
      cycles.push({ seconds: (slice.at(-1).ms - slice[0].ms) / 1000, states: slice.map((o) => o.state) });
    }
  }
  return cycles;
}

const all = [...sessions.values()];
const stateTotals = {};
for (const o of observations) stateTotals[o.state] = (stateTotals[o.state] ?? 0) + 1;

console.log('='.repeat(74));
console.log('RECORDING SUMMARY');
console.log('='.repeat(74));
console.log(`observations : ${observations.length}`);
console.log(`sessions     : ${all.length}`);
console.log(`states       : ${Object.entries(stateTotals).map(([k, v]) => `${k}=${v}`).join('  ')}`);
const perSession = {};
for (const s of all) perSession[s.obs.length] = (perSession[s.obs.length] ?? 0) + 1;
console.log(`obs/session  : ${Object.entries(perSession).map(([k, v]) => `${k} obs x${v}`).join('  ')}`);
const totalCycles = all.reduce((n, s) => n + completeCycles(s.obs).length, 0);
console.log(`complete cycles recorded : ${totalCycles}`);
console.log(`YELLOW observations      : ${stateTotals.YELLOW ?? 0}`);

console.log('\n' + '='.repeat(74));
console.log('MEASURED INTERVALS BY SESSION');
console.log('='.repeat(74));
console.log(
  'date/time            intersection                 mvmt      measured'.padEnd(74),
);
console.log('-'.repeat(74));

const redWaits = [];
for (const s of all.sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
  const ivs = intervals(s.obs);
  const station = stations.length ? matchStation(s.intersection, stations) : null;
  const code = directionCode(s.approach, s.movement);
  const when = s.startedAt.slice(5, 16).replace('T', ' ');
  const label = `${when}  ${s.intersection.slice(0, 27).padEnd(27)} ${(code ?? '??').padEnd(3)}`;
  if (!ivs.length) {
    console.log(`${label} single tap — no interval`);
    continue;
  }
  for (const iv of ivs) {
    const line = `${iv.state}→${iv.next} ${iv.seconds.toFixed(1)}s`;
    console.log(`${label} ${line}`);
    if (iv.state === 'RED' && iv.next === 'GREEN') {
      redWaits.push({ session: s, station, code, seconds: iv.seconds });
    }
  }
}

/* ---------------- comparison against published timing -------------- */

if (stations.length) {
  console.log('\n' + '='.repeat(74));
  console.log('RED WAIT vs PUBLISHED CYCLE STRUCTURE');
  console.log('='.repeat(74));
  console.log('A red wait is only a *sample* of the red interval (it starts when');
  console.log('you arrived, not at red onset), so it is a lower bound. What it can');
  console.log('falsify: it must fit inside cycle − green for that phase.\n');
  console.log('intersection                 phase  wait     cycle  maxGreen  bound  fits');
  console.log('-'.repeat(74));

  for (const w of redWaits) {
    if (!w.station) {
      console.log(`${w.session.intersection.slice(0, 27).padEnd(27)}  (no published timing)`);
      continue;
    }
    const st = w.station;
    const phase = Object.entries(st.directions).find(([, c]) => c === w.code)?.[0];
    const cycle = st.coordination[0]?.cycleSeconds ?? null;
    const maxG = phase ? st.timing.maxGreen1?.[phase] ?? null : null;
    const yellow = phase ? st.timing.yellowClearance?.[phase] ?? 0 : 0;
    const red = phase ? st.timing.redClearance?.[phase] ?? 0 : 0;
    const bound = cycle != null && maxG != null ? cycle - maxG - yellow - red : null;
    const fits = bound == null ? '?' : w.seconds <= bound + 0.5 ? 'yes' : 'NO';
    console.log(
      `${st.name.slice(0, 27).padEnd(27)} ${(phase ?? '?').padEnd(6)} ` +
        `${w.seconds.toFixed(1).padStart(6)}s ${String(cycle ?? '-').padStart(6)} ` +
        `${String(maxG ?? '-').padStart(9)} ${String(bound?.toFixed(0) ?? '-').padStart(6)}  ${fits}`,
    );
  }
}

console.log('\n' + '='.repeat(74));
console.log('WHAT THIS DATA CAN AND CANNOT SHOW');
console.log('='.repeat(74));
if ((stateTotals.YELLOW ?? 0) === 0) {
  console.log('• No YELLOW observations — yellow clearance cannot be checked.');
}
if (totalCycles === 0) {
  console.log('• No complete cycles (RED→GREEN→YELLOW→RED) — cycle length, splits');
  console.log('  and green duration cannot be measured or compared.');
}
console.log(`• ${redWaits.length} red-wait samples are usable as lower bounds on red.`);
console.log('\nTo measure cycle length and phase splits: stay at ONE intersection and');
console.log('keep tapping through several consecutive cycles (RED→GREEN→YELLOW→RED…)');
console.log('in a single session, rather than one tap-pair per intersection.');
