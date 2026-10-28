import { zoneColor, zoneFor, zoneRange, seasonLabel } from './zones.js';
import { CATEGORIES, palmsForZone } from './palms.js';

const TYPE_LABELS = {
  city: 'City',
  town: 'Town',
  village: 'Village',
  cdp: 'Community',
};

const ICONS = {
  palm: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9c-.5 4-.2 8 1 13"/><path d="M12 9C10 6 6.5 5 3 6.5c3 .3 5.5 1.5 9 2.5z"/><path d="M12 9c2-3 5.5-4 9-2.5-3 .3-5.5 1.5-9 2.5z"/><path d="M12 9c-1.5-2.5-1.5-5 0-7.5 1.5 2.5 1.5 5 0 7.5z"/><path d="M12 9c-3 .5-5.5 2.5-6.5 5.5 2.5-1.5 4.5-3 6.5-5.5z"/><path d="M12 9c3 .5 5.5 2.5 6.5 5.5-2.5-1.5-4.5-3-6.5-5.5z"/></svg>`,
  bulletproof: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>`,
  marginal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/></svg>`,
  protect: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11"/><path d="M9.5 3.5L12 5l2.5-1.5M9.5 20.5L12 19l2.5 1.5"/></svg>`,
};

const escape = (str) =>
  String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const formatDate = (iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

const formatTemp = (t) => `${t.toFixed(Number.isInteger(t) ? 0 : 1)}°F`;

function palmsTab(zone) {
  const groups = palmsForZone(zone);
  return CATEGORIES.map(({ key, label, hint }) => {
    const items = groups[key]
      .map(({ name, common, note }) => `
        <li class="palm">
          <span class="palm__common">${escape(common)}</span>
          <span class="palm__name">${escape(name)}</span>
          ${note ? `<span class="palm__note">${escape(note)}</span>` : ''}
        </li>`)
      .join('');
    return `
      <section class="palm-group palm-group--${key}">
        <header class="palm-group__head">
          <span class="palm-group__icon">${ICONS[key]}</span>
          <div>
            <h3 class="palm-group__label">${label}</h3>
            <p class="palm-group__hint">${hint}</p>
          </div>
          <span class="palm-group__count">${groups[key].length}</span>
        </header>
        ${items ? `<ul class="palm-group__list">${items}</ul>` : '<p class="palm-group__none">None for this zone</p>'}
      </section>`;
  }).join('');
}

// Horizontal bars of each winter's coldest night, newest first. Longer = colder;
// each bar wears the zone color its temperature falls in, with the value labeled.
function climateTab(climate, note) {
  const temps = climate.winters.map((w) => w.temp).filter((t) => t != null);
  const warm = Math.ceil((Math.max(...temps) + 2) / 5) * 5;
  const cold = Math.floor((Math.min(...temps) - 2) / 5) * 5;
  const pct = (t) => ((warm - t) / (warm - cold)) * 100;
  const rows = climate.winters
    .slice()
    .reverse()
    .map(({ season, temp, date }) => {
      if (temp == null) return `<li class="winter"><span class="winter__season">${seasonLabel(season)}</span><span class="winter__none">No data</span></li>`;
      const zone = zoneFor(temp);
      const tip = `${seasonLabel(season)}: ${formatTemp(temp)} (zone ${zone})${date ? ` on ${formatDate(date)}` : ''}`;
      return `
        <li class="winter" title="${escape(tip)}">
          <span class="winter__season">${seasonLabel(season)}</span>
          <span class="winter__track"><span class="winter__bar" style="width:${pct(temp)}%;--bar:${zoneColor(zone)}"></span></span>
          <span class="winter__temp">${formatTemp(temp)}</span>
          <span class="winter__date">${date ? formatDate(date, { month: 'short', day: 'numeric' }) : ''}</span>
        </li>`;
    })
    .join('');

  return `
    <section class="winters">
      <h3 class="winters__title">Coldest night each winter</h3>
      <p class="winters__hint">Longer bars are colder nights. The dashed line is the ${formatTemp(climate.avgLow)} average that sets the zone.</p>
      <ol class="winters__list" style="--avg:${pct(climate.avgLow)}%">${rows}</ol>
      ${note ? `<p class="winters__note">${note}</p>` : ''}
    </section>`;
}

export function createInfoPanel(el) {
  let tab = 'palms'; // remembered across selections
  let current = null; // last rendered view, re-rendered when the tab changes

  const render = (html) => {
    el.innerHTML = html;
  };

  el.addEventListener('click', (e) => {
    const button = e.target.closest('[data-tab]');
    if (!button || !current) return;
    tab = button.dataset.tab;
    current();
  });

  function placeView({ eyebrow, name, climate, window, extraStat, note }) {
    if (!climate) {
      render(`
        <article class="place">
          <p class="place__eyebrow">${eyebrow}</p>
          <h2 class="place__name">${name}</h2>
          <p class="place__empty">No temperature data for this spot.</p>
        </article>`);
      return;
    }
    const [low, high] = zoneRange(climate.zone);
    const coldest = climate.winters.filter((w) => w.temp != null).reduce((a, b) => (b.temp < a.temp ? b : a));
    const tabs = [
      ['palms', 'Palms'],
      ['climate', 'Climate'],
    ];
    render(`
      <article class="place">
        <p class="place__eyebrow">${eyebrow}</p>
        <h2 class="place__name">${name}</h2>

        <div class="zone-card" style="--zone:${zoneColor(climate.zone)}">
          <div class="zone-card__badge">
            <span>Zone</span>
            <strong>${climate.zone}</strong>
          </div>
          <div class="zone-card__body">
            <p class="zone-card__range">${low} to ${high}°F</p>
            <p class="zone-card__avg">Avg. coldest night <b>${formatTemp(climate.avgLow)}</b></p>
            <p class="zone-card__window">${escape(window.title)} · ${escape(window.span)}</p>
          </div>
        </div>

        <dl class="stats">
          <div><dt>Coldest night</dt><dd>${formatTemp(coldest.temp)}<small>${coldest.date ? formatDate(coldest.date) : seasonLabel(coldest.season)}</small></dd></div>
          ${climate.elevation != null ? `<div><dt>Elevation</dt><dd>${climate.elevation.toLocaleString()} ft</dd></div>` : ''}
          ${extraStat ?? ''}
        </dl>

        <div class="tabs" role="tablist">
          ${tabs.map(([key, label]) => `<button type="button" role="tab" class="tabs__tab" data-tab="${key}" aria-selected="${tab === key}">${label}</button>`).join('')}
        </div>
        <div class="tab-panel" role="tabpanel">
          ${tab === 'palms' ? palmsTab(climate.zone) : climateTab(climate, note)}
        </div>
      </article>`);
  }

  function intro() {
    render(`
      <div class="intro">
        <span class="intro__art">${ICONS.palm}</span>
        <h2 class="intro__title">Pick a spot on the map</h2>
        <p>Click any town or place in North Carolina to see its hardiness zone, its coldest nights, and which palms will grow there.</p>
        <ul class="intro__key">
          ${CATEGORIES.map(({ key, label, hint }) => `<li class="intro__key-item intro__key-item--${key}">${ICONS[key]}<span><b>${label}</b> ${hint.toLowerCase()}</span></li>`).join('')}
        </ul>
      </div>`);
  }

  intro();

  return {
    showPlace({ name, type, county }, climate, window) {
      current = () =>
        placeView({
          eyebrow: `${escape(TYPE_LABELS[type] ?? type)} · ${escape(county)} County`,
          name: escape(name),
          climate,
          window,
        });
      current();
    },

    // climate: grid value at the clicked point.
    showUnincorporated({ name }, nearest, climate, window) {
      current = () =>
        placeView({
          eyebrow: `Unincorporated · ${escape(name)} County`,
          name: nearest ? `Near ${escape(nearest.place.name)}` : 'Rural area',
          climate,
          window,
          extraStat: nearest
            ? `<div><dt>Nearest town</dt><dd>${nearest.distanceMi.toFixed(1)} mi<small>${escape(nearest.place.name)}</small></dd></div>`
            : '',
          note: 'Values for this exact spot, from the 800 m temperature grid.',
        });
      current();
    },

    showError(message) {
      current = null;
      render(`<p class="panel__error">${escape(message)}</p>`);
    },
  };
}
