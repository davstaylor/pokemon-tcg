// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPortfolio,
  loadPortfolioSafe,
  savePortfolio,
  addEntry,
  removeEntry,
  updateEntry,
  PORTFOLIO_STORAGE_KEY,
} from '@/data/portfolio-storage';
import type { ExchangeRates } from '@/data/currency-schema';

beforeEach(() => {
  localStorage.clear();
});

const rates: ExchangeRates = {
  base: 'EUR',
  date: '2026-04-22',
  rates: { USD: 1.08, GBP: 0.86, JPY: 162.0 },
};

describe('loadPortfolio / savePortfolio', () => {
  it('loadPortfolio returns empty file when key missing', () => {
    const file = loadPortfolio();
    expect(file).toEqual({ version: 1, entries: [] });
  });

  it('loadPortfolioSafe flags corrupted JSON without throwing', () => {
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, 'not json');
    const result = loadPortfolioSafe();
    expect(result.corrupted).toBe(true);
    expect(result.file).toEqual({ version: 1, entries: [] });
  });

  it('savePortfolio round-trips via loadPortfolio', () => {
    const file = {
      version: 1 as const,
      entries: [
        { cardId: 'base1-4', qty: 1, costValue: 150, costCurrency: 'GBP' as const, addedAt: '2026-04-22' },
      ],
    };
    savePortfolio(file);
    expect(loadPortfolio()).toEqual(file);
  });
});

describe('addEntry', () => {
  it('adds a new entry with addedAt populated', () => {
    const start = { version: 1 as const, entries: [] };
    const next = addEntry(start, {
      cardId: 'base1-4', qty: 2, costValue: 150, costCurrency: 'GBP',
    }, rates, '2026-04-22');
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toEqual({
      cardId: 'base1-4', qty: 2, costValue: 150, costCurrency: 'GBP', addedAt: '2026-04-22',
    });
  });

  it('sums qty and cost when cardId already exists with matching currency', () => {
    const start = {
      version: 1 as const,
      entries: [{ cardId: 'base1-4', qty: 1, costValue: 100, costCurrency: 'GBP' as const, addedAt: '2026-04-20' }],
    };
    const next = addEntry(start, {
      cardId: 'base1-4', qty: 2, costValue: 300, costCurrency: 'GBP',
    }, rates, '2026-04-22');
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].qty).toBe(3);
    expect(next.entries[0].costValue).toBe(400);
    expect(next.entries[0].costCurrency).toBe('GBP');
    // addedAt should remain the original add date.
    expect(next.entries[0].addedAt).toBe('2026-04-20');
  });

  it('converts new cost to existing currency when currencies differ', () => {
    const start = {
      version: 1 as const,
      entries: [{ cardId: 'base1-4', qty: 1, costValue: 100, costCurrency: 'GBP' as const, addedAt: '2026-04-20' }],
    };
    // Adding €50 to a GBP row: convertBetween(50, EUR, GBP, rates) = 50 * 0.86 = 43. New cost = 100 + 43 = 143.
    const next = addEntry(start, {
      cardId: 'base1-4', qty: 1, costValue: 50, costCurrency: 'EUR',
    }, rates, '2026-04-22');
    expect(next.entries[0].qty).toBe(2);
    expect(next.entries[0].costValue).toBeCloseTo(143, 1);
    expect(next.entries[0].costCurrency).toBe('GBP');  // existing currency wins
  });
});

describe('removeEntry', () => {
  it('removes the entry by cardId', () => {
    const start = {
      version: 1 as const,
      entries: [
        { cardId: 'a', qty: 1, costValue: 10, costCurrency: 'GBP' as const, addedAt: '2026-04-22' },
        { cardId: 'b', qty: 2, costValue: 20, costCurrency: 'GBP' as const, addedAt: '2026-04-22' },
      ],
    };
    const next = removeEntry(start, 'a');
    expect(next.entries).toEqual([start.entries[1]]);
  });

  it('is a no-op when cardId absent', () => {
    const start = {
      version: 1 as const,
      entries: [{ cardId: 'a', qty: 1, costValue: 10, costCurrency: 'GBP' as const, addedAt: '2026-04-22' }],
    };
    expect(removeEntry(start, 'missing')).toEqual(start);
  });
});

describe('updateEntry', () => {
  it('writes qty and cost in place', () => {
    const start = {
      version: 1 as const,
      entries: [{ cardId: 'a', qty: 1, costValue: 10, costCurrency: 'GBP' as const, addedAt: '2026-04-22' }],
    };
    const next = updateEntry(start, 'a', { qty: 5, costValue: 500 });
    expect(next.entries[0].qty).toBe(5);
    expect(next.entries[0].costValue).toBe(500);
    expect(next.entries[0].costCurrency).toBe('GBP');
    expect(next.entries[0].addedAt).toBe('2026-04-22');  // unchanged
  });

  it('rejects qty < 1 (caller must use removeEntry)', () => {
    const start = {
      version: 1 as const,
      entries: [{ cardId: 'a', qty: 1, costValue: 10, costCurrency: 'GBP' as const, addedAt: '2026-04-22' }],
    };
    expect(() => updateEntry(start, 'a', { qty: 0 })).toThrow(/qty/);
  });
});
