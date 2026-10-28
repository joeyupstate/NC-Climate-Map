const EARTH_RADIUS_MI = 3958.8;
const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in miles.
export function distanceMi(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

// Nearest place to a point, measured to each place's interior point.
// A linear scan over ~800 places is fast enough to run per click.
export function findNearestPlace(places, lat, lng) {
  let nearest = null;
  let best = Infinity;
  for (const place of places) {
    const d = distanceMi(lat, lng, place.lat, place.lon);
    if (d < best) {
      best = d;
      nearest = place;
    }
  }
  return nearest && { place: nearest, distanceMi: best };
}
