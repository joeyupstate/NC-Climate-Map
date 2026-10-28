import { ZONE_COLORS } from './zone-colors.js';

// Time windows offered in the selector, in winters.
export const WINDOWS = [20, 15, 10, 8, 5, 2, 1];
export const DEFAULT_WINDOW = 10;

// Half-zones step 5°F, starting with zone 1a at -60°F (1a = -60 to -55°F).
export function zoneFor(temp) {
  const i = Math.floor((temp + 60) / 5);
  return `${Math.floor(i / 2) + 1}${i % 2 ? 'b' : 'a'}`;
}

export function zoneRange(zone) {
  const half = (parseInt(zone, 10) - 1) * 2 + (zone.endsWith('b') ? 1 : 0);
  const low = -60 + half * 5;
  return [low, low + 5];
}

export const zoneColor = (zone) => ZONE_COLORS[zone] ?? '#cccccc';

// "2016-17" -> "2016–17"
export const seasonLabel = (season) => season.replace('-', '–');

export function windowLabel(years, seasons) {
  const recent = seasons.slice(-years);
  const span = years === 1 ? seasonLabel(recent[0]) : `${seasonLabel(recent[0])} to ${seasonLabel(recent.at(-1))}`;
  return { title: years === 1 ? 'Past year' : `Past ${years} years`, span };
}

// Zone math over nc-lows.json (+ elevations from nc-elevation.json).
// A place's zone = average of its coldest night in each of the last N winters.
export function createClimate(lows, elevation) {
  const { seasons } = lows.meta;
  // Only offer windows the data actually covers.
  const windows = WINDOWS.filter((years) => years <= seasons.length);

  function get(geoid, years) {
    const all = lows.places[geoid];
    if (!all) return null;
    const recent = all.slice(-years);
    const values = recent.filter(Boolean).map(([temp]) => temp);
    if (!values.length) return null;
    // Round first so the displayed average and the zone always agree.
    const avgLow = Math.round((values.reduce((s, t) => s + t, 0) / values.length) * 10) / 10;
    return {
      avgLow,
      zone: zoneFor(avgLow),
      winters: recent.map((low, i) => ({ season: seasons.at(-years + i), temp: low?.[0] ?? null, date: low?.[1] ?? null })),
      elevation: elevation?.places[geoid]?.elev ?? null,
    };
  }

  return { seasons, windows, get };
}
