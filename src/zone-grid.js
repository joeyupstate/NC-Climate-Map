import L from 'leaflet';
import { zoneColor, zoneFor } from './zones.js';

const TARGET_WIDTH = 2200; // canvas pixels across the grid; interpolation keeps edges smooth
const FILL_KM = 4; // how far a no-land cell may borrow from the nearest land cell

const toRad = (deg) => (deg * Math.PI) / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2));
const mercLat = (y) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const round1 = (n) => Math.round(n * 10) / 10;

// Statewide zone raster from the grid (see fetchGrid), drawn as an image
// overlay that is clipped to the NC outline and re-painted when the zone
// window changes.
//
// Zone edges are smoothed by bilinear interpolation: each pixel's temperature
// is blended from the 4 nearest grid cell centers, then mapped to a zone.
// Click values use the same interpolation, so the panel matches the color.
export function createZoneGrid(map, grid, state) {
  const { rows, cols, lat0, lon0, step, seasons } = grid.meta;
  const half = step / 2;
  const south = lat0 - half;
  const north = lat0 + (rows - 1) * step + half;
  const west = lon0 - half;
  const east = lon0 + (cols - 1) * step + half;
  const bounds = L.latLngBounds([south, west], [north, east]);

  // Canvas is laid out in Web Mercator so it lines up with the basemap.
  const width = cols * Math.max(1, Math.round(TARGET_WIDTH / cols));
  const yNorth = mercY(north);
  const ySouth = mercY(south);
  const height = Math.round((width * (yNorth - ySouth)) / toRad(east - west));

  // Fractional grid position of each pixel column / row (cell centers are integers).
  const colPos = Float64Array.from({ length: width }, (_, px) => (west + ((px + 0.5) / width) * (east - west) - lon0) / step);
  const rowPos = Float64Array.from({ length: height }, (_, py) => {
    const lat = mercLat(yNorth - ((py + 0.5) / height) * (yNorth - ySouth));
    return (lat - lat0) / step;
  });

  const project = ([lon, lat]) => [
    ((lon - west) / (east - west)) * width,
    ((yNorth - mercY(lat)) / (yNorth - ySouth)) * height,
  ];
  const clipPath = new Path2D();
  for (const feature of state.features) {
    const { type, coordinates } = feature.geometry;
    const polygons = type === 'Polygon' ? [coordinates] : coordinates;
    for (const rings of polygons) {
      for (const ring of rings) {
        ring.forEach((pt, i) => clipPath[i ? 'lineTo' : 'moveTo'](...project(pt)));
        clipPath.closePath();
      }
    }
  }

  // Pixels inside NC (plus a 1px margin so the anti-aliased clip edge has color under it).
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  mctx.lineWidth = 2;
  mctx.fill(clipPath, 'evenodd');
  mctx.stroke(clipPath);
  const maskAlpha = mctx.getImageData(0, 0, width, height).data;
  const inMask = (x, y) => x >= 0 && x < width && y >= 0 && y < height && maskAlpha[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] > 0;

  // Which cells have their center inside NC (for the legend).
  const inState = new Uint8Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      inState[row * cols + col] = inMask(...project([lon0 + col * step, lat0 + row * step])) ? 1 : 0;
    }
  }

  // Barrier islands can be narrower than a cell, so some of their area falls in
  // cells PRISM treats as water. Those cells borrow the nearest land cell
  // (within FILL_KM); anything farther stays empty.
  const fillRadius = Math.ceil(FILL_KM / (step * 111));
  const hasData = new Uint8Array(rows * cols);
  for (const season of grid.lows) season.forEach((v, i) => !Number.isNaN(v) && (hasData[i] = 1));
  const source = new Int32Array(rows * cols).fill(-1);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (hasData[i]) {
        source[i] = i;
        continue;
      }
      let best = Infinity;
      for (let dr = -fillRadius; dr <= fillRadius; dr++) {
        const r = row + dr;
        if (r < 0 || r >= rows) continue;
        for (let dc = -fillRadius; dc <= fillRadius; dc++) {
          const c = col + dc;
          const d = dr * dr + dc * dc;
          if (c < 0 || c >= cols || d >= best || !hasData[r * cols + c]) continue;
          best = d;
          source[i] = r * cols + c;
        }
      }
    }
  }

  // Per-cell value, NaN where there's no land: one season, or the average of the last `years`.
  const seasonFields = grid.lows.map((season) => Float32Array.from(source, (src) => (src < 0 ? NaN : season[src])));
  const averageFields = new Map(); // years -> field, cached for hover/click lookups
  const averageField = (years) => {
    if (averageFields.has(years)) return averageFields.get(years);
    const recent = seasonFields.slice(-years);
    const field = new Float32Array(rows * cols);
    for (let i = 0; i < field.length; i++) {
      let sum = 0;
      let n = 0;
      for (const season of recent) {
        if (!Number.isNaN(season[i])) {
          sum += season[i];
          n += 1;
        }
      }
      field[i] = n ? sum / n : NaN;
    }
    averageFields.set(years, field);
    return field;
  };

  // Bilinear blend of the 4 cell centers around (rowF, colF); missing
  // neighbors are skipped and the remaining weights renormalized.
  function sample(field, rowF, colF) {
    const r0 = Math.floor(rowF);
    const c0 = Math.floor(colF);
    const fr = rowF - r0;
    const fc = colF - c0;
    let sum = 0;
    let weight = 0;
    for (let dr = 0; dr <= 1; dr++) {
      const r = r0 + dr;
      if (r < 0 || r >= rows) continue;
      const wr = dr ? fr : 1 - fr;
      for (let dc = 0; dc <= 1; dc++) {
        const c = c0 + dc;
        if (c < 0 || c >= cols) continue;
        const v = field[r * cols + c];
        const w = wr * (dc ? fc : 1 - fc);
        if (Number.isNaN(v) || w === 0) continue;
        sum += v * w;
        weight += w;
      }
    }
    return weight > 0 ? sum / weight : NaN;
  }

  // Bilinear corners and weights for every masked pixel, precomputed so
  // render() only does the weighted sums.
  const pixels = [];
  for (let p = 0; p < width * height; p++) if (maskAlpha[p * 4 + 3]) pixels.push(p);
  const count = pixels.length;
  const pixelIndex = Int32Array.from(pixels);
  const corner = new Int32Array(count * 4); // cell index of each corner
  const cornerWeight = new Float32Array(count * 4); // 0 = off-grid
  pixels.forEach((p, k) => {
    const rowF = rowPos[Math.floor(p / width)];
    const colF = colPos[p % width];
    const r0 = Math.floor(rowF);
    const c0 = Math.floor(colF);
    const fr = rowF - r0;
    const fc = colF - c0;
    [[0, 0, (1 - fr) * (1 - fc)], [0, 1, (1 - fr) * fc], [1, 0, fr * (1 - fc)], [1, 1, fr * fc]].forEach(([dr, dc, w], j) => {
      const r = r0 + dr;
      const c = c0 + dc;
      const inside = r >= 0 && r < rows && c >= 0 && c < cols;
      corner[k * 4 + j] = inside ? r * cols + c : 0;
      cornerWeight[k * 4 + j] = inside ? w : 0;
    });
  });

  const raw = document.createElement('canvas');
  raw.width = width;
  raw.height = height;
  const clipped = document.createElement('canvas');
  clipped.width = width;
  clipped.height = height;

  map.createPane('zones');
  map.getPane('zones').style.zIndex = 350; // above tiles, below towns/counties
  map.getPane('zones').style.pointerEvents = 'none';
  const overlay = L.imageOverlay('', bounds, { pane: 'zones', opacity: 0.85, className: 'zone-grid' }).addTo(map);

  const rgbCache = {};
  const rgbFor = (temp) => {
    const zone = zoneFor(round1(temp));
    return (rgbCache[zone] ??= hexToRgb(zoneColor(zone)));
  };

  function render(years) {
    const field = averageField(years);
    const ctx = raw.getContext('2d');
    const image = ctx.createImageData(width, height);
    const data = image.data;
    for (let k = 0; k < count; k++) {
      let sum = 0;
      let weight = 0;
      for (let j = k * 4; j < k * 4 + 4; j++) {
        const w = cornerWeight[j];
        if (w === 0) continue;
        const v = field[corner[j]];
        if (Number.isNaN(v)) continue; // NaN = no land; renormalize over the rest
        sum += v * w;
        weight += w;
      }
      if (weight === 0) continue;
      const rgb = rgbFor(sum / weight);
      const o = pixelIndex[k] * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);

    const out = clipped.getContext('2d');
    out.clearRect(0, 0, width, height);
    out.save();
    out.clip(clipPath, 'evenodd');
    out.drawImage(raw, 0, 0);
    out.restore();
    overlay.setUrl(clipped.toDataURL());
  }

  // Climate at any point: same shape as climate.get(), minus dates/elevation.
  function valueAt(lat, lng, years) {
    const rowF = (lat - lat0) / step;
    const colF = (lng - lon0) / step;
    if (rowF < -0.5 || rowF > rows - 0.5 || colF < -0.5 || colF > cols - 0.5) return null;
    const avg = sample(averageField(years), rowF, colF);
    if (Number.isNaN(avg)) return null;
    const avgLow = round1(avg);
    return {
      avgLow,
      zone: zoneFor(avgLow),
      winters: seasonFields.slice(-years).map((field, i) => {
        const temp = sample(field, rowF, colF);
        return { season: seasons.at(-years + i), temp: Number.isNaN(temp) ? null : round1(temp), date: null };
      }),
      elevation: null,
    };
  }

  // Every zone that appears inside NC for the given windows.
  function zonesInUse(windows) {
    const found = new Set();
    for (const years of windows) {
      const field = averageField(years);
      for (let i = 0; i < rows * cols; i++) {
        if (inState[i] && !Number.isNaN(field[i])) found.add(zoneFor(round1(field[i])));
      }
    }
    return [...found];
  }

  return { render, valueAt, zonesInUse };
}
