import TCGdex from '@tcgdex/sdk';
import type { Language } from './schema';
import { SUPPORTED_LANGUAGES } from './schema';
import type { RawDumps } from './normalise';

// Our internal language codes align 1:1 with TCGdex's SDK codes except that we
// already use hyphenated forms (zh-tw, zh-cn). No transform needed.
function sdkLang(lang: Language): string {
  return lang;
}

export async function fetchAllLanguages(): Promise<RawDumps> {
  const entries = await Promise.all(
    SUPPORTED_LANGUAGES.map(async (lang) => {
      const tcgdex = new TCGdex(sdkLang(lang) as never);
      const summaries = await tcgdex.fetch('cards');
      const list = summaries ?? [];
      if (list.length === 0) {
        // TCGdex lists some languages that are currently empty (e.g., recently-added
        // regions with no data yet). That's a data-availability fact, not an outage.
        // We warn and continue; downstream guards (below) catch the real outages.
        console.warn(`fetchAllLanguages: ${lang} returned zero cards — skipping (data gap at source, not fetched as outage)`);
        return [lang, [] as unknown[]] as const;
      }
      const full = await Promise.all(list.map((s) => tcgdex.fetch('cards', s.id)));
      return [lang, full.filter((x): x is NonNullable<typeof x> => x !== null && x !== undefined)] as const;
    }),
  );

  const result = Object.fromEntries(entries) as unknown as RawDumps;

  // Fail loud on real outages:
  //   - EN empty (EN is the largest dataset; empty EN means TCGdex is down or API changed)
  //   - ALL languages empty (something systemic is broken)
  if ((result.en ?? []).length === 0) {
    throw new Error('fetchAllLanguages: English dump returned zero cards — treating as outage (EN is the largest dataset and should never be empty)');
  }
  const totalCards = Object.values(result).reduce((sum, cards) => sum + (cards?.length ?? 0), 0);
  if (totalCards === 0) {
    throw new Error('fetchAllLanguages: every language returned zero cards — certain outage');
  }

  return result;
}
