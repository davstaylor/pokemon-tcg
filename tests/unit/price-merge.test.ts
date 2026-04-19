import { describe, it, expect } from 'vitest';
import { mergePrices } from '@/data/price-merge';
import type { PriceFile } from '@/data/price-schema';

const priceA = {
  cardId: 'base1-4',
  sources: { cardmarket: { source: 'cardmarket' as const, unit: 'EUR' as const, trend: 300, low: 100, avg30: 320, avg7: 310, avg1: 305, updatedAt: '2026-04-19T00:00:00Z' } },
};
const priceAfresh = {
  cardId: 'base1-4',
  sources: { cardmarket: { source: 'cardmarket' as const, unit: 'EUR' as const, trend: 359, low: 92, avg30: 409, avg7: 324, avg1: 361, updatedAt: '2026-04-19T10:00:00Z' } },
};
const priceB = {
  cardId: 'base1-2',
  sources: { cardmarket: { source: 'cardmarket' as const, unit: 'EUR' as const, trend: 150, low: 50, avg30: 160, avg7: 155, avg1: 151, updatedAt: '2026-04-19T00:00:00Z' } },
};

const baseline: PriceFile = {
  generatedAt: '2026-04-19T02:00:00Z',
  records: { 'base1-4': priceA, 'base1-2': priceB },
};

describe('mergePrices', () => {
  it('returns baseline when fresh is empty', () => {
    const fresh: PriceFile = { generatedAt: '2026-04-19T09:00:00Z', records: {} };
    const merged = mergePrices(baseline, fresh);
    expect(merged['base1-4']).toEqual(priceA);
    expect(merged['base1-2']).toEqual(priceB);
  });

  it('fresh overrides baseline where both have the same card', () => {
    const fresh: PriceFile = { generatedAt: '2026-04-19T09:00:00Z', records: { 'base1-4': priceAfresh } };
    const merged = mergePrices(baseline, fresh);
    expect(merged['base1-4']).toEqual(priceAfresh);
    expect(merged['base1-2']).toEqual(priceB);   // untouched
  });

  it('fresh card not in baseline is added', () => {
    const priceC = { cardId: 'sv03-1', sources: { cardmarket: { source: 'cardmarket' as const, unit: 'EUR' as const, trend: 20, low: 10, avg30: 22, avg7: 21, avg1: 20, updatedAt: '2026-04-19T09:00:00Z' } } };
    const fresh: PriceFile = { generatedAt: '2026-04-19T09:00:00Z', records: { 'sv03-1': priceC } };
    const merged = mergePrices(baseline, fresh);
    expect(merged['sv03-1']).toEqual(priceC);
  });

  it('produces a plain object keyed by cardId', () => {
    const merged = mergePrices(baseline, { generatedAt: 'x', records: {} });
    expect(typeof merged).toBe('object');
    expect(merged['base1-4']?.cardId).toBe('base1-4');
  });
});
