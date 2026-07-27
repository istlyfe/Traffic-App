# Reference signal timing data

Published, as-programmed controller settings obtained from **Broward County
Traffic Engineering**. This is the ground truth to compare field
observations against — it is *not* collected data.

## Files

| File | Contents |
|---|---|
| `sheridan-street-timing.json` | 10 signalized intersections along Sheridan Street (SR 822), Hollywood FL |

Regenerate from the source PDFs with:

```bash
node scripts/parse-timing-sheets.mjs SHERIDAN_STREETA.pdf SHERIDAN_STREETB.pdf \
  --out data/sheridan-street-timing.json
```

## What the source documents are

The county provided two report types for the same corridor:

1. **Sequence of Operation / ACTUATED TRAFFIC SIGNAL TIMING SHEET** — the
   engineering drawings. Per-phase values are printed as a single run of
   concatenated digits (e.g. yellow `4.54.54.04.0…`), which cannot be split
   back into per-phase values unambiguously. **Not parsed**; used to
   cross-check the machine-readable export by eye.
2. **Broward County Timing Sheet** (ATMS export) — the same settings in a
   real table, plus the coordination day plans. **This is what the parser
   reads.**

Where the two overlap they agree: for station 3180 (SR 7 & Sheridan St), the
drawing's min greens `5,10,5,6,5,10,5,6`, gaps `1.5,3,3,2.5,…`, max greens
`20,40,…` and yellows `5,5,4.5,4.5,…` all match the parsed export exactly.

## Fields

Per phase (controller phases 1–16; 9–16 are usually unused defaults):

- `walk`, `pedClearance` — pedestrian intervals (s)
- `minGreen`, `gapExtension`, `maxGreen1`, `maxGreen2` — vehicle green (s)
- `yellowClearance`, `redClearance`, `redRevert` — clearance intervals (s)

`directions` maps phase → movement code, where the first letter is the
approach and the second is `T`hrough or `L`eft (e.g. `EL` = eastbound left,
`WT` = westbound through). Note these are the *controller's* phase
directions, which is what an observer at the stop bar actually sees.

`coordination` lists day plans with `cycleSeconds`, `offsetSeconds` and the
split table.

## Accuracy caveats — read before relying on a number

This is text-layer extraction from reports never intended to be machine
read. It is good, not perfect. Known issues in the current output:

- Station **3178** yielded no phase table (page layout variant) — only its
  coordination plans parsed.
- Station **3176** resolved only 4 of its phases.
- `splits` arrays may include one or two leading values from adjacent
  columns (`seqnc`/`short`/`long`) before the real split times.
- One known cell disagreement: 3180 phase 8 red clearance parses as `2`,
  while the engineering drawing shows `2.5`.

**Spot-check any value against the source PDF before treating it as
authoritative**, especially for a published analysis.
