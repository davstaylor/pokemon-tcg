import type { CardIdentity, Language } from './schema';

export interface CardIndexEntry {
  name: string;        // card.defaultName
  setName: string;     // card.filters.setName (blank-safe)
  thumbUrl: string;    // preferred-language imageURL, or ''
}

export type CardIndex = Record<string, CardIndexEntry>;

// Language preference for the thumbnail — EN first, then JA, then European,
// then Asian. Same pattern used by HotSection.astro and the card page.
const LANG_ORDER_FOR_THUMB: Language[] = [
  'en', 'ja', 'fr', 'de', 'it', 'es', 'pt', 'zh-tw', 'zh-cn', 'th', 'id',
];

function pickThumbUrl(card: CardIdentity): string {
  for (const lang of LANG_ORDER_FOR_THUMB) {
    const p = card.prints[lang];
    if (p && p.imageURL) return p.imageURL;
  }
  return '';
}

export function buildCardIndex(cards: CardIdentity[]): CardIndex {
  const index: CardIndex = {};
  for (const card of cards) {
    index[card.id] = {
      name: card.defaultName,
      setName: card.filters.setName ?? '',
      thumbUrl: pickThumbUrl(card),
    };
  }
  return index;
}
