import 'leaflet/dist/leaflet.css';
import './styles/main.scss';

import L from 'leaflet';
import { createMap, fitNC, setPanLimits } from './map.js';
import { createSheet, MOBILE } from './sheet.js';
import { loadLayers } from './layers.js';
import { createInfoPanel } from './info-panel.js';
import { addLegend } from './legend.js';
import { fetchJson, fetchGrid } from './data.js';
import { createZoneGrid } from './zone-grid.js';
import { DEFAULT_WINDOW, createClimate, windowLabel, zoneRange } from './zones.js';

async function init() {
  const map = createMap('map');
  const panel = createInfoPanel(document.getElementById('info-body'));
  const topBar = document.getElementById('panel-top');
  const sheet = createSheet(document.getElementById('sheet'), document.getElementById('sheet-handle'), topBar);

  // Phones: the map is full-screen under the top bar and the sheet, so frame
  // NC in the space between them.
  const frame = () => {
    setPanLimits(map, MOBILE.matches);
    if (MOBILE.matches) fitNC(map, { top: topBar.offsetHeight, bottom: sheet.peekHeight() });
    else fitNC(map);
  };
  frame();
  document.fonts?.ready.then(frame); // the top bar's height settles once fonts load
  MOBILE.addEventListener('change', frame);

  // Phones: open the sheet and pan so the tapped spot stays visible above it.
  const reveal = (latlng) => {
    if (!MOBILE.matches) return;
    sheet.open('half');
    const top = topBar.offsetHeight;
    const bottom = window.innerHeight - sheet.targetHeight();
    const { y } = map.latLngToContainerPoint(latlng);
    if (y < top + 24 || y > bottom - 24) map.panBy([0, y - (top + bottom) / 2]);
  };
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
        reveal(L.latLng(place.lat, place.lon));
      },
      onCountySelect: (county, nearest, latlng) => {
        selection = { county, nearest, latlng };
        showSelection();
        reveal(latlng);
      },
    });

    grid = createZoneGrid(map, gridData, layers.state);
    grid.render(years);

    const legend = addLegend(map, grid.zonesInUse(climate.windows).sort((a, b) => zoneRange(a)[0] - zoneRange(b)[0]));
    // Phones: legend sits just above the sheet; desktop: top-right.
    const placeLegend = () => legend.setPosition(MOBILE.matches ? 'bottomleft' : 'topright');
    placeLegend();
    MOBILE.addEventListener('change', placeLegend);

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
