import TCGdex from '@tcgdex/sdk';
import type { Language } from './schema';
import { SUPPORTED_LANGUAGES } from './schema';
import type { RawDumps } from './normalise';

const SDK_LANG_MAP: Record<Language, string> = {
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  zh: 'zh-tw',
};

export async function fetchAllLanguages(): Promise<RawDumps> {
  const entries = await Promise.all(
    SUPPORTED_LANGUAGES.map(async (lang) => {
      const tcgdex = new TCGdex(SDK_LANG_MAP[lang] as never);
      const summaries = await tcgdex.fetch('cards');
      if (!summaries || summaries.length === 0) {
        throw new Error(`fetchAllLanguages: ${lang} returned zero cards (API outage or schema drift?)`);
      }
      const full = await Promise.all(summaries.map((s) => tcgdex.fetch('cards', s.id)));
      return [lang, full.filter((x): x is NonNullable<typeof x> => x !== undefined)] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as RawDumps;
}
