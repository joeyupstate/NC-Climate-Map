import L from 'leaflet';
import { fetchJson } from './data.js';
import { findNearestPlace } from './nearest.js';

const CAN_HOVER = window.matchMedia('(hover: hover)').matches;

const STYLES = {
  state: { color: '#1f4d36', weight: 2, fill: false, interactive: false },
  county: { color: '#3d4a40', weight: 0.6, opacity: 0.35, fillColor: '#ffffff', fillOpacity: 0 },
  // Towns are faint outlines over the statewide zone grid; fill stays clickable at 0 opacity.
  place: { color: '#2f3b33', weight: 0.6, opacity: 0.4, fillColor: '#ffffff', fillOpacity: 0 },
  placeHover: { color: '#1f4d36', weight: 2, opacity: 1, fillColor: '#fffaf0', fillOpacity: 0.35 },
  placeSelected: { color: '#b85c38', weight: 2.5, opacity: 1, fillColor: '#fffaf0', fillOpacity: 0.35 },
};

// getZone(placeProps) -> zone string for the current window, or null (used in tooltips).
export async function loadLayers(map, { getZone, onPlaceSelect, onCountySelect }) {
  const [state, counties, places] = await Promise.all([
    fetchJson('nc-state.geojson'),
    fetchJson('nc-counties.geojson'),
    fetchJson('nc-places.geojson'),
  ]);

  const placeList = places.features.map((f) => f.properties);
  let selected = null;

  const clearSelection = () => {
    if (selected) placesLayer.resetStyle(selected);
    selected = null;
  };

  // Counties sit under places, so a click only reaches a county when it
  // misses every place — that's the "unincorporated" fallback.
  const countiesLayer = L.geoJSON(counties, {
    style: STYLES.county,
    onEachFeature: (feature, layer) => {
      layer.on('click', (e) => {
        clearSelection();
        onCountySelect(feature.properties, findNearestPlace(placeList, e.latlng.lat, e.latlng.lng), e.latlng);
      });
    },
  }).addTo(map);

  const placesLayer = L.geoJSON(places, {
    style: STYLES.place,
    onEachFeature: (feature, layer) => {
      const { name } = feature.properties;
      // Hover tooltips only where there's a mouse; on touch they open on tap and stick.
      if (CAN_HOVER) {
        layer.bindTooltip(() => {
          const zone = getZone(feature.properties);
          return zone ? `${name} · Zone ${zone}` : name;
        }, { sticky: true, direction: 'top' });
      }
      layer.on({
        mouseover: () => layer !== selected && layer.setStyle(STYLES.placeHover),
        mouseout: () => layer !== selected && placesLayer.resetStyle(layer),
        click: (e) => {
          L.DomEvent.stopPropagation(e);
          clearSelection();
          selected = layer;
          layer.setStyle(STYLES.placeSelected).bringToFront();
          onPlaceSelect(feature.properties);
        },
      });
    },
  }).addTo(map);

  L.geoJSON(state, { style: STYLES.state }).addTo(map);

  return { countiesLayer, placesLayer, state };
}
