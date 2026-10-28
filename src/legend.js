import L from 'leaflet';
import { zoneColor, zoneRange } from './zones.js';

export function addLegend(map, zones) {
  const legend = L.control({ position: 'bottomright' });

  legend.onAdd = () => {
    const el = L.DomUtil.create('div', 'legend');
    const rows = [...zones]
      .reverse() // warmest on top, like the USDA key
      .map((zone) => {
        const [low, high] = zoneRange(zone);
        return `<li><span class="legend__swatch" style="background:${zoneColor(zone)}"></span><b>${zone}</b><span>${low} to ${high}°F</span></li>`;
      })
      .join('');
    el.innerHTML = `<h2 class="legend__title">Hardiness zone</h2><ul class="legend__list">${rows}</ul>`;
    L.DomEvent.disableClickPropagation(el);
    return el;
  };

  legend.addTo(map);
  return legend;
}
