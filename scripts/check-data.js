// Town elevations + an accuracy check of the PRISM grid lows.
//
// 1. Elevation: each place's real elevation (USGS 3DEP via EPQS) and its
//    PRISM 4 km grid cell's elevation -> public/data/nc-elevation.json.
// 2. Accuracy: for weather stations in and around NC with a complete
//    10-year record, compare observed annual lows to the grid value at the
//    same spot -> public/data/nc-accuracy.json + a console report.
// 3. Terrain watch: the grid misses cold on exposed summits 1,000+ ft
//    above their cell (Mt. Mitchell, Grandfather). We tested a terrain
//    correction and it didn't help towns, because no town sits that far
//    above its cell. This step warns if a place ever does.
//
// Uses calendar years (the API reduces those server-side); the grid's
// accuracy for winter lows doesn't depend on how years are grouped.
//
// Responses are cached in data/raw/terrain/. Usage: node scripts/check-data.js

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACES_CSV = path.join(ROOT, 'public/data/nc-places.csv');
const CACHE_DIR = path.join(ROOT, 'data/raw/terrain');
const ELEV_FILE = path.join(ROOT, 'public/data/nc-elevation.json');
const ACCURACY_FILE = path.join(ROOT, 'public/data/nc-accuracy.json');

const ACIS = 'https://data.rcc-acis.org';
const EPQS = 'https://epqs.nationalmap.gov/v1/json';
const PRISM_GRID = '21';
// NC plus the neighboring Appalachians, for more mountain stations.
const STATION_BBOX = '-85,33.4,-75.3,37.2';
const YEARS = 10;
const LAST_YEAR = new Date().getFullYear() - 1;
const SDATE = `${LAST_YEAR - YEARS + 1}-01-01`;
const EDATE = `${LAST_YEAR}-12-31`;
const CONCURRENCY = 4;
const SUMMIT_FT = 700; // above this, the grid is known to read too warm

const YEARLY_MIN = [{ name: 'mint', interval: 'yly', duration: 'yly', reduce: 'min' }];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (file) => access(file).then(() => true, () => false);
const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const round = (n, d = 2) => +n.toFixed(d);
const share = (a, test) => round((100 * a.filter(test).length) / a.length, 0);

async function request(url, options, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json;
    } catch (err) {
      if (attempt >= 4) throw new Error(`${label}: ${err.message}`);
      await sleep(1000 * attempt);
    }
  }
}

const acis = (endpoint, body, label) =>
  request(`${ACIS}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, label);

// Cache a whole keyed map in one JSON file; fetch only missing keys.
async function cachedMap(name, items, keyOf, fetchOne) {
  const file = path.join(CACHE_DIR, `${name}.json`);
  const cache = (await exists(file)) ? JSON.parse(await readFile(file, 'utf8')) : {};
  const todo = items.filter((item) => !(keyOf(item) in cache));
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < todo.length) {
      const item = todo[next++];
      try {
        cache[keyOf(item)] = await fetchOne(item);
      } catch (err) {
        console.warn(`  skipped ${err.message}`);
      }
      if (++done % 100 === 0) {
        console.log(`  ${name}: ${done}/${todo.length}`);
        await writeFile(file, JSON.stringify(cache));
      }
    }
  }
  if (todo.length) console.log(`Fetching ${name} for ${todo.length} points...`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await writeFile(file, JSON.stringify(cache));
  return cache;
}

// Grid cell elevation + the grid's yearly lows at a point.
const gridAt = (lon, lat, label) =>
  acis('GridData', { loc: `${lon},${lat}`, sdate: SDATE, edate: EDATE, grid: PRISM_GRID, meta: 'll,elev', elems: YEARLY_MIN }, label)
    .then((json) => ({ cellElev: json.meta.elev, lows: json.data.map((d) => d[1]) }));

async function readPlaces() {
  const [header, ...rows] = (await readFile(PLACES_CSV, 'utf8')).trim().split('\n');
  const cols = header.split(',');
  return rows.map((row) => {
    const place = Object.fromEntries(row.split(',').map((v, i) => [cols[i], v]));
    return { ...place, lat: Number(place.lat), lon: Number(place.lon) };
  });
}

async function loadStations() {
  const file = path.join(CACHE_DIR, `stations_${SDATE}_${EDATE}.json`);
  if (await exists(file)) return JSON.parse(await readFile(file, 'utf8'));

  console.log('Fetching station observations...');
  const json = await acis('MultiStnData', { bbox: STATION_BBOX, sdate: SDATE, edate: EDATE, elems: YEARLY_MIN, meta: ['name', 'll', 'elev', 'state', 'uid'] }, 'stations');
  const stations = json.data
    .filter((s) => s.meta.ll && s.meta.elev != null && s.data.length === YEARS && s.data.every((d) => /^-?\d+$/.test(d[0])))
    .map((s) => ({ uid: s.meta.uid, name: s.meta.name, state: s.meta.state, lon: s.meta.ll[0], lat: s.meta.ll[1], elev: s.meta.elev, obs: s.data.map((d) => Number(d[0])) }));
  await writeFile(file, JSON.stringify(stations));
  return stations;
}

async function checkAccuracy() {
  const stations = await loadStations();
  const grid = await cachedMap(`station-grid_${SDATE}_${EDATE}`, stations, (s) => String(s.uid), (s) => gridAt(s.lon, s.lat, s.name));

  const rows = stations
    .filter((s) => grid[s.uid]?.lows.every((v) => typeof v === 'number' && v > -999))
    .map((s) => {
      const g = grid[s.uid];
      return { ...s, grid: g.lows, aboveCell: s.elev - g.cellElev, diff: avg(g.lows) - avg(s.obs) };
    });

  // Accuracy is reported for NC stations — that's the area we publish.
  const nc = rows.filter((r) => r.state === 'NC');
  const yearly = nc.flatMap((r) => r.obs.map((o, i) => r.grid[i] - o));
  const halfZone = (t) => Math.floor(t / 5);

  const byTerrain = (lo, hi) => {
    const bin = rows.filter((r) => r.aboveCell >= lo && r.aboveCell < hi);
    return { stations: bin.length, gridMinusObs: bin.length ? round(avg(bin.map((r) => r.diff))) : null };
  };

  return {
    years: `${SDATE.slice(0, 4)}–${LAST_YEAR}`,
    ncStations: nc.length,
    singleYear: {
      meanBias: round(avg(yearly)),
      meanAbsError: round(avg(yearly.map(Math.abs))),
      within2F: share(yearly, (d) => Math.abs(d) <= 2),
      within5F: share(yearly, (d) => Math.abs(d) <= 5),
    },
    tenYearAverage: {
      meanBias: round(avg(nc.map((r) => r.diff))),
      meanAbsError: round(avg(nc.map((r) => Math.abs(r.diff)))),
      sameHalfZone: share(nc, (r) => halfZone(avg(r.grid)) === halfZone(avg(r.obs))),
    },
    // Grid minus observed, by how far the station sits above its grid cell.
    // Positive = grid too warm. All stations in the bbox, not just NC.
    byElevationAboveCell: {
      'below -300 ft': byTerrain(-Infinity, -300),
      '-300 to 300 ft': byTerrain(-300, 300),
      '300 to 700 ft': byTerrain(300, SUMMIT_FT),
      [`${SUMMIT_FT}+ ft`]: byTerrain(SUMMIT_FT, Infinity),
    },
    largestNcErrors: [...nc]
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 5)
      .map((r) => ({ station: r.name, elev: r.elev, gridMinusObs: round(r.diff, 1) })),
  };
}

async function townElevations(places) {
  const elev = await cachedMap('place-elev', places, (p) => p.geoid, (p) =>
    request(`${EPQS}?x=${p.lon}&y=${p.lat}&units=Feet&wkid=4326&includeDate=false`, {}, p.name).then((json) => {
      const value = Number(json.value);
      if (!Number.isFinite(value) || value < -1000) throw new Error(`${p.name}: no elevation`);
      return Math.round(value);
    }),
  );
  const cells = await cachedMap('place-cell', places, (p) => p.geoid, (p) => gridAt(p.lon, p.lat, p.name).then((g) => g.cellElev));

  const out = {};
  const missing = [];
  for (const p of places) {
    if (elev[p.geoid] == null || cells[p.geoid] == null) missing.push(p.name);
    else out[p.geoid] = { elev: elev[p.geoid], cellElev: cells[p.geoid] };
  }
  return { out, missing };
}

async function run() {
  await mkdir(CACHE_DIR, { recursive: true });
  const places = await readPlaces();
  const names = Object.fromEntries(places.map((p) => [p.geoid, p.name]));

  const { out: elevation, missing } = await townElevations(places);
  await writeFile(
    ELEV_FILE,
    JSON.stringify({
      meta: {
        format: 'places[geoid] = { elev, cellElev } in feet',
        elev: 'USGS 3DEP via EPQS, at the place interior point',
        cellElev: 'PRISM 4km grid cell elevation via ACIS',
        generated: new Date().toISOString(),
      },
      places: elevation,
    }),
  );

  const accuracy = await checkAccuracy();
  const aboveCell = Object.entries(elevation).map(([g, e]) => ({ name: names[g], above: e.elev - e.cellElev }));
  accuracy.towns = {
    maxFtAboveCell: Math.max(...aboveCell.map((t) => t.above)),
    summitLike: aboveCell.filter((t) => t.above >= SUMMIT_FT).map((t) => t.name),
  };
  await writeFile(ACCURACY_FILE, JSON.stringify({ meta: { generated: new Date().toISOString() }, ...accuracy }, null, 2));

  const { singleYear: y, tenYearAverage: t } = accuracy;
  console.log(`\nWrote ${path.relative(ROOT, ELEV_FILE)}: ${Object.keys(elevation).length} places.`);
  console.log(`\nAccuracy vs ${accuracy.ncStations} NC stations, ${accuracy.years} (grid − observed):`);
  console.log(`  single-year lows   bias ${y.meanBias}°F, mean abs error ${y.meanAbsError}°F, ${y.within2F}% within 2°F, ${y.within5F}% within 5°F`);
  console.log(`  10-yr average      bias ${t.meanBias}°F, mean abs error ${t.meanAbsError}°F, ${t.sameHalfZone}% same half-zone`);
  console.log('  by station height above its grid cell (all stations):');
  for (const [bin, b] of Object.entries(accuracy.byElevationAboveCell)) {
    console.log(`    ${bin.padEnd(15)} ${String(b.stations).padStart(3)} stations  ${b.gridMinusObs ?? '–'}°F`);
  }
  console.log(`  largest NC errors: ${accuracy.largestNcErrors.map((e) => `${e.station} ${e.gridMinusObs}`).join(', ')}`);

  console.log(`\nTowns: highest is ${accuracy.towns.maxFtAboveCell} ft above its grid cell.`);
  if (accuracy.towns.summitLike.length) {
    console.warn(`  WARNING: ${accuracy.towns.summitLike.length} places sit ${SUMMIT_FT}+ ft above their cell, where the grid reads too warm: ${accuracy.towns.summitLike.join(', ')}`);
  } else {
    console.log(`  None are ${SUMMIT_FT}+ ft above their cell, so no terrain correction is needed.`);
  }
  console.log(`Wrote ${path.relative(ROOT, ACCURACY_FILE)}.`);

  if (missing.length) {
    console.error(`${missing.length} places missing elevation (re-run to retry): ${missing.join(', ')}`);
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
