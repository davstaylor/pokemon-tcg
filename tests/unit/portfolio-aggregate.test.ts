import { describe, it, expect } from 'vitest';
import {
  computeSummary,
  computeTrendSeries,
  entryCurrentEur,
  findSnapshotOnOrBefore,
} from '@/data/portfolio-aggregate';
import type { PortfolioEntry } from '@/data/portfolio-schema';
import type { SparklineDump, Snapshot } from '@/data/history-schema';
import type { ExchangeRates } from '@/data/currency-schema';

const rates: ExchangeRates = {
  base: 'EUR',
  date: '2026-04-22',
  rates: { USD: 1.08, GBP: 0.86, JPY: 162.0 },
};

function snap(cardId: string, date: string, trend: number | null): Snapshot {
  return { cardId, date, trend, low: null, avg30: null, avg7: null, avg1: null };
}
function dump(records: Record<string, Snapshot[]>): SparklineDump {
  return { days: 30, cutoff: '2026-03-22', records };
}
function entry(partial: Partial<PortfolioEntry> & { cardId: string }): PortfolioEntry {
  return {
    qty: 1, costValue: 0, costCurrency: 'GBP', addedAt: '2026-04-22',
    ...partial,
  };
}

describe('entryCurrentEur', () => {
  it('returns the last snapshot trend for a present card', () => {
    const d = dump({ a: [snap('a', '2026-04-21', 50), snap('a', '2026-04-22', 60)] });
    expect(entryCurrentEur(entry({ cardId: 'a' }), d)).toBe(60);
  });

  it('returns null for missing card', () => {
    const d = dump({});
    expect(entryCurrentEur(entry({ cardId: 'missing' }), d)).toBe(null);
  });

  it('returns null when latest trend is null', () => {
    const d = dump({ a: [snap('a', '2026-04-22', null)] });
    expect(entryCurrentEur(entry({ cardId: 'a' }), d)).toBe(null);
  });
});

describe('computeSummary', () => {
  it('returns all zeros on empty entries', () => {
    const s = computeSummary([], dump({}), rates, 'GBP');
    expect(s).toEqual({
      cards: 0, uniqueCards: 0, paidInDisplay: 0, valueInDisplay: 0,
      pnlValue: 0, pnlPct: 0, unpriced: 0,
    });
  });

  it('sums qty and converts mixed-currency costs to display', () => {
    const entries = [
      entry({ cardId: 'a', qty: 2, costValue: 100, costCurrency: 'GBP' }),
      entry({ cardId: 'b', qty: 1, costValue: 50, costCurrency: 'EUR' }),
    ];
    const d = dump({
      a: [snap('a', '2026-04-22', 70)],    // €70 each
      b: [snap('b', '2026-04-22', 30)],    // €30 each
    });
    const s = computeSummary(entries, d, rates, 'GBP');
    expect(s.cards).toBe(3);
    expect(s.uniqueCards).toBe(2);
    // paid = £100 + (€50 → £43) = £143
    expect(s.paidInDisplay).toBeCloseTo(143, 1);
    // value = (2 × €70 + 1 × €30) × 0.86 = €170 × 0.86 = £146.20
    expect(s.valueInDisplay).toBeCloseTo(146.2, 1);
    expect(s.pnlValue).toBeCloseTo(146.2 - 143, 1);
    expect(s.pnlPct).toBeCloseTo((146.2 - 143) / 143, 3);
    expect(s.unpriced).toBe(0);
  });

  it('counts unpriced cards but excludes them from value', () => {
    const entries = [
      entry({ cardId: 'a', qty: 1, costValue: 100, costCurrency: 'GBP' }),
      entry({ cardId: 'ghost', qty: 1, costValue: 50, costCurrency: 'GBP' }),
    ];
    const d = dump({ a: [snap('a', '2026-04-22', 70)] });  // no 'ghost'
    const s = computeSummary(entries, d, rates, 'GBP');
    expect(s.unpriced).toBe(1);
    // cost still includes ghost
    expect(s.paidInDisplay).toBeCloseTo(150, 1);
    // value = 1 × €70 × 0.86 = £60.20
    expect(s.valueInDisplay).toBeCloseTo(60.2, 1);
  });

  it('pnlPct is 0 when paid is 0 (no divide-by-zero)', () => {
    const entries = [entry({ cardId: 'a', qty: 1, costValue: 0, costCurrency: 'GBP' })];
    const d = dump({ a: [snap('a', '2026-04-22', 50)] });
    const s = computeSummary(entries, d, rates, 'GBP');
    expect(s.pnlPct).toBe(0);
  });
});

describe('findSnapshotOnOrBefore', () => {
  it('returns the most-recent snapshot with date ≤ target', () => {
    const series = [snap('a', '2026-04-10', 10), snap('a', '2026-04-15', 20), snap('a', '2026-04-22', 30)];
    expect(findSnapshotOnOrBefore(series, '2026-04-22')?.trend).toBe(30);
    expect(findSnapshotOnOrBefore(series, '2026-04-16')?.trend).toBe(20);
    expect(findSnapshotOnOrBefore(series, '2026-04-09')).toBe(null);
  });
});

describe('computeTrendSeries', () => {
  it('returns empty array on empty portfolio', () => {
    expect(computeTrendSeries([], dump({}), rates, 'GBP')).toEqual([]);
  });

  it('sums qty × trend per distinct date, forward-filling gaps, in display currency', () => {
    const entries = [
      entry({ cardId: 'a', qty: 2 }),
      entry({ cardId: 'b', qty: 1 }),
    ];
    const d = dump({
      a: [snap('a', '2026-04-20', 10), snap('a', '2026-04-22', 12)],
      b: [snap('b', '2026-04-21', 20)],
    });
    const series = computeTrendSeries(entries, d, rates, 'EUR');
    expect(series.map((p) => p.date)).toEqual(['2026-04-20', '2026-04-21', '2026-04-22']);
    // 2026-04-20: a=10 × 2, b missing → total €20
    // 2026-04-21: a=10 (fwd-fill) × 2, b=20 × 1 → total €40
    // 2026-04-22: a=12 × 2, b=20 (fwd-fill) × 1 → total €44
    expect(series[0].valueInDisplay).toBeCloseTo(20, 3);
    expect(series[1].valueInDisplay).toBeCloseTo(40, 3);
    expect(series[2].valueInDisplay).toBeCloseTo(44, 3);
  });
});
