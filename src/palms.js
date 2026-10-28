import { zoneRange } from './zones.js';

// Cold-hardy palms for NC. Temperatures (°F) are approximate:
//   damage = leaves start to burn, kill = palm is usually killed.
// List and thresholds reviewed by the project owner.
export const PALMS = [
  { name: 'Rhapidophyllum hystrix', common: 'Needle palm', damage: -5, kill: -15 },
  { name: "Sabal minor 'McCurtain'", common: 'McCurtain dwarf palmetto', damage: -5, kill: -15 },
  { name: 'Sabal minor', common: 'Dwarf palmetto', damage: 0, kill: -10 },
  { name: "Sabal 'Birmingham'", common: 'Birmingham palmetto', damage: 0, kill: -10 },
  { name: 'Sabal × brazoria', common: 'Brazoria palmetto', damage: 5, kill: -5 },
  { name: 'Trachycarpus fortunei', common: 'Windmill palm', damage: 5, kill: 0 },
  { name: 'Trachycarpus wagnerianus', common: "Wagner's windmill palm", damage: 5, kill: 0 },
  { name: 'Serenoa repens', common: 'Saw palmetto', damage: 12, kill: 5 },
  { name: 'Trithrinax campestris', common: 'Caranday palm', damage: 12, kill: 5 },
  { name: 'Sabal palmetto', common: 'Cabbage palm', damage: 15, kill: 5 },
  { name: 'Chamaerops humilis', common: 'Mediterranean fan palm', damage: 15, kill: 5 },
  { name: 'Butia odorata', common: 'Pindo / jelly palm', damage: 15, kill: 8 },
  { name: 'Sabal mexicana', common: 'Texas palmetto', damage: 15, kill: 8 },
  { name: '× Butyagrus nabonnandii', common: 'Mule palm', damage: 15, kill: 10 },
  { name: 'Brahea armata', common: 'Mexican blue palm', damage: 15, kill: 10, note: 'Needs excellent drainage' },
  { name: 'Washingtonia × filibusta', common: 'Filibusta fan palm', damage: 18, kill: 12 },
  { name: 'Phoenix canariensis', common: 'Canary Island date palm', damage: 20, kill: 12 },
  { name: 'Washingtonia robusta', common: 'Mexican fan palm', damage: 22, kill: 15 },
  { name: 'Livistona chinensis', common: 'Chinese fan palm', damage: 22, kill: 15 },
  { name: 'Syagrus romanzoffiana', common: 'Queen palm', damage: 26, kill: 20 },
];

export const CATEGORIES = [
  { key: 'bulletproof', label: 'Bulletproof', hint: 'Grows without protection' },
  { key: 'marginal', label: 'Marginal', hint: 'Usually fine, but a bad winter may kill it unprotected' },
  { key: 'protect', label: 'Needs protection', hint: 'Protect it most winters' },
];

// A zone's worst winters run about this far below its low end, and winter
// protection (wraps, frost cloth, heat cables) buys about PROTECTION_F.
const BAD_WINTER_F = 5;
const PROTECTION_F = 10;

// 'bulletproof' | 'marginal' | 'protect' | null (too cold even with protection)
export function palmCategory(palm, zone) {
  const [low] = zoneRange(zone);
  if (palm.kill <= low - BAD_WINTER_F && palm.damage <= low) return 'bulletproof';
  if (palm.kill <= low) return 'marginal';
  if (palm.kill <= low + PROTECTION_F) return 'protect';
  return null;
}

// { bulletproof: [palm], marginal: [palm], protect: [palm] }, hardiest first.
export function palmsForZone(zone) {
  const groups = Object.fromEntries(CATEGORIES.map(({ key }) => [key, []]));
  for (const palm of PALMS) {
    const category = palmCategory(palm, zone);
    if (category) groups[category].push(palm);
  }
  return groups;
}
