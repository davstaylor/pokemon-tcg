import type { CardIdentity } from './schema';
import type { SparklineDump, Snapshot } from './history-schema';

// ---- Public types ----

export type HotWindow = '24h' | '7d' | '30d';
export const HOT_WINDOWS: HotWindow[] = ['24h', '7d', '30d'];
export const WINDOW_DAYS: Record<HotWindow, number> = { '24h': 1, '7d': 7, '30d': 30 };

// Human label for the chosen window — used in page titles, descriptions,
// and the hover popup.
export const WINDOW_LABEL: Record<HotWindow, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

// How many rows each section shows.
export const HOT_LIST_SIZE = 10;

// The % rankings filter out cards whose baseline trend is below this value.
// Penny-stock movers (a €0.10 card doubling to €0.20) dominate a raw
// percentage ranking without adding useful signal.
export const PCT_MIN_BASELINE_EUR = 1.0;

export interface HotRow {
  card: CardIdentity;
  currentEur: number;
  baselineEur: number;
  deltaEur: number;
  deltaPct: number;       // stored as a decimal (0.54 = +54%)
  history: number[];      // trend values, oldest → newest, for the popup sparkline
}

export interface HotLists {
  pctRisers: HotRow[];
  pctFallers: HotRow[];
  eurGainers: HotRow[];
  eurLosers: HotRow[];
}

// ---- Internal helpers ----

// Subtract N days from an ISO date string (YYYY-MM-DD).
function isoDateMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Given a date-sorted snapshot series and an ISO target date, find the
// most-recent snapshot whose date is ≤ target. Returns null if no such
// snapshot exists (i.e. the card's oldest data point is newer than target).
function pickBaseline(series: Snapshot[], targetIso: string): Snapshot | null {
  // series is sorted oldest → newest, so walk backwards to find the first
  // date ≤ target.
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= targetIso) return series[i];
  }
  return null;
}

// Build a HotRow for a card if it has enough history in the window; return
// null to signal "skip this card for this window".
function buildRow(card: CardIdentity, series: Snapshot[], window: HotWindow): HotRow | null {
  if (series.length === 0) return null;

  const latest = series[series.length - 1];
  const currentEur = latest.trend;
  if (currentEur === null || currentEur === 0) return null;

  const target = isoDateMinusDays(latest.date, WINDOW_DAYS[window]);
  const base = pickBaseline(series, target);
  if (base === null) return null;
  const baselineEur = base.trend;
  if (baselineEur === null || baselineEur === 0) return null;

  const deltaEur = currentEur - baselineEur;
  const deltaPct = deltaEur / baselineEur;

  const history = series
    .map((s) => s.trend)
    .filter((v): v is number => v !== null);

  return { card, currentEur, baselineEur, deltaEur, deltaPct, history };
}

// ---- Core entry point ----

export function computeHotLists(
  cards: CardIdentity[],
  sparkline: SparklineDump,
  window: HotWindow,
): HotLists {
  const rows: HotRow[] = [];
  for (const card of cards) {
    const series = sparkline.records[card.id];
    if (!series) continue;
    const row = buildRow(card, series, window);
    if (row !== null) rows.push(row);
  }

  // Full lists first (€ lists include all rows; % lists apply the floor).
  const forPct = rows.filter((r) => r.baselineEur >= PCT_MIN_BASELINE_EUR);

  const pctRisers = [...forPct]
    .sort((a, b) => b.deltaPct - a.deltaPct)
    .filter((r) => r.deltaEur > 0)
    .slice(0, HOT_LIST_SIZE);
  const pctFallers = [...forPct]
    .sort((a, b) => a.deltaPct - b.deltaPct)
    .filter((r) => r.deltaEur < 0)
    .slice(0, HOT_LIST_SIZE);
  const eurGainers = [...rows]
    .sort((a, b) => b.deltaEur - a.deltaEur)
    .filter((r) => r.deltaEur > 0)
    .slice(0, HOT_LIST_SIZE);
  const eurLosers = [...rows]
    .sort((a, b) => a.deltaEur - b.deltaEur)
    .filter((r) => r.deltaEur < 0)
    .slice(0, HOT_LIST_SIZE);

  return { pctRisers, pctFallers, eurGainers, eurLosers };
}
