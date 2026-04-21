import { describe, it, expect } from 'vitest';
import {
  computeHotLists,
  HOT_LIST_SIZE,
  PCT_MIN_BASELINE_EUR,
} from '@/data/hot-cards';
import type { CardIdentity } from '@/data/schema';
import type { SparklineDump, Snapshot } from '@/data/history-schema';

// Minimal CardIdentity shape — the helper only reads `id`, `defaultName`,
// `filters.setName`, and `prints` (for the popup image). The computation
// path itself only touches `id`; everything else is passed through.
function makeCard(id: string, defaultName = id): CardIdentity {
  return {
    id,
    defaultName,
    prints: {},
    searchTokens: [],
    filters: { setId: 'test', setName: 'Test', rarity: 'C', types: [], series: 'test' },
  };
}

function snap(cardId: string, date: string, trend: number | null): Snapshot {
  return { cardId, date, trend, low: null, avg30: null, avg7: null, avg1: null };
}

function dump(records: Record<string, Snapshot[]>): SparklineDump {
  return { days: 30, cutoff: '2026-03-22', records };
}

describe('computeHotLists', () => {
  it('ranks pctRisers by deltaPct desc and slices to top 10', () => {
    const cards = Array.from({ length: 12 }, (_, i) => makeCard(`c${i}`, `Card ${i}`));
    // Each card has a baseline of €10 and a different delta. c0..c11 → +10% .. +120%.
    const records: Record<string, Snapshot[]> = {};
    for (let i = 0; i < 12; i++) {
      records[`c${i}`] = [
        snap(`c${i}`, '2026-04-14', 10),
        snap(`c${i}`, '2026-04-21', 10 + i + 1),
      ];
    }
    const out = computeHotLists(cards, dump(records), '7d');
    expect(out.pctRisers).toHaveLength(HOT_LIST_SIZE);
    // Top card is c11 (+120%), second is c10 (+110%).
    expect(out.pctRisers[0].card.id).toBe('c11');
    expect(out.pctRisers[1].card.id).toBe('c10');
    // deltaPct stored as decimal, not percent × 100.
    expect(out.pctRisers[0].deltaPct).toBeCloseTo(1.2);
  });

  it('ranks eurGainers by deltaEur desc regardless of sign', () => {
    const cards = [makeCard('big'), makeCard('small'), makeCard('neg')];
    const records: Record<string, Snapshot[]> = {
      big:   [snap('big',   '2026-04-14', 100), snap('big',   '2026-04-21', 150)], // +€50
      small: [snap('small', '2026-04-14',  10), snap('small', '2026-04-21',  14)], // +€4
      neg:   [snap('neg',   '2026-04-14',  50), snap('neg',   '2026-04-21',  40)], // -€10
    };
    const out = computeHotLists(cards, dump(records), '7d');
    expect(out.eurGainers.map((r) => r.card.id)).toEqual(['big', 'small']);
    expect(out.eurLosers.map((r) => r.card.id)).toEqual(['neg']);
  });

  it('ranks pctFallers by deltaPct asc (most-negative first)', () => {
    const cards = [makeCard('a'), makeCard('b'), makeCard('c')];
    const records: Record<string, Snapshot[]> = {
      a: [snap('a', '2026-04-14', 100), snap('a', '2026-04-21',  80)], // -20%
      b: [snap('b', '2026-04-14', 100), snap('b', '2026-04-21',  50)], // -50%
      c: [snap('c', '2026-04-14', 100), snap('c', '2026-04-21', 110)], // +10%
    };
    const out = computeHotLists(cards, dump(records), '7d');
    expect(out.pctFallers.map((r) => r.card.id)).toEqual(['b', 'a']);
  });

  it('skips cards whose oldest snapshot is newer than the window target', () => {
    // Card with 3 days of history can't appear in 7d or 30d lists.
    const cards = [makeCard('fresh'), makeCard('old')];
    const records: Record<string, Snapshot[]> = {
      fresh: [
        snap('fresh', '2026-04-19', 50),
        snap('fresh', '2026-04-20', 55),
        snap('fresh', '2026-04-21', 60),
      ],
      old: [
        snap('old', '2026-04-14', 50),
        snap('old', '2026-04-21', 60),
      ],
    };
    const out = computeHotLists(cards, dump(records), '7d');
    expect(out.pctRisers.map((r) => r.card.id)).toEqual(['old']);
    expect(out.eurGainers.map((r) => r.card.id)).toEqual(['old']);
  });

  it('excludes baselineEur < PCT_MIN_BASELINE_EUR from % lists, keeps them in € lists', () => {
    expect(PCT_MIN_BASELINE_EUR).toBe(1.0);
    const cards = [makeCard('penny'), makeCard('real')];
    const records: Record<string, Snapshot[]> = {
      // Penny stock: €0.50 → €2 (+300%, but €1.50 absolute — small).
      penny: [snap('penny', '2026-04-14', 0.5), snap('penny', '2026-04-21', 2)],
      // Real card: €100 → €110 (+10%, +€10).
      real:  [snap('real',  '2026-04-14', 100), snap('real',  '2026-04-21', 110)],
    };
    const out = computeHotLists(cards, dump(records), '7d');
    // Penny excluded from pctRisers despite biggest pct, real keeps its spot.
    expect(out.pctRisers.map((r) => r.card.id)).toEqual(['real']);
    // Both appear in eurGainers (no € floor); real out-ranks penny on absolute €.
    expect(out.eurGainers.map((r) => r.card.id)).toEqual(['real', 'penny']);
  });

  it('skips cards whose baseline trend is zero (division-by-zero guard)', () => {
    const cards = [makeCard('zero'), makeCard('ok')];
    const records: Record<string, Snapshot[]> = {
      zero: [snap('zero', '2026-04-14', 0), snap('zero', '2026-04-21', 10)],
      ok:   [snap('ok',   '2026-04-14', 5), snap('ok',   '2026-04-21', 15)],
    };
    const out = computeHotLists(cards, dump(records), '7d');
    expect(out.pctRisers.map((r) => r.card.id)).toEqual(['ok']);
    expect(out.eurGainers.map((r) => r.card.id)).toEqual(['ok']);
  });
});
