import L from 'leaflet';
import { fetchJson } from './data.js';
import { findNearestPlace } from './nearest.js';

const STYLES = {
  state: { color: '#1f3b4d', weight: 2.5, fill: false, interactive: false },
  county: { color: '#5b7083', weight: 0.75, fillColor: '#ffffff', fillOpacity: 0, opacity: 0.8 },
  // Towns are outlines over the statewide zone grid; fill stays clickable at 0 opacity.
  place: { color: '#374151', weight: 0.75, opacity: 0.7, fillColor: '#ffffff', fillOpacity: 0 },
  placeHover: { color: '#111827', weight: 2, opacity: 1, fillOpacity: 0.25 },
  placeSelected: { color: '#111827', weight: 3, opacity: 1, fillOpacity: 0.25 },
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
      layer.bindTooltip(() => {
        const zone = getZone(feature.properties);
        return zone ? `${name} · Zone ${zone}` : name;
      }, { sticky: true, direction: 'top' });
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
