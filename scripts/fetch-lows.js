// Gather the coldest night of each winter for every NC place.
//
// Source: PRISM 4 km daily minimum temperature (°F), served by NOAA's
// Regional Climate Centers ACIS API (grid 21). We pull raw daily lows at
// each place's interior point and reduce them ourselves — no published
// hardiness-zone data is used.
//
// Seasons run Jul 1 – Jun 30, so one winter is never split across two
// years ("2025-26" = Jul 1 2025 – Jun 30 2026).
//
// Raw responses are cached in data/raw/acis/, so re-runs only fetch
// what's missing. Delete that folder to force a full refresh.
//
// Usage: node scripts/fetch-lows.js [--seasons 20] [--last 2025]

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACES_CSV = path.join(ROOT, 'public/data/nc-places.csv');
const CACHE_DIR = path.join(ROOT, 'data/raw/acis');
const OUT_FILE = path.join(ROOT, 'public/data/nc-lows.json');

const ACIS_URL = 'https://data.rcc-acis.org/GridData';
const PRISM_GRID = '21';
const CONCURRENCY = 4;
const RETRIES = 3;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};

// Latest season whose winter has finished: before July, last winter is
// still the current season year minus one.
const now = new Date();
const defaultLast = now.getMonth() >= 6 ? now.getFullYear() - 1 : now.getFullYear() - 2;
const SEASON_COUNT = arg('seasons', 20);
const LAST_START = arg('last', defaultLast); // start year of the newest season
const FIRST_START = LAST_START - SEASON_COUNT + 1;

const seasonLabel = (start) => `${start}-${String(start + 1).slice(2)}`;
const SEASONS = Array.from({ length: SEASON_COUNT }, (_, i) => seasonLabel(FIRST_START + i));
const SDATE = `${FIRST_START}-07-01`;
const EDATE = `${LAST_START + 1}-06-30`;

async function readPlaces() {
  const [header, ...rows] = (await readFile(PLACES_CSV, 'utf8')).trim().split('\n');
  const cols = header.split(',');
  return rows.map((row) => {
    // Names don't contain commas in the Census file, but guard against quotes.
    const values = row.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((v) => v.replace(/,$/, '').replace(/^"|"$/g, ''));
    const place = Object.fromEntries(cols.map((c, i) => [c, values[i]]));
    return { ...place, lat: Number(place.lat), lon: Number(place.lon) };
  });
}

const exists = (file) => access(file).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchDailyLows(place) {
  const cacheFile = path.join(CACHE_DIR, `${place.geoid}_${SDATE}_${EDATE}.json`);
  if (await exists(cacheFile)) return JSON.parse(await readFile(cacheFile, 'utf8'));

  const body = JSON.stringify({
    loc: `${place.lon},${place.lat}`,
    sdate: SDATE,
    edate: EDATE,
    grid: PRISM_GRID,
    elems: [{ name: 'mint', interval: 'dly', duration: 'dly' }],
  });

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(ACIS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      await writeFile(cacheFile, JSON.stringify(json.data));
      return json.data;
    } catch (err) {
      if (attempt >= RETRIES) throw new Error(`${place.name} (${place.geoid}): ${err.message}`);
      await sleep(1000 * attempt);
    }
  }
}

// Daily rows [[date, value], ...] -> per-season [min °F, date] (null if no data).
function reduceToSeasons(daily) {
  const lows = Object.fromEntries(SEASONS.map((s) => [s, null]));
  for (const [date, value] of daily) {
    if (typeof value !== 'number' || value <= -999) continue; // -999 = missing
    const [y, m] = date.split('-').map(Number);
    const season = seasonLabel(m >= 7 ? y : y - 1);
    if (!(season in lows)) continue;
    if (!lows[season] || value < lows[season][0]) lows[season] = [value, date];
  }
  return SEASONS.map((s) => lows[s]);
}

async function run() {
  await mkdir(CACHE_DIR, { recursive: true });
  const places = await readPlaces();
  console.log(`Fetching ${SEASONS[0]} – ${SEASONS.at(-1)} daily lows for ${places.length} places...`);

  const results = {};
  const failures = [];
  let done = 0;
  let next = 0;

  async function worker() {
    while (next < places.length) {
      const place = places[next++];
      try {
        results[place.geoid] = reduceToSeasons(await fetchDailyLows(place));
      } catch (err) {
        failures.push(err.message);
      }
      if (++done % 50 === 0 || done === places.length) console.log(`  ${done}/${places.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Keep output ordered like the CSV for stable diffs.
  const ordered = Object.fromEntries(places.filter((p) => results[p.geoid]).map((p) => [p.geoid, results[p.geoid]]));

  const output = {
    meta: {
      source: 'PRISM 4km daily minimum temperature via NOAA RCC ACIS (grid 21)',
      units: 'F',
      season: 'Jul 1 – Jun 30',
      seasons: SEASONS,
      format: 'places[geoid][i] = [coldest °F, "YYYY-MM-DD"] for meta.seasons[i], or null',
      generated: new Date().toISOString(),
    },
    places: ordered,
  };
  await writeFile(OUT_FILE, JSON.stringify(output));

  const missing = Object.values(ordered).flat().filter((v) => v === null).length;
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}: ${Object.keys(ordered).length} places, ${missing} missing season values.`);
  if (failures.length) {
    console.error(`${failures.length} places failed (re-run to retry):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  }
}

run();
