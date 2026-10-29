import L from 'leaflet';

// NC's extent (state outline bounds, rounded out slightly).
const NC_BOUNDS = L.latLngBounds([33.8, -84.35], [36.6, -75.42]);

export function createMap(elementId) {
  const map = L.map(elementId, {
    maxBounds: NC_BOUNDS.pad(0.25),
    maxBoundsViscosity: 1,
    minZoom: 5, // low enough for the whole state to fit on a phone
    maxZoom: 14,
    zoomSnap: 0.25,
  });

  fitNC(map);

  // Esri light gray canvas: neutral, keyless basemap so data layers stand out.
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
  const attribution = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
  L.tileLayer(`${esri}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
    maxZoom: 16,
    attribution,
  }).addTo(map);
  L.tileLayer(`${esri}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, {
    maxZoom: 16,
    pane: 'shadowPane', // labels above the data layers
  }).addTo(map);

  return map;
}

// How far the map can be dragged. Phones get no limit: a tall screen at low
// zoom is taller than any sensible bounds (Leaflet then snaps the map back),
// and the coast must be liftable above a half-open bottom sheet.
export function setPanLimits(map, mobile) {
  map.setMaxBounds(mobile ? null : NC_BOUNDS.pad(0.25));
}

// Frame the whole state, leaving room for anything covering the map edges
// (on phones: the top bar and the bottom sheet), in pixels.
// The zoom isn't snapped, so the state fills the width of a phone exactly.
export function fitNC(map, { top = 0, bottom = 0 } = {}) {
  const snap = map.options.zoomSnap;
  map.options.zoomSnap = 0;
  map.fitBounds(NC_BOUNDS, { paddingTopLeft: [6, top + 8], paddingBottomRight: [6, bottom + 8], animate: false });
  map.options.zoomSnap = snap;
}
