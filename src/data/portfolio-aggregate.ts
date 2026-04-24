import type { Snapshot, SparklineDump } from './history-schema';
import type { ExchangeRates, SupportedCurrency } from './currency-schema';
import type { PortfolioEntry } from './portfolio-schema';
import { convertBetween, convertFromEUR } from './currency';

export interface PortfolioSummary {
  cards: number;             // sum of qty
  uniqueCards: number;       // distinct cardIds
  paidInDisplay: number;
  valueInDisplay: number;
  pnlValue: number;          // valueInDisplay − paidInDisplay
  pnlPct: number;            // decimal, 0 when paid is 0
  unpriced: number;          // cards whose cardId has no history
}

export interface TrendPoint {
  date: string;              // YYYY-MM-DD
  valueInDisplay: number;
}

// Returns the last snapshot's trend for a card, or null if unavailable.
export function entryCurrentEur(entry: PortfolioEntry, dump: SparklineDump): number | null {
  const series = dump.records[entry.cardId];
  if (!series || series.length === 0) return null;
  const latest = series[series.length - 1];
  return latest.trend;
}

// Walks series (sorted oldest→newest) backwards, returns the most-recent
// snapshot with date ≤ target. Returns null if no such snapshot exists.
export function findSnapshotOnOrBefore(series: Snapshot[], targetIso: string): Snapshot | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= targetIso) return series[i];
  }
  return null;
}

export function computeSummary(
  entries: PortfolioEntry[],
  dump: SparklineDump,
  rates: ExchangeRates,
  display: SupportedCurrency,
): PortfolioSummary {
  let cards = 0;
  let paidInDisplay = 0;
  let valueInDisplay = 0;
  let unpriced = 0;

  for (const e of entries) {
    cards += e.qty;
    paidInDisplay += convertBetween(e.costValue, e.costCurrency, display, rates);
    const curEur = entryCurrentEur(e, dump);
    if (curEur === null) {
      unpriced++;
      continue;
    }
    const converted = convertFromEUR(curEur, display, rates);
    if (converted !== null) valueInDisplay += e.qty * converted;
  }

  return {
    cards,
    uniqueCards: entries.length,
    paidInDisplay,
    valueInDisplay,
    pnlValue: valueInDisplay - paidInDisplay,
    pnlPct: paidInDisplay > 0 ? (valueInDisplay - paidInDisplay) / paidInDisplay : 0,
    unpriced,
  };
}

export function computeTrendSeries(
  entries: PortfolioEntry[],
  dump: SparklineDump,
  rates: ExchangeRates,
  display: SupportedCurrency,
): TrendPoint[] {
  // Collect every distinct date across all owned cards' series.
  const dateSet = new Set<string>();
  for (const e of entries) {
    const series = dump.records[e.cardId] ?? [];
    for (const s of series) if (s.trend !== null) dateSet.add(s.date);
  }
  const dates = [...dateSet].sort();

  return dates.map((date) => {
    let totalEur = 0;
    for (const e of entries) {
      const series = dump.records[e.cardId] ?? [];
      const snap = findSnapshotOnOrBefore(series, date);
      if (snap !== null && snap.trend !== null) totalEur += e.qty * snap.trend;
    }
    const converted = convertFromEUR(totalEur, display, rates) ?? 0;
    return { date, valueInDisplay: converted };
  });
}
