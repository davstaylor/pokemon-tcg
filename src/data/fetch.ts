import pLimit from 'p-limit';
import TCGdex from '@tcgdex/sdk';
import type { Language } from './schema';
import { SUPPORTED_LANGUAGES } from './schema';
import type { RawDumps } from './normalise';

// Concurrency for the EN per-card detail fetch loop. TCGdex is a free public
// API; 20 parallel requests is a conservative starting point. If nightly runs
// show zero 429s over a week, this can be bumped. If we see 429s, drop to 10
// and add retry-with-backoff.
const CONCURRENCY = 20;

// If more than this fraction of EN per-card detail fetches fail, we assume a
// systemic issue (rate limit, outage, auth) and abort rather than shipping a
// degraded catalog. 5% of 23k is ~1,158 — well above normal transient noise.
const EN_FAILURE_ABORT_THRESHOLD = 0.05;

export async function fetchAllLanguages(): Promise<RawDumps> {
  // ---- English: per-card detail (for pricing and canonical fields) ----
  const enTcgdex = new TCGdex('en' as never);
  const enSummaries = await enTcgdex.fetch('cards');
  if (!enSummaries || enSummaries.length === 0) {
    throw new Error('fetchAllLanguages: EN summary list returned zero cards — treating as outage');
  }

  console.log(`Fetching EN detail for ${enSummaries.length} cards (concurrency ${CONCURRENCY})...`);
  const limit = pLimit(CONCURRENCY);
  let enFailures = 0;
  const enResults = await Promise.all(
    enSummaries.map((s) =>
      limit(async () => {
        try {
          return await enTcgdex.fetch('cards', s.id);
        } catch (err) {
          enFailures++;
          console.warn(`EN fetch failed for ${s.id}: ${(err as Error).message}`);
          return null;
        }
      }),
    ),
  );

  const enFailureRate = enFailures / enSummaries.length;
  if (enFailureRate > EN_FAILURE_ABORT_THRESHOLD) {
    throw new Error(
      `fetchAllLanguages: ${enFailures}/${enSummaries.length} EN detail fetches failed (${(enFailureRate * 100).toFixed(1)}%) — aborting`,
    );
  }
  const enCards = enResults.filter((c): c is NonNullable<typeof c> => c !== null && c !== undefined);
  console.log(`EN: ${enCards.length} cards fetched successfully (${enFailures} skipped)`);

  // ---- Non-EN populated languages: summary list only (id, localId, name, image) ----
  const otherLangs = SUPPORTED_LANGUAGES.filter((l): l is Exclude<Language, 'en'> => l !== 'en');
  const otherEntries = await Promise.all(
    otherLangs.map(async (lang) => {
      const langTcgdex = new TCGdex(lang as never);
      const summaries = await langTcgdex.fetch('cards');
      if (!summaries || summaries.length === 0) {
        console.warn(`${lang}: zero cards — data gap at source, not fetched as outage`);
        return [lang, [] as unknown[]] as const;
      }
      console.log(`${lang}: ${summaries.length} summaries fetched`);
      return [lang, summaries] as const;
    }),
  );

  const result = { en: enCards, ...Object.fromEntries(otherEntries) } as unknown as RawDumps;

  // Fail loud if every language is empty — systemic outage.
  const totalCards = Object.values(result).reduce((sum, cards) => sum + (cards?.length ?? 0), 0);
  if (totalCards === 0) {
    throw new Error('fetchAllLanguages: every language returned zero cards — certain outage');
  }

  return result;
}
