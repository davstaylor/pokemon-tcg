export type VolatilityBucket = 'stable' | 'moderate' | 'volatile' | 'unknown';
export type VolatilityResult = {
  bucket: VolatilityBucket;
  coefficient: number | null;
};

export function computeVolatility(trendSeries: number[]): VolatilityResult {
  if (trendSeries.length < 7) return { bucket: 'unknown', coefficient: null };
  const mean = trendSeries.reduce((a, b) => a + b, 0) / trendSeries.length;
  if (mean === 0) return { bucket: 'unknown', coefficient: null };
  const variance =
    trendSeries.reduce((acc, v) => acc + (v - mean) ** 2, 0) / trendSeries.length;
  const stddev = Math.sqrt(variance);
  const coefficient = stddev / mean;
  if (coefficient < 0.03) return { bucket: 'stable', coefficient };
  if (coefficient < 0.10) return { bucket: 'moderate', coefficient };
  return { bucket: 'volatile', coefficient };
}
