// Classify a TCGdex rarity string into one of three tiers used for card-tile
// visual treatment: plain, foil (holo shimmer), or ultra (shimmer + sparkles).
//
// TCGdex's `rarity` field is a free-form string with lots of regional variation
// — "Holo Rare", "Rare Holo", "Rare Holo V", "Ultra Rare", "Secret Rare",
// "Rainbow Rare", "Amazing Rare", etc. We match case-insensitively on known
// substrings rather than enumerating every canonical value.

export type RarityTier = 'common' | 'foil' | 'ultra';

// Anything containing one of these substrings is treated as ultra-tier
// (shimmer + sparkle particles).
const ULTRA_MARKERS = [
  'ultra',
  'secret',
  'rainbow',
  'gold',
  'amazing',
  'hyper',
  'crown',
  'shiny',
  'alt art',
  'alternate art',
  'illustration',
];

// Anything containing one of these substrings is treated as foil-tier
// (shimmer only). Checked only if no ultra marker matched.
const FOIL_MARKERS = [
  'holo',
  'reverse',
  'ex',    // "Rare Holo ex"
  ' v ',   // "Rare Holo V" — space-guarded so "Verdant" etc. don't match
  'vmax',
  'vstar',
  'gx',
  'break',
];

export function getRarityTier(rarity: string | null | undefined): RarityTier {
  if (!rarity) return 'common';
  const lc = ` ${rarity.toLowerCase()} `;  // pad so " v " boundary check works at ends
  for (const marker of ULTRA_MARKERS) {
    if (lc.includes(marker)) return 'ultra';
  }
  for (const marker of FOIL_MARKERS) {
    if (lc.includes(marker)) return 'foil';
  }
  return 'common';
}
