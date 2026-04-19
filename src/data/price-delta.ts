export type DeltaDirection = 'up' | 'down' | 'flat';
export type Delta = {
  absolute: number;
  percent: number;  // rounded to 2 decimal places
  direction: DeltaDirection;
};

export function trendVsAvg30({ trend, avg30 }: { trend: number | null; avg30: number | null }): Delta | null {
  if (trend === null || avg30 === null || avg30 === 0) return null;
  const absolute = trend - avg30;
  const percent = Math.round((absolute / avg30) * 10000) / 100;
  const direction: DeltaDirection = absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat';
  return { absolute, percent, direction };
}
