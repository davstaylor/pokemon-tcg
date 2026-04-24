import { SparklineDumpSchema, type SparklineDump } from './history-schema';

export const SPARKLINE_URL =
  'https://pokemon-tcg-history-api.david-taylor-pokemon.workers.dev/sparkline-dump';
export const SPARKLINE_CACHE_KEY = 'pokemon-tcg:sparkline-cache';
export const SPARKLINE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEnvelope {
  at: number;
  data: unknown;
}

export async function fetchSparklineWithCache(): Promise<SparklineDump> {
  // Try cache first.
  try {
    const raw = localStorage.getItem(SPARKLINE_CACHE_KEY);
    if (raw !== null) {
      const env = JSON.parse(raw) as CacheEnvelope;
      if (typeof env.at === 'number' && Date.now() - env.at < SPARKLINE_CACHE_TTL_MS) {
        return SparklineDumpSchema.parse(env.data);
      }
    }
  } catch {
    // Fall through and re-fetch.
  }

  const res = await fetch(SPARKLINE_URL);
  if (!res.ok) throw new Error(`Sparkline dump fetch failed: ${res.status}`);
  const raw = await res.json();
  const dump = SparklineDumpSchema.parse(raw);

  try {
    const envelope: CacheEnvelope = { at: Date.now(), data: dump };
    localStorage.setItem(SPARKLINE_CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Quota exceeded or localStorage disabled — tolerate, return fresh data.
  }

  return dump;
}
