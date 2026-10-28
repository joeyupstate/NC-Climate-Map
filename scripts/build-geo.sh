#!/usr/bin/env bash
# Build NC geographic data (state, counties, places) from US Census
# cartographic boundary files into web-ready GeoJSON + a CSV town list.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$ROOT/data/raw"
OUT="$ROOT/public/data"
MS="$ROOT/node_modules/.bin/mapshaper"
YEAR=2023
BASE="https://www2.census.gov/geo/tiger/GENZ${YEAR}/shp"

mkdir -p "$RAW" "$OUT"

for f in "cb_${YEAR}_37_place_500k" "cb_${YEAR}_us_county_500k" "cb_${YEAR}_us_state_500k"; do
  if [ ! -f "$RAW/$f.shp" ]; then
    echo "Downloading $f..."
    curl -sSfL -o "$RAW/$f.zip" "$BASE/$f.zip"
    unzip -oq "$RAW/$f.zip" -d "$RAW"
  fi
done

echo "Building nc-state.geojson..."
"$MS" "$RAW/cb_${YEAR}_us_state_500k.shp" \
  -filter 'STATEFP === "37"' \
  -filter-fields NAME \
  -rename-fields name=NAME \
  -simplify 15% keep-shapes \
  -o "$OUT/nc-state.geojson" format=geojson precision=0.00001 force

echo "Building nc-counties.geojson..."
"$MS" "$RAW/cb_${YEAR}_us_county_500k.shp" \
  -filter 'STATEFP === "37"' \
  -filter-fields NAME,GEOID \
  -rename-fields name=NAME,geoid=GEOID \
  -simplify 15% keep-shapes \
  -o "$OUT/nc-counties.geojson" format=geojson precision=0.00001 force

# LSAD codes: 25 = city, 43 = town, 47 = village, 57 = CDP.
# County = county with the largest overlap (places can straddle county lines).
# lat/lon = an interior point (guaranteed inside the polygon) for climate lookups.
echo "Building nc-places.geojson + nc-places.csv..."
"$MS" "$RAW/cb_${YEAR}_37_place_500k.shp" \
  -join "$OUT/nc-counties.geojson" largest-overlap fields=name prefix=county_ \
  -each 'type = ({"25":"city","43":"town","47":"village","57":"cdp"})[LSAD] || "other"' \
  -each 'county = county_name; lon = +this.innerX.toFixed(5); lat = +this.innerY.toFixed(5)' \
  -filter-fields NAME,GEOID,type,county,lat,lon \
  -rename-fields name=NAME,geoid=GEOID \
  -simplify 25% keep-shapes \
  -o "$OUT/nc-places.geojson" format=geojson precision=0.00001 force \
  -o "$OUT/nc-places.csv" format=csv force

echo "Done:"
ls -lh "$OUT"
