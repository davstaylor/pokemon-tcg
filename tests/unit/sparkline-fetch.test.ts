// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  fetchSparklineWithCache,
  SPARKLINE_CACHE_KEY,
  SPARKLINE_CACHE_TTL_MS,
  SPARKLINE_URL,
} from '@/data/sparkline-fetch';

const fixture = {
  days: 30,
  cutoff: '2026-03-22',
  records: {
    'a': [
      { cardId: 'a', date: '2026-04-22', trend: 50, low: null, avg30: null, avg7: null, avg1: null },
    ],
  },
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-22T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fetchSparklineWithCache', () => {
  it('fetches + caches when no cache exists', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture)));
    const result = await fetchSparklineWithCache();
    expect(spy).toHaveBeenCalledWith(SPARKLINE_URL);
    expect(result).toEqual(fixture);
    const cached = JSON.parse(localStorage.getItem(SPARKLINE_CACHE_KEY)!);
    expect(cached.data).toEqual(fixture);
    expect(cached.at).toBe(Date.now());
  });

  it('uses cache when fresh (< TTL)', async () => {
    localStorage.setItem(SPARKLINE_CACHE_KEY, JSON.stringify({ at: Date.now() - 1000, data: fixture }));
    const spy = vi.spyOn(global, 'fetch');
    const result = await fetchSparklineWithCache();
    expect(spy).not.toHaveBeenCalled();
    expect(result).toEqual(fixture);
  });

  it('re-fetches when cache is stale (> TTL)', async () => {
    localStorage.setItem(SPARKLINE_CACHE_KEY, JSON.stringify({
      at: Date.now() - SPARKLINE_CACHE_TTL_MS - 1000,
      data: fixture,
    }));
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture)));
    await fetchSparklineWithCache();
    expect(spy).toHaveBeenCalled();
  });

  it('re-fetches when cached data fails Zod validation', async () => {
    localStorage.setItem(SPARKLINE_CACHE_KEY, JSON.stringify({ at: Date.now(), data: { not: 'valid' } }));
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture)));
    const result = await fetchSparklineWithCache();
    expect(spy).toHaveBeenCalled();
    expect(result).toEqual(fixture);
  });

  it('throws when fetch responds non-OK', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('oops', { status: 500 }));
    await expect(fetchSparklineWithCache()).rejects.toThrow(/500/);
  });
});
