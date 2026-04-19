import { describe, it, expect } from 'vitest';
import { computeVolatility } from '@/data/volatility';

describe('computeVolatility', () => {
  it('returns unknown bucket when fewer than 7 points', () => {
    const r = computeVolatility([10, 11, 12, 11, 10, 11]);
    expect(r.bucket).toBe('unknown');
    expect(r.coefficient).toBeNull();
  });

  it('returns stable bucket when σ/μ < 3%', () => {
    // tiny variation around 100
    const r = computeVolatility([100, 101, 99, 100, 101, 100, 99, 100]);
    expect(r.bucket).toBe('stable');
    expect(r.coefficient!).toBeLessThan(0.03);
  });

  it('returns moderate bucket when σ/μ is 3-10%', () => {
    // ~7% variation around 100
    const r = computeVolatility([100, 107, 93, 105, 95, 102, 98, 104]);
    expect(r.bucket).toBe('moderate');
    expect(r.coefficient!).toBeGreaterThanOrEqual(0.03);
    expect(r.coefficient!).toBeLessThan(0.10);
  });

  it('returns volatile bucket when σ/μ >= 10%', () => {
    // ~25% variation around 100
    const r = computeVolatility([60, 100, 140, 80, 120, 90, 130, 110]);
    expect(r.bucket).toBe('volatile');
    expect(r.coefficient!).toBeGreaterThanOrEqual(0.10);
  });

  it('returns unknown when mean is zero (avoid division by zero)', () => {
    const r = computeVolatility([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.bucket).toBe('unknown');
    expect(r.coefficient).toBeNull();
  });
});
