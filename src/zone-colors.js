// USDA Plant Hardiness Zone Map (2023) colors, by half-zone.
//
// Colors only — zone values on this map come from our own temperature data.
// Copied from the official USDA ARS interactive map's renderer
// ("Plant Hardiness Zone - Main Map CONUS", ArcGIS item
// 58976e0300c44d3aa3e2e8b3de02d127, layer PHZM_Lower_48_Reclass).
// The lower-48 map defines 2b–11b; NC spans roughly 6a–9b.
//
// Each half-zone covers 5°F of average annual extreme minimum:
// zone 7a = 0 to 5°F, 7b = 5 to 10°F, and so on.
export const ZONE_COLORS = {
  '2b': '#ebb0eb',
  '3a': '#e091eb',
  '3b': '#cf7ddb',
  '4a': '#a66bff',
  '4b': '#5a75ed',
  '5a': '#73a1ff',
  '5b': '#5ec9e0',
  '6a': '#47b947',
  '6b': '#78c756',
  '7a': '#abd669',
  '7b': '#cddb70',
  '8a': '#edda85',
  '8b': '#ebcb57',
  '9a': '#dbb64f',
  '9b': '#f5b678',
  '10a': '#eb9c36',
  '10b': '#e6781e',
  '11a': '#e6561e',
  '11b': '#e88564',
};
