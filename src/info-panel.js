import { zoneColor, zoneRange, seasonLabel } from './zones.js';
import { CATEGORIES, palmsForZone } from './palms.js';

const TYPE_LABELS = {
  city: 'City',
  town: 'Town',
  village: 'Village',
  cdp: 'Unincorporated community (CDP)',
};

const escape = (str) =>
  String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const formatTemp = (t) => `${t.toFixed(Number.isInteger(t) ? 0 : 1)}°F`;

function palmSection(zone) {
  const groups = palmsForZone(zone);
  const lists = CATEGORIES.map(({ key, label, hint }) => {
    const items = groups[key]
      .map(({ name, common, note }) =>
        `<li><span class="palms__common">${escape(common)}</span> <i>${escape(name)}</i>${note ? `<span class="palms__note">${escape(note)}</span>` : ''}</li>`)
      .join('');
    return `
      <div class="palms__group palms__group--${key}">
        <h4 class="palms__label">${label} <span>${groups[key].length}</span></h4>
        <p class="palms__hint">${hint}</p>
        ${items ? `<ul class="palms__list">${items}</ul>` : '<p class="palms__none">None for this zone</p>'}
      </div>`;
  }).join('');
  return `
    <section class="palms">
      <h3 class="info__section-title">Palms for zone ${zone}</h3>
      ${lists}
    </section>`;
}

// climate: result of climate.get(), window: { title, span }, note: optional source caveat.
function climateSection(climate, window, note = '') {
  if (!climate) {
    return `<section class="info__climate"><p class="info__pending">No temperature data for this place.</p></section>`;
  }
  const [low, high] = zoneRange(climate.zone);
  const hasDates = climate.winters.some((w) => w.date);
  const winters = climate.winters
    .slice()
    .reverse()
    .map(({ season, temp, date }) =>
      `<tr><td>${seasonLabel(season)}</td><td>${temp == null ? '—' : formatTemp(temp)}</td>${hasDates ? `<td>${date ? formatDate(date) : ''}</td>` : ''}</tr>`)
    .join('');

  return `
    <section class="info__climate">
      <h3 class="info__section-title">${escape(window.title)} <span>(${escape(window.span)} winters)</span></h3>
      <div class="zone-badge" style="--zone-color:${zoneColor(climate.zone)}">
        <span class="zone-badge__label">Zone</span>
        <span class="zone-badge__value">${climate.zone}</span>
        <span class="zone-badge__range">${low} to ${high}°F</span>
      </div>
      ${note ? `<p class="info__note">${note}</p>` : ''}
      <dl class="info__list">
        <div><dt>Avg. coldest night</dt><dd>${formatTemp(climate.avgLow)}</dd></div>
        ${climate.elevation != null ? `<div><dt>Elevation</dt><dd>${climate.elevation.toLocaleString()} ft</dd></div>` : ''}
      </dl>
      ${palmSection(climate.zone)}
      <table class="winters">
        <caption>Coldest night each winter</caption>
        <thead><tr><th>Winter</th><th>Low</th>${hasDates ? '<th>Date</th>' : ''}</tr></thead>
        <tbody>${winters}</tbody>
      </table>
    </section>`;
}

export function createInfoPanel(el) {
  const render = (html) => {
    el.innerHTML = html;
  };

  render('<p class="info__empty">No place selected.</p>');

  return {
    showPlace({ name, type, county }, climate, window) {
      render(`
        <article class="info">
          <h2 class="info__name">${escape(name)}</h2>
          <p class="info__type">${escape(TYPE_LABELS[type] ?? type)} · ${escape(county)} County</p>
          ${climateSection(climate, window)}
        </article>`);
    },

    // climate: grid value at the clicked point.
    showUnincorporated({ name }, nearest, climate, window) {
      const nearestName = nearest && escape(nearest.place.name);
      render(`
        <article class="info">
          <h2 class="info__name">${nearest ? `Near ${nearestName}` : 'Unincorporated area'}</h2>
          <p class="info__type">Unincorporated · ${escape(name)} County${nearest ? ` · ${nearest.distanceMi.toFixed(1)} mi from ${nearestName}` : ''}</p>
          ${climateSection(climate, window, 'Climate at this spot, from the 800 m temperature grid.')}
        </article>`);
    },

    showError(message) {
      render(`<p class="info__error">${escape(message)}</p>`);
    },
  };
}
