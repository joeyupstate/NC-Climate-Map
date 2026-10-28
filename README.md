# NC Climate Map

Interactive map of North Carolina plant hardiness zones, computed from our own
low-temperature data — not copied from the USDA map. Pick a window (past 20,
15, 10, 8, 5, 2 years or past year) and the map recolors using the USDA
zone colors. Click any town or spot for its zone and coldest night each winter.

## Run locally

```sh
npm install
npm run dev
```

## Data

All temperatures come from [PRISM](https://prism.oregonstate.edu) daily minimum
temperature grids. A zone is the average of each winter's coldest night
(winters run Jul 1 – Jun 30) over the selected window, in 5°F USDA half-zones.

The generated files in `public/data/` are committed, so the map works without
re-running these. To refresh them (e.g. after a new winter), run in order:

| Command | What it does |
|---|---|
| `npm run build:geo` | NC state, county and town boundaries (US Census) |
| `npm run fetch:lows` | Coldest night of each winter for every town (PRISM 4 km via NOAA ACIS) |
| `npm run fetch:grid800` | Statewide 800 m grid of each winter's coldest night (PRISM 800 m) |
| `npm run check:data` | Town elevations (USGS) and an accuracy check against weather stations |

Downloads are cached in `data/raw/` (not committed), so re-runs only fetch what's new.

Checked against 182 NC weather stations, the 800 m grid's 20-winter average
low is off by about 0.95°F on average, with no meaningful warm or cold bias.
