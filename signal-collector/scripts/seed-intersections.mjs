#!/usr/bin/env node
/**
 * Seed the Supabase `intersections` table from public GIS data:
 *
 *  1. Broward County Traffic Signals (Broward County GeoHub / ArcGIS Hub).
 *     The FeatureServer URL is DISCOVERED at runtime from the ArcGIS item
 *     registry, so this keeps working if the county republishes the layer.
 *  2. FDOT RCI Traffic Signals (layer 18), spatially filtered to Broward,
 *     merged onto county signals by proximity (default 30 m) to attach
 *     maintaining-agency info.
 *
 * Idempotent: rows are upserted on `source_id`, so re-running after the
 * county updates the layer inserts new signals and refreshes existing ones
 * without duplicating anything.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/seed-intersections.mjs [--dry-run] [--out file.json] [--merge-radius 30]
 *
 * SECURITY: the service-role key is required because the script bypasses RLS
 * to write shared catalog rows. Run it ONLY from a trusted machine/CI.
 * NEVER put the service-role key in the mobile app or in EXPO_PUBLIC_* vars.
 */

const BROWARD_ITEM_ID = '8d453c466f6248c7ae3d037721ad519d'; // "Broward County Traffic Signals" on geohub-bcgis
const ARCGIS_ITEM_API = `https://www.arcgis.com/sharing/rest/content/items/${BROWARD_ITEM_ID}?f=json`;
const FDOT_SIGNALS_LAYER = 'https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/FeatureServer/18';

// Broward County bounding box (WGS-84) for the FDOT spatial filter.
const BROWARD_BBOX = { xmin: -80.55, ymin: 25.94, xmax: -80.05, ymax: 26.41 };

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const OUT_FILE = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const MERGE_RADIUS_M = args.includes('--merge-radius')
  ? Number(args[args.indexOf('--merge-radius') + 1])
  : 30;

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function log(...parts) {
  console.log('[seed]', ...parts);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const body = await res.json();
  if (body?.error) throw new Error(`GET ${url} -> ${JSON.stringify(body.error).slice(0, 300)}`);
  return body;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Case-insensitive attribute lookup across several candidate field names. */
function pickField(attrs, candidates) {
  if (!attrs) return null;
  const keys = Object.keys(attrs);
  for (const candidate of candidates) {
    const key = keys.find((k) => k.toLowerCase() === candidate.toLowerCase());
    if (key != null && attrs[key] != null && String(attrs[key]).trim() !== '') {
      return String(attrs[key]).trim();
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* ArcGIS fetching                                                     */
/* ------------------------------------------------------------------ */

/** Resolve the Hub item to its backing FeatureServer layer URL. */
async function discoverBrowardLayerUrl() {
  log('discovering Broward Traffic Signals service via ArcGIS item registry…');
  const item = await getJson(ARCGIS_ITEM_API);
  if (!item.url) {
    throw new Error(
      `ArcGIS item ${BROWARD_ITEM_ID} has no service url. ` +
        'Find the dataset on geohub-bcgis.opendata.arcgis.com, open "I want to use this > View API resources", ' +
        'and pass the query URL via BROWARD_LAYER_URL env var.',
    );
  }
  // Item URL may already point at a layer (…/FeatureServer/0) or at the service root.
  const url = item.url.replace(/\/+$/, '');
  const layerUrl = /\/(FeatureServer|MapServer)\/\d+$/.test(url) ? url : `${url}/0`;
  log('  ->', layerUrl, `(item: "${item.title ?? 'untitled'}")`);
  return layerUrl;
}

/**
 * Fetch every feature from an ArcGIS layer as GeoJSON, paginating with
 * resultOffset past the server's maxRecordCount.
 */
async function fetchAllFeatures(layerUrl, extraParams = {}) {
  const meta = await getJson(`${layerUrl}?f=json`);
  const pageSize = Math.min(meta.maxRecordCount ?? 1000, 2000);
  log(`fetching "${meta.name ?? layerUrl}" (maxRecordCount ${pageSize})`);

  const features = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      f: 'geojson',
      where: '1=1',
      outFields: '*',
      outSR: '4326',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      ...extraParams,
    });
    const page = await getJson(`${layerUrl}/query?${params}`);
    const batch = page.features ?? [];
    features.push(...batch);
    log(`  page offset=${offset}: ${batch.length} features (total ${features.length})`);
    // GeoJSON responses carry exceededTransferLimit in `properties` on some
    // servers and top-level on others; a short page always means done.
    const exceeded = page.exceededTransferLimit ?? page.properties?.exceededTransferLimit;
    if (batch.length < pageSize || exceeded === false) break;
    offset += batch.length;
    if (offset > 200000) throw new Error('pagination runaway — aborting');
  }
  return features;
}

/* ------------------------------------------------------------------ */
/* Normalization + merge                                               */
/* ------------------------------------------------------------------ */

function featureLatLng(feature) {
  const geom = feature.geometry;
  if (!geom) return null;
  if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
    const [lng, lat] = geom.coordinates;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  return null;
}

const NAME_FIELDS = [
  'LOCATION', 'LOCATION_DESC', 'INTERSECTION', 'INTERSECTION_NAME', 'INT_NAME',
  'SIGNAL_LOCATION', 'DESCRIPTION', 'SITE_NAME', 'NAME', 'MAIN_STREET', 'ON_STREET',
];
const CROSS_FIELDS = ['CROSS_STREET', 'SIDE_STREET', 'CROSS_ST', 'AT_STREET'];
const DEVICE_FIELDS = ['DEVICE_TYPE', 'DEVICETYPE', 'DEVICE', 'SIGNAL_TYPE', 'TYPE', 'SUBTYPE'];
const ID_FIELDS = ['SIGNAL_ID', 'SIGNALID', 'ASSET_ID', 'ASSETID', 'GlobalID', 'GLOBALID', 'OBJECTID', 'FID'];
const AGENCY_FIELDS = ['MAINTAINING_AGENCY', 'MAINT_AGENCY', 'MNTAGCY', 'AGENCY', 'MAINTAINED_BY', 'OWNER'];

function normalizeBrowardFeature(feature) {
  const coords = featureLatLng(feature);
  if (!coords) return null;
  const attrs = feature.properties ?? {};

  const main = pickField(attrs, NAME_FIELDS);
  const cross = pickField(attrs, CROSS_FIELDS);
  const rawId = pickField(attrs, ID_FIELDS);
  if (!rawId) return null; // no stable identity -> cannot upsert idempotently

  const name =
    main && cross ? `${main} & ${cross}`
    : main ? main
    : `Broward signal ${rawId}`;

  return {
    source_id: `bcgis:${rawId}`,
    name: name.replace(/\s+/g, ' ').trim().slice(0, 200),
    latitude: coords.lat,
    longitude: coords.lng,
    device_type: pickField(attrs, DEVICE_FIELDS),
    maintaining_agency: pickField(attrs, AGENCY_FIELDS), // county layer may carry it too
    city: null,
    state: 'FL',
    timezone: 'America/New_York',
    source: 'import',
  };
}

/**
 * Attach FDOT maintaining-agency info to county signals by proximity.
 * A simple rounded-coordinate grid keeps this O(n) instead of O(n*m).
 */
function mergeAgencyByProximity(rows, fdotFeatures, radiusM) {
  const CELL = 0.002; // ~200 m grid cells; radius is well inside a 3x3 block
  const grid = new Map();
  for (const feature of fdotFeatures) {
    const coords = featureLatLng(feature);
    if (!coords) continue;
    const key = `${Math.round(coords.lat / CELL)}:${Math.round(coords.lng / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({ ...coords, attrs: feature.properties ?? {} });
  }

  let merged = 0;
  for (const row of rows) {
    const ci = Math.round(row.latitude / CELL);
    const cj = Math.round(row.longitude / CELL);
    let best = null;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const cand of grid.get(`${ci + di}:${cj + dj}`) ?? []) {
          const dist = haversineMeters(row.latitude, row.longitude, cand.lat, cand.lng);
          if (dist <= radiusM && (!best || dist < best.dist)) {
            best = { dist, attrs: cand.attrs };
          }
        }
      }
    }
    if (best) {
      const agency = pickField(best.attrs, AGENCY_FIELDS);
      if (agency && !row.maintaining_agency) {
        row.maintaining_agency = agency;
        merged++;
      }
    }
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Supabase upsert                                                     */
/* ------------------------------------------------------------------ */

async function upsertRows(rows) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or use --dry-run).');
  }
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await fetch(`${url}/rest/v1/intersections?on_conflict=source_id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      throw new Error(`Supabase upsert failed (HTTP ${res.status}): ${await res.text()}`);
    }
    log(`  upserted ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  // 1. Broward County signals (endpoint discovered, override supported).
  const browardLayer = process.env.BROWARD_LAYER_URL ?? (await discoverBrowardLayerUrl());
  const browardFeatures = await fetchAllFeatures(browardLayer);
  log(`Broward: ${browardFeatures.length} raw features`);
  if (browardFeatures[0]) {
    log('Broward fields:', Object.keys(browardFeatures[0].properties ?? {}).join(', '));
  }

  const rows = browardFeatures.map(normalizeBrowardFeature).filter(Boolean);
  // Guard against duplicate source ids inside one payload (PostgREST rejects them).
  const bySourceId = new Map(rows.map((r) => [r.source_id, r]));
  const unique = [...bySourceId.values()];
  log(`Broward: ${unique.length} normalized signals (${rows.length - unique.length} in-payload dupes collapsed)`);

  // 2. FDOT layer 18, spatially filtered to the Broward bounding box.
  let fdotMergedCount = 0;
  try {
    const fdotFeatures = await fetchAllFeatures(FDOT_SIGNALS_LAYER, {
      geometry: JSON.stringify(BROWARD_BBOX),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
    });
    log(`FDOT: ${fdotFeatures.length} features in Broward bbox`);
    if (fdotFeatures[0]) {
      log('FDOT fields:', Object.keys(fdotFeatures[0].properties ?? {}).join(', '));
    }
    fdotMergedCount = mergeAgencyByProximity(unique, fdotFeatures, MERGE_RADIUS_M);
    log(`FDOT: agency merged onto ${fdotMergedCount} signals (radius ${MERGE_RADIUS_M} m)`);
  } catch (err) {
    // FDOT enrichment is best-effort: county data alone is still a valid seed.
    log(`WARNING: FDOT enrichment skipped: ${err.message}`);
  }

  // 3. Write.
  if (OUT_FILE) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(OUT_FILE, JSON.stringify(unique, null, 2));
    log(`wrote ${unique.length} rows to ${OUT_FILE}`);
  }
  if (DRY_RUN) {
    log(`dry run: would upsert ${unique.length} rows (on_conflict=source_id).`);
    log('sample row:', JSON.stringify(unique[0], null, 2));
    return;
  }
  await upsertRows(unique);
  log(`done: ${unique.length} intersections upserted, ${fdotMergedCount} with FDOT agency info.`);
}

main().catch((err) => {
  console.error('[seed] FAILED:', err.message);
  process.exit(1);
});
