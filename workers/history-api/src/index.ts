export interface Env {
  DB: D1Database;
}

type SnapshotRow = {
  cardId: string;
  date: string;
  trend: number | null;
  low: number | null;
  avg30: number | null;
  avg7: number | null;
  avg1: number | null;
};

const JSON_CORS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

function parseDaysParam(url: URL, defaultDays: number, maxDays: number): number {
  const raw = url.searchParams.get('days');
  const parsed = raw ? Number(raw) : defaultDays;
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultDays;
  return Math.min(parsed, maxDays);
}

function cutoffDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

async function handleSingleCard(cardId: string, days: number, env: Env): Promise<Response> {
  const cutoff = cutoffDate(days);
  const stmt = env.DB.prepare(
    'SELECT cardId, date, trend, low, avg30, avg7, avg1 FROM snapshots WHERE cardId = ? AND date >= ? ORDER BY date DESC',
  ).bind(cardId, cutoff);
  const { results } = await stmt.all<SnapshotRow>();
  return new Response(
    JSON.stringify({ cardId, days, cutoff, snapshots: results ?? [] }),
    { status: 200, headers: JSON_CORS },
  );
}

async function handleSparklineDump(days: number, env: Env): Promise<Response> {
  const cutoff = cutoffDate(days);
  const stmt = env.DB.prepare(
    'SELECT cardId, date, trend, low, avg30, avg7, avg1 FROM snapshots WHERE date >= ? ORDER BY cardId, date DESC',
  ).bind(cutoff);
  const { results } = await stmt.all<SnapshotRow>();
  const records: Record<string, SnapshotRow[]> = {};
  for (const row of results ?? []) {
    (records[row.cardId] ??= []).push(row);
  }
  return new Response(
    JSON.stringify({ days, cutoff, records }),
    { status: 200, headers: JSON_CORS },
  );
}

async function handleRangeDump(days: number, env: Env): Promise<Response> {
  const cutoff = cutoffDate(days);
  // Pre-aggregate in SQL for a much smaller payload.
  const stmt = env.DB.prepare(`
    SELECT
      cardId,
      MIN(trend) AS low,
      MAX(trend) AS high,
      (SELECT trend FROM snapshots s2 WHERE s2.cardId = snapshots.cardId ORDER BY date DESC LIMIT 1) AS latest
    FROM snapshots
    WHERE date >= ? AND trend IS NOT NULL
    GROUP BY cardId
  `).bind(cutoff);
  const { results } = await stmt.all<{ cardId: string; low: number | null; high: number | null; latest: number | null }>();
  const records: Record<string, { low: number | null; high: number | null; latest: number | null }> = {};
  for (const row of results ?? []) {
    records[row.cardId] = { low: row.low, high: row.high, latest: row.latest };
  }
  return new Response(
    JSON.stringify({ days, cutoff, records }),
    { status: 200, headers: JSON_CORS },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_CORS });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.startsWith('/history/')) {
      const cardId = decodeURIComponent(pathname.slice('/history/'.length));
      const days = parseDaysParam(url, 90, 365);
      return handleSingleCard(cardId, days, env);
    }
    if (pathname === '/sparkline-dump') {
      const days = parseDaysParam(url, 30, 90);
      return handleSparklineDump(days, env);
    }
    if (pathname === '/range-dump') {
      const days = parseDaysParam(url, 90, 365);
      return handleRangeDump(days, env);
    }
    return new Response('not found', { status: 404 });
  },
};
