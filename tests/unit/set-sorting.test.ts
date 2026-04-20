import { describe, it, expect } from 'vitest';
import { compareLocalIds } from '@/data/set-sort';

describe('compareLocalIds', () => {
  it('sorts pure numeric ascending (2 before 10 before 100)', () => {
    const ids = ['100', '2', '10'];
    expect([...ids].sort(compareLocalIds)).toEqual(['2', '10', '100']);
  });

  it('places pure numeric before any alpha id', () => {
    const ids = ['TG1', '4', 'SWSH01', '10'];
    expect([...ids].sort(compareLocalIds)).toEqual(['4', '10', 'SWSH01', 'TG1']);
  });

  it('sorts alpha ids lexicographically (SWSH01 before SWSH02)', () => {
    const ids = ['SWSH02', 'SWSH01', 'SWSH10'];
    expect([...ids].sort(compareLocalIds)).toEqual(['SWSH01', 'SWSH02', 'SWSH10']);
  });

  it('returns 0 for equal ids (tied values stay put under a stable sort)', () => {
    expect(compareLocalIds('4', '4')).toBe(0);
    expect(compareLocalIds('H1', 'H1')).toBe(0);
  });

  it('does not treat "007" as numeric — String(7) !== "007" — so it sorts alpha', () => {
    // "007" -> parseInt gives 7, but String(7) is "7" which doesn't equal "007",
    // so it's treated as alpha. That's acceptable: leading-zero ids are rare and
    // behave consistently (all alpha-sorted together).
    const ids = ['007', '7', '10'];
    const sorted = [...ids].sort(compareLocalIds);
    // 7 and 10 are numeric and come first; "007" is alpha and comes last.
    expect(sorted).toEqual(['7', '10', '007']);
  });
});
