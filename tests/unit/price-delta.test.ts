import { describe, it, expect } from 'vitest';
import { trendVsAvg30 } from '@/data/price-delta';

describe('trendVsAvg30', () => {
  it('returns positive delta when trend is above the 30-day average', () => {
    const r = trendVsAvg30({ trend: 440, avg30: 400 })!;
    expect(r.absolute).toBe(40);
    expect(r.percent).toBe(10);
    expect(r.direction).toBe('up');
  });

  it('returns negative delta when trend is below the 30-day average', () => {
    const r = trendVsAvg30({ trend: 359.17, avg30: 409.46 })!;
    expect(r.absolute).toBeCloseTo(-50.29, 2);
    expect(r.percent).toBeCloseTo(-12.28, 2);
    expect(r.direction).toBe('down');
  });

  it('returns flat direction when delta is zero', () => {
    const r = trendVsAvg30({ trend: 100, avg30: 100 })!;
    expect(r.direction).toBe('flat');
  });

  it('returns null when either input is null', () => {
    expect(trendVsAvg30({ trend: null, avg30: 400 })).toBeNull();
    expect(trendVsAvg30({ trend: 400, avg30: null })).toBeNull();
    expect(trendVsAvg30({ trend: null, avg30: null })).toBeNull();
  });

  it('returns null when avg30 is zero (avoid division by zero)', () => {
    expect(trendVsAvg30({ trend: 10, avg30: 0 })).toBeNull();
  });
});
