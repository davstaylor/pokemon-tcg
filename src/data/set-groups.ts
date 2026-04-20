import type { CardIdentity } from './schema';
import { SUPPORTED_LANGUAGES } from './schema';
import { compareLocalIds } from './set-sort';

// ---- Public types ----

export interface SetSummary {
  setId: string;
  setName: string;    // from filters.setName, or empty string fallback
  setSymbol: string;  // from first available print, '' if none
  releaseDate: string; // ISO date, '' if none
  seriesId: string;
  cardCount: number;
}

export interface SeriesSummary {
  seriesId: string;
  seriesName: string;   // derived: earliest-released set's setName
  setCount: number;
  cardCount: number;
  sets: SetSummary[];   // sorted newest-first by releaseDate
}

export interface SetPageData extends SetSummary {
  seriesName: string;
  cards: CardIdentity[]; // sorted by numeric-aware compareLocalIds on localId
}

// ---- Helpers ----

// Cards are "{setId}-{localId}", e.g. "base1-4" or "swsh12-TG01".
// Strip the known setId prefix to isolate the localId segment.
export function extractLocalId(cardId: string, setId: string): string {
  const prefix = `${setId}-`;
  return cardId.startsWith(prefix) ? cardId.slice(prefix.length) : cardId;
}

// setSymbol and releaseDate come from the first available print, preferring EN
// (TCGdex's canonical language). Falls back to the language-priority order
// defined in SUPPORTED_LANGUAGES. Returns empty strings if no print has data
// (shouldn't happen under PrintsSchema's "at least one print" refine, but
// defensive).
function pickSetMeta(card: CardIdentity): { setSymbol: string; releaseDate: string } {
  for (const lang of SUPPORTED_LANGUAGES) {
    const p = card.prints[lang];
    if (p) return { setSymbol: p.setSymbol, releaseDate: p.releaseDate };
  }
  return { setSymbol: '', releaseDate: '' };
}

// ---- Core groupings ----

export function groupCardsBySet(cards: CardIdentity[]): Map<string, SetPageData> {
  // First pass: bucket cards by setId, capturing set-level metadata from the
  // first card we see in each set.
  interface WorkingSet {
    cards: CardIdentity[];
    setName: string;
    seriesId: string;
    setSymbol: string;
    releaseDate: string;
  }
  const working = new Map<string, WorkingSet>();

  for (const card of cards) {
    const setId = card.filters.setId;
    let group = working.get(setId);
    if (!group) {
      const { setSymbol, releaseDate } = pickSetMeta(card);
      group = {
        cards: [],
        setName: card.filters.setName,
        seriesId: card.filters.series,
        setSymbol,
        releaseDate,
      };
      working.set(setId, group);
    }
    group.cards.push(card);
  }

  // Build series-name lookup: for each seriesId, the earliest-released set's
  // setName wins. Ties on releaseDate fall through to first-seen (Map insertion
  // order), which is deterministic given the stable input.
  const seriesNames = new Map<string, { name: string; releaseDate: string }>();
  for (const g of working.values()) {
    const existing = seriesNames.get(g.seriesId);
    if (!existing || (g.releaseDate && g.releaseDate < existing.releaseDate)) {
      seriesNames.set(g.seriesId, { name: g.setName || g.seriesId, releaseDate: g.releaseDate });
    }
  }

  // Second pass: sort cards within each set; emit final SetPageData.
  const result = new Map<string, SetPageData>();
  for (const [setId, g] of working) {
    const sortedCards = [...g.cards].sort((a, b) =>
      compareLocalIds(extractLocalId(a.id, setId), extractLocalId(b.id, setId)),
    );
    result.set(setId, {
      setId,
      setName: g.setName,
      setSymbol: g.setSymbol,
      releaseDate: g.releaseDate,
      seriesId: g.seriesId,
      seriesName: seriesNames.get(g.seriesId)?.name ?? g.seriesId,
      cardCount: sortedCards.length,
      cards: sortedCards,
    });
  }

  return result;
}

export function groupSetsBySeries(cards: CardIdentity[]): Map<string, SeriesSummary> {
  const bySet = groupCardsBySet(cards);

  // Regroup the sets under their series.
  interface WorkingSeries { seriesName: string; sets: SetSummary[] }
  const working = new Map<string, WorkingSeries>();

  for (const data of bySet.values()) {
    let group = working.get(data.seriesId);
    if (!group) {
      group = { seriesName: data.seriesName, sets: [] };
      working.set(data.seriesId, group);
    }
    group.sets.push({
      setId: data.setId,
      setName: data.setName,
      setSymbol: data.setSymbol,
      releaseDate: data.releaseDate,
      seriesId: data.seriesId,
      cardCount: data.cardCount,
    });
  }

  // Sort sets within each series newest-first (descending releaseDate).
  // Empty releaseDate sorts last under string-descending comparison.
  const result = new Map<string, SeriesSummary>();
  for (const [seriesId, g] of working) {
    const sortedSets = [...g.sets].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
    result.set(seriesId, {
      seriesId,
      seriesName: g.seriesName,
      setCount: sortedSets.length,
      cardCount: sortedSets.reduce((acc, s) => acc + s.cardCount, 0),
      sets: sortedSets,
    });
  }

  return result;
}
