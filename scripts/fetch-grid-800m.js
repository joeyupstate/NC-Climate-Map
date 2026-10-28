// Statewide 800 m grid of each winter's coldest night.
//
// Source: PRISM 800 m daily minimum temperature (AN81d, public since 2025),
// https://data.prism.oregonstate.edu/time_series/us/an/800m/tmin/daily/
// Each daily file covers the lower 48 (~45 MB), so we don't download every
// day. Instead:
//
//   1. Candidate nights: for each winter, pull the 4 km daily grid for NC
//      (Oct 1 – Apr 30, via ACIS) and pick the fewest nights that contain
//      every 4 km cell's exact coldest night (greedy cover; 4–15 per winter).
//   2. Download only those nights at 800 m, keep the NC window, delete the
//      rest. Each cell's winter minimum = its coldest candidate night.
//
// Seasons are read from nc-lows.json (run `npm run fetch:lows` first).
// Extracted NC windows are cached in data/raw/prism800/, so re-runs only
// download what's missing.
//
// Output:
//   public/data/nc-grid-800m.bin   Int8, value = °F × 2 (half-degree steps),
//                                  -128 = no data; [season][row][col],
//                                  rows south -> north
//   public/data/nc-grid-800m.json  metadata (grid geometry, seasons, dates used)
//
// Usage: node scripts/fetch-grid-800m.js

import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromFile } from 'geotiff';

const run = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOWS_FILE = path.join(ROOT, 'public/data/nc-lows.json');
const CACHE_DIR = path.join(ROOT, 'data/raw/prism800');
const OUT_BIN = path.join(ROOT, 'public/data/nc-grid-800m.bin');
const OUT_META = path.join(ROOT, 'public/data/nc-grid-800m.json');

const ACIS_URL = 'https://data.rcc-acis.org/GridData';
const PRISM_800M = 'https://data.prism.oregonstate.edu/time_series/us/an/800m/tmin/daily';
const BBOX = { west: -84.4, south: 33.8, east: -75.4, north: 36.65 }; // NC with a small margin
const NODATA = -128;

const exists = (file) => access(file).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 4) throw new Error(`${label}: ${err.message}`);
      await sleep(2000 * attempt);
    }
  }
}

// Fewest nights that hold every 4 km cell's exact coldest night of the winter.
async function candidateNights(startYear) {
  const cacheFile = path.join(CACHE_DIR, `candidates_${startYear}.json`);
  if (await exists(cacheFile)) return JSON.parse(await readFile(cacheFile, 'utf8'));

  const json = await withRetry(`4 km daily ${startYear}`, async () => {
    const res = await fetch(ACIS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bbox: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`,
        sdate: `${startYear}-10-01`,
        edate: `${startYear + 1}-04-30`,
        grid: '21',
        elems: [{ name: 'mint', interval: 'dly', duration: 'dly' }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(body.error);
    return body;
  });

  const days = json.data.map(([date, grid]) => [date, grid.flat()]);
  const cells = days[0][1].length;
  const coldest = new Array(cells).fill(Infinity);
  for (const [, grid] of days) grid.forEach((v, i) => v > -999 && v < coldest[i] && (coldest[i] = v));
  let open = new Set([...coldest.keys()].filter((i) => Number.isFinite(coldest[i])));

  const chosen = [];
  while (open.size) {
    let best = null;
    let bestHits = [];
    for (const [date, grid] of days) {
      const hits = [...open].filter((i) => grid[i] === coldest[i]);
      if (hits.length > bestHits.length) {
        best = date;
        bestHits = hits;
      }
    }
    chosen.push(best);
    open = new Set([...open].filter((i) => !bestHits.includes(i)));
  }
  chosen.sort();
  await writeFile(cacheFile, JSON.stringify(chosen));
  return chosen;
}

// NC window of one 800 m night, as °F (Float32, NaN = no data), rows north -> south.
async function nightWindow(date) {
  const stamp = date.replaceAll('-', '');
  const cacheFile = path.join(CACHE_DIR, `${stamp}.bin`);
  if (await exists(cacheFile)) {
    const tenths = new Int16Array((await readFile(cacheFile)).buffer.slice(0));
    return Float32Array.from(tenths, (v) => (v === -32768 ? NaN : v / 10));
  }

  const name = `prism_tmin_us_30s_${stamp}`;
  const work = path.join(tmpdir(), `prism800-${stamp}`);
  await mkdir(work, { recursive: true });
  try {
    const zip = path.join(work, `${name}.zip`);
    await withRetry(`download ${date}`, async () => {
      const res = await fetch(`${PRISM_800M}/${date.slice(0, 4)}/${name}.zip`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(zip, Buffer.from(await res.arrayBuffer()));
    });
    await run('unzip', ['-oq', zip, `${name}.tif`, '-d', work]);

    const image = await (await fromFile(path.join(work, `${name}.tif`))).getImage();
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();
    const nodata = image.getGDALNoData();
    const x0 = Math.floor((BBOX.west - originX) / resX);
    const x1 = Math.ceil((BBOX.east - originX) / resX);
    const y0 = Math.floor((BBOX.north - originY) / resY);
    const y1 = Math.ceil((BBOX.south - originY) / resY);
    const [band] = await image.readRasters({ window: [x0, y0, x1, y1] });

    const window = Float32Array.from(band, (c) => (c === nodata ? NaN : (c * 9) / 5 + 32));
    const tenths = Int16Array.from(window, (f) => (Number.isNaN(f) ? -32768 : Math.round(f * 10)));
    await writeFile(cacheFile, Buffer.from(tenths.buffer));
    await writeFile(
      path.join(CACHE_DIR, 'geometry.json'),
      JSON.stringify({ cols: x1 - x0, rows: y1 - y0, west: originX + x0 * resX, north: originY + y0 * resY, step: resX }),
    );
    return window;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const { seasons } = JSON.parse(await readFile(LOWS_FILE, 'utf8')).meta;

  console.log('Finding candidate cold nights from the 4 km grid...');
  const nights = {};
  for (const season of seasons) {
    nights[season] = await candidateNights(Number(season.slice(0, 4)));
    console.log(`  ${season}: ${nights[season].length} nights`);
  }
  const total = Object.values(nights).flat().length;
  console.log(`Downloading ${total} nights at 800 m (cached nights are skipped)...`);

  const winters = [];
  let done = 0;
  for (const season of seasons) {
    let coldest = null;
    for (const date of nights[season]) {
      const window = await nightWindow(date);
      if (!coldest) coldest = Float32Array.from(window);
      else for (let i = 0; i < window.length; i++) if (window[i] < coldest[i] || Number.isNaN(coldest[i])) coldest[i] = window[i];
      if (++done % 20 === 0 || done === total) console.log(`  ${done}/${total}`);
    }
    winters.push(coldest);
  }

  const geo = JSON.parse(await readFile(path.join(CACHE_DIR, 'geometry.json'), 'utf8'));
  const { rows, cols, step } = geo;
  // Flip rows to south -> north and pack as half-degree Int8.
  const out = new Int8Array(seasons.length * rows * cols);
  winters.forEach((grid, s) => {
    for (let row = 0; row < rows; row++) {
      const src = (rows - 1 - row) * cols;
      const dst = s * rows * cols + row * cols;
      for (let col = 0; col < cols; col++) {
        const f = grid[src + col];
        out[dst + col] = Number.isNaN(f) ? NODATA : Math.max(-127, Math.min(127, Math.round(f * 2)));
      }
    }
  });
  await writeFile(OUT_BIN, Buffer.from(out.buffer));
  await writeFile(
    OUT_META,
    JSON.stringify({
      source: 'PRISM 800m daily minimum temperature (AN81d), coldest of candidate nights per winter',
      units: 'F',
      season: 'Jul 1 – Jun 30',
      seasons,
      rows,
      cols,
      // Center of the south-west cell.
      lat0: +(geo.north - rows * step + step / 2).toFixed(6),
      lon0: +(geo.west + step / 2).toFixed(6),
      step: +step.toFixed(9),
      encoding: 'Int8 value / 2 = °F; -128 = no data; [season][row][col], rows south -> north',
      candidateNights: nights,
      generated: new Date().toISOString(),
    }),
  );

  const land = out.subarray(0, rows * cols).filter((v) => v !== NODATA).length;
  console.log(`Wrote ${path.relative(ROOT, OUT_BIN)}: ${cols} × ${rows} cells (${land} land), ${seasons.length} seasons, ${(out.length / 1e6).toFixed(1)} MB.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
