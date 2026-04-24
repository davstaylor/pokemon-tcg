import { describe, it, expect } from 'vitest';
import { getRarityTier } from '@/data/rarity-tier';

describe('getRarityTier', () => {
  it('treats null / empty as common', () => {
    expect(getRarityTier(null)).toBe('common');
    expect(getRarityTier(undefined)).toBe('common');
    expect(getRarityTier('')).toBe('common');
  });

  it('classifies everyday rarities as common', () => {
    expect(getRarityTier('Common')).toBe('common');
    expect(getRarityTier('Uncommon')).toBe('common');
    expect(getRarityTier('Rare')).toBe('common');
    expect(getRarityTier('Promo')).toBe('common');
    expect(getRarityTier('None')).toBe('common');
  });

  it('classifies holo variants as foil', () => {
    expect(getRarityTier('Holo Rare')).toBe('foil');
    expect(getRarityTier('Rare Holo')).toBe('foil');
    expect(getRarityTier('Reverse Holo')).toBe('foil');
    expect(getRarityTier('Rare Holo VMAX')).toBe('foil');
    expect(getRarityTier('Rare Holo GX')).toBe('foil');
    expect(getRarityTier('Rare Holo ex')).toBe('foil');
    expect(getRarityTier('Rare BREAK')).toBe('foil');
  });

  it('classifies ultra / secret / rainbow / gold / alt-art as ultra', () => {
    expect(getRarityTier('Ultra Rare')).toBe('ultra');
    expect(getRarityTier('Secret Rare')).toBe('ultra');
    expect(getRarityTier('Rare Rainbow')).toBe('ultra');
    expect(getRarityTier('Rare Gold')).toBe('ultra');
    expect(getRarityTier('Amazing Rare')).toBe('ultra');
    expect(getRarityTier('Hyper Rare')).toBe('ultra');
    expect(getRarityTier('Shiny Rare')).toBe('ultra');
    expect(getRarityTier('Rare Holo V Alt Art')).toBe('ultra');  // alt-art beats holo
    expect(getRarityTier('Illustration Rare')).toBe('ultra');
  });

  it('is case-insensitive', () => {
    expect(getRarityTier('ULTRA RARE')).toBe('ultra');
    expect(getRarityTier('holo rare')).toBe('foil');
    expect(getRarityTier('COMMON')).toBe('common');
  });

  it('does not misclassify creature / card names containing stray letters', () => {
    // The word "verdant" contains "v" but shouldn't trip the " v " foil marker.
    expect(getRarityTier('Verdant Common')).toBe('common');
    // A rarity mentioning "cover" shouldn't match "v" either.
    expect(getRarityTier('Cover Card')).toBe('common');
  });
});
