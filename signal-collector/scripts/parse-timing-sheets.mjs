#!/usr/bin/env node
/**
 * Parse Broward County ATMS "Timing Sheet" PDFs into structured JSON.
 *
 * These are the published, as-programmed controller settings — the ground
 * truth to compare field observations against. Two report layouts are
 * handled, and they cross-validate each other:
 *
 *   1. "ACTUATED TRAFFIC SIGNAL TIMING SHEET" (the engineering drawing) —
 *      per-phase values printed as one concatenated run per row.
 *   2. "Broward County Timing Sheet" (the ATMS export) — per-phase table
 *      plus the coordination day plans (cycle / offset / splits).
 *
 * The PDFs embed a subsetted font whose glyph ids are ASCII - 29, and the
 * text streams carry no table structure, so cells are assigned to phase
 * columns by x-position against the "Phase 1..16" header row. A phase with
 * a blank cell therefore stays blank rather than shifting later values left.
 *
 * Usage:
 *   node scripts/parse-timing-sheets.mjs <file.pdf> [more.pdf ...] \
 *        [--out data/signal-timing.json]
 *
 * Caveat: this is text-layer extraction of a report never meant to be
 * machine-read. Spot-check any value you intend to rely on against the PDF
 * before treating it as authoritative; the script reports per-field counts
 * so gaps are visible.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/* ---------------------------------------------------------------- */
/* PDF plumbing                                                      */
/* ---------------------------------------------------------------- */

/** Decompress every Flate stream in the file (page content streams). */
function pdfStreams(buf) {
  const out = [];
  const marker = Buffer.from('stream');
  let i = 0;
  for (;;) {
    const s = buf.indexOf(marker, i);
    if (s === -1) break;
    let p = s + marker.length;
    if (buf[p] === 0x0d) p++;
    if (buf[p] === 0x0a) p++;
    const END = 'endstream';
    const e = buf.indexOf(Buffer.from(END), p);
    if (e === -1) break;
    try {
      out.push(inflateSync(buf.subarray(p, e)).toString('latin1'));
    } catch {
      /* not a Flate stream (image, xref, …) — skip */
    }
    // Advance past the whole "endstream" keyword: resuming any earlier would
    // re-match the "stream" substring inside it and skip the next real stream.
    i = e + END.length;
  }
  return out;
}

/** Glyph ids in these subsetted fonts are ASCII - 29. */
function decodeHex(hex) {
  let s = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (Number.isNaN(code)) continue;
    const c = code + 29;
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s;
}

const TOKEN =
  /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm|([-\d.]+)\s+([-\d.]+)\s+T[Dd]|\[([\s\S]*?)\]\s*TJ|<([0-9A-Fa-f]+)>\s*Tj/g;

/** Extract positioned text runs: {x, y, text}. */
function positionedText(stream) {
  const out = [];
  let x = 0, y = 0, lineX = 0, lineY = 0;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(stream)) !== null) {
    if (m[1] !== undefined) {
      x = parseFloat(m[5]); y = parseFloat(m[6]);
      lineX = x; lineY = y;
    } else if (m[7] !== undefined) {
      x = lineX + parseFloat(m[7]); y = lineY + parseFloat(m[8]);
      lineX = x; lineY = y;
    } else {
      let text;
      if (m[9] !== undefined) {
        text = [...m[9].matchAll(/<([0-9A-Fa-f]+)>/g)]
          .map((h) => decodeHex(h[1]))
          .join('');
      } else {
        text = decodeHex(m[10]);
      }
      if (text.trim()) out.push({ x: +x.toFixed(1), y: +y.toFixed(1), text: text.trim() });
    }
  }
  return out;
}

/** Group runs into visual rows by y, each sorted left-to-right. */
function toRows(runs, yTolerance = 3) {
  const rows = [];
  for (const run of [...runs].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - run.y) <= yTolerance);
    if (row) row.cells.push(run);
    else rows.push({ y: run.y, cells: [run] });
  }
  for (const r of rows) r.cells.sort((a, b) => a.x - b.x);
  return rows;
}

const rowStartingWith = (rows, label) =>
  rows.find((r) => r.cells[0]?.text === label)?.cells ?? null;

const isNumeric = (t) => /^[\d.]+$/.test(t);

/* ---------------------------------------------------------------- */
/* Timing-sheet parsing                                              */
/* ---------------------------------------------------------------- */

const PHASE_FIELDS = [
  ['Walk', 'walk'],
  ['Ped Clearance', 'pedClearance'],
  ['Min Green', 'minGreen'],
  ['Gap Ext', 'gapExtension'],
  ['Max1', 'maxGreen1'],
  ['Max2', 'maxGreen2'],
  ['Yellow Clr', 'yellowClearance'],
  ['Red Clr', 'redClearance'],
  ['Red Revert', 'redRevert'],
];

/** Direction codes used on these sheets: E/W/N/S + L(eft)/T(hrough). */
const DIRECTION_NAMES = {
  EL: { approach: 'eastbound', movement: 'left_turn' },
  ET: { approach: 'eastbound', movement: 'through' },
  WL: { approach: 'westbound', movement: 'left_turn' },
  WT: { approach: 'westbound', movement: 'through' },
  NL: { approach: 'northbound', movement: 'left_turn' },
  NT: { approach: 'northbound', movement: 'through' },
  SL: { approach: 'southbound', movement: 'left_turn' },
  ST: { approach: 'southbound', movement: 'through' },
};

function parsePhaseTable(rows) {
  const header = rowStartingWith(rows, 'Phase');
  if (!header) return null;
  const columns = header.slice(1).filter((c) => /^\d+$/.test(c.text));
  if (!columns.length) return null;
  const phaseAt = (x) =>
    columns.reduce((best, c) => (Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best)).text;

  // The row directly under the header carries "(EL)", "(WT)", … labels.
  const dirRow = rows.find((r) => r.cells.some((c) => /^\(\w{2}\)$/.test(c.text)));
  const directions = {};
  if (dirRow) {
    for (const c of dirRow.cells) {
      const code = c.text.replace(/[()]/g, '');
      if (DIRECTION_NAMES[code]) directions[phaseAt(c.x)] = code;
    }
  }

  const timing = {};
  for (const [label, key] of PHASE_FIELDS) {
    const cells = rowStartingWith(rows, label);
    if (!cells) continue;
    const values = {};
    for (const c of cells.slice(1)) {
      if (isNumeric(c.text)) values[phaseAt(c.x)] = Number(c.text);
    }
    if (Object.keys(values).length) timing[key] = values;
  }
  return Object.keys(timing).length ? { directions, timing } : null;
}

/** Coordination day plans: cycle length, offset and the split table. */
function parseCoordination(rows) {
  const header = rowStartingWith(rows, 'Hour');
  if (!header) return [];
  const colX = (name) => header.find((c) => c.text === name)?.x ?? null;
  const cycleX = colX('Cycle');
  const offsetX = colX('Offset');
  const splitX = colX('Split');
  if (cycleX == null) return [];

  const plans = [];
  for (const row of rows) {
    const nums = row.cells.filter((c) => isNumeric(c.text));
    if (nums.length < 8) continue;
    const nearest = (tx) => {
      if (tx == null) return null;
      const c = nums.reduce((b, n) => (Math.abs(n.x - tx) < Math.abs(b.x - tx) ? n : b));
      return Math.abs(c.x - tx) < 14 ? Number(c.text) : null;
    };
    const cycle = nearest(cycleX);
    // Cycle lengths are on the order of 60-240 s; smaller numbers in this
    // column are plan/pattern ids, not cycles.
    if (cycle != null && cycle >= 40 && cycle <= 300) {
      plans.push({
        cycleSeconds: cycle,
        offsetSeconds: nearest(offsetX),
        splits: splitX == null
          ? []
          : nums.filter((c) => c.x > splitX - 5).map((c) => Number(c.text)).slice(0, 16),
      });
    }
  }
  return plans;
}

/* ---------------------------------------------------------------- */
/* Driver                                                            */
/* ---------------------------------------------------------------- */

function parsePdf(path) {
  const buf = readFileSync(path);
  const intersections = [];
  let current = null;

  for (const stream of pdfStreams(buf)) {
    if (!stream.includes('Tj') && !stream.includes('TJ')) continue;
    const runs = positionedText(stream);
    if (!runs.length) continue;
    const rows = toRows(runs);
    const flat = runs.map((r) => r.text).join(' ');

    // Page banner: "Station : 3174 - Sheridan St & Dixie Hwy ( Standard File )".
    // Anchoring on "Station" matters: FDOT project numbers on the engineering
    // drawings (e.g. "415283-1-52-01") otherwise look like station banners.
    const banner = flat.match(/Station\s*:?\s*(\d{4})\s*-\s*([A-Za-z0-9 &/.\-]+?)\s*\(/);
    if (banner) {
      const [, id, name] = banner;
      if (!current || current.stationId !== id) {
        current = {
          stationId: id,
          name: name.trim(),
          source: path.split(/[\\/]/).pop(),
          directions: {},
          timing: {},
          coordination: [],
        };
        intersections.push(current);
      }
    }
    if (!current) continue;

    const phases = parsePhaseTable(rows);
    if (phases) {
      current.directions = { ...current.directions, ...phases.directions };
      for (const [k, v] of Object.entries(phases.timing)) {
        current.timing[k] = { ...(current.timing[k] ?? {}), ...v };
      }
    }
    current.coordination.push(...parseCoordination(rows));
  }
  return intersections;
}

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = outIndex === -1 ? null : args[outIndex + 1];
const inputs = args.filter((a, i) => a !== '--out' && i !== outIndex + 1 && !a.startsWith('--'));

if (!inputs.length) {
  console.error('usage: node scripts/parse-timing-sheets.mjs <file.pdf> [...] [--out out.json]');
  process.exit(1);
}

const merged = new Map();
for (const path of inputs) {
  for (const ix of parsePdf(path)) {
    const existing = merged.get(ix.stationId);
    if (existing) {
      existing.directions = { ...existing.directions, ...ix.directions };
      for (const [k, v] of Object.entries(ix.timing)) {
        existing.timing[k] = { ...(existing.timing[k] ?? {}), ...v };
      }
      existing.coordination.push(...ix.coordination);
    } else {
      merged.set(ix.stationId, ix);
    }
  }
}

const result = [...merged.values()].sort((a, b) => a.stationId.localeCompare(b.stationId));

// De-duplicate identical coordination plans (the same plan repeats per day).
for (const ix of result) {
  const seen = new Set();
  ix.coordination = ix.coordination.filter((p) => {
    const key = JSON.stringify(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

console.log(`Parsed ${result.length} intersections from ${inputs.length} file(s):\n`);
for (const ix of result) {
  const phaseCount = Object.keys(ix.directions).length;
  const fields = Object.keys(ix.timing).length;
  console.log(
    `  ${ix.stationId}  ${ix.name.padEnd(34)} phases=${phaseCount} fields=${fields} plans=${ix.coordination.length}`,
  );
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(`\nWrote ${outPath}`);
} else {
  console.log('\n(pass --out <file.json> to save)');
}
