import 'leaflet/dist/leaflet.css';
import './styles/main.scss';

import { createMap } from './map.js';
import { loadLayers } from './layers.js';
import { createInfoPanel } from './info-panel.js';
import { addLegend } from './legend.js';
import { fetchJson, fetchGrid } from './data.js';
import { createZoneGrid } from './zone-grid.js';
import { DEFAULT_WINDOW, createClimate, windowLabel, zoneRange } from './zones.js';

async function init() {
  const map = createMap('map');
  const panel = createInfoPanel(document.getElementById('info-body'));
  const windowSet = document.querySelector('.window');
  const chips = document.getElementById('zone-window');
  const spanText = document.getElementById('window-span');

  let years = DEFAULT_WINDOW;
  let selection = null; // what the panel is showing, so it can re-render on window change

  try {
    const [lows, elevation, gridData] = await Promise.all([
      fetchJson('nc-lows.json'),
      fetchJson('nc-elevation.json'),
      fetchGrid('nc-grid-800m'),
    ]);
    const climate = createClimate(lows, elevation);

    if (!climate.windows.includes(years)) years = climate.windows[0];
    chips.innerHTML = climate.windows
      .map((n) => {
        const { title } = windowLabel(n, climate.seasons);
        return `<label class="chip" title="${title}">
          <input type="radio" name="zone-window" value="${n}"${n === years ? ' checked' : ''} />
          <span>${n === 1 ? '1 yr' : `${n} yrs`}</span>
        </label>`;
      })
      .join('');
    const showSpan = () => {
      spanText.textContent = `Winters ${windowLabel(years, climate.seasons).span}`;
    };
    showSpan();

    let grid = null;

    // A town's zone is the blended grid value at its point, so it always matches
    // the color drawn under it. Dates and elevation come from the town's own data.
    const townClimate = (place) => {
      const own = climate.get(place.geoid, years);
      const blended = grid?.valueAt(place.lat, place.lon, years);
      if (!blended) return own;
      return {
        ...blended,
        elevation: own?.elevation ?? null,
        winters: blended.winters.map((w, i) => ({ ...w, date: own?.winters[i]?.date ?? null })),
      };
    };

    const showSelection = () => {
      if (!selection) return;
      const window = windowLabel(years, climate.seasons);
      if (selection.place) {
        panel.showPlace(selection.place, townClimate(selection.place), window);
      } else {
        const { county, nearest, latlng } = selection;
        panel.showUnincorporated(county, nearest, grid.valueAt(latlng.lat, latlng.lng, years), window);
      }
    };

    const layers = await loadLayers(map, {
      getZone: (place) => townClimate(place)?.zone ?? null,
      onPlaceSelect: (place) => {
        selection = { place };
        showSelection();
      },
      onCountySelect: (county, nearest, latlng) => {
        selection = { county, nearest, latlng };
        showSelection();
      },
    });

    grid = createZoneGrid(map, gridData, layers.state);
    grid.render(years);

    addLegend(map, grid.zonesInUse(climate.windows).sort((a, b) => zoneRange(a)[0] - zoneRange(b)[0]));

    chips.addEventListener('change', (e) => {
      years = Number(e.target.value);
      showSpan();
      grid.render(years);
      showSelection();
    });
    windowSet.disabled = false;
  } catch (err) {
    console.error(err);
    panel.showError(
      'Map data could not be loaded. Run "npm run build:geo", "npm run fetch:lows", "npm run fetch:grid800" and "npm run check:data", then reload.',
    );
  }
}

init();
