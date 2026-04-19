import type { CardPriceRecord } from './price-schema';

// Partial shape of TCGdex's raw card response — only the fields we need.
type RawCardWithPricing = {
  id: string;
  pricing?: {
    cardmarket?: {
      updated: string;
      unit: string;
      trend?: number | null;
      low?: number | null;
      avg30?: number | null;
      avg7?: number | null;
      avg1?: number | null;
    } | null;
    tcgplayer?: unknown | null;
  };
};

export function extractPrices(cards: RawCardWithPricing[]): CardPriceRecord[] {
  const out: CardPriceRecord[] = [];
  for (const card of cards) {
    const cm = card.pricing?.cardmarket;
    if (!cm) continue;
    if (cm.unit !== 'EUR' && cm.unit !== 'USD') {
      // Fail loud — we only support EUR / USD. If Cardmarket returns something
      // else, Zod validation downstream would catch it; this guard is explicit.
      throw new Error(`extractPrices: unexpected currency "${cm.unit}" for card ${card.id}`);
    }
    out.push({
      cardId: card.id,
      sources: {
        cardmarket: {
          source: 'cardmarket',
          unit: cm.unit,
          trend: cm.trend ?? null,
          low: cm.low ?? null,
          avg30: cm.avg30 ?? null,
          avg7: cm.avg7 ?? null,
          avg1: cm.avg1 ?? null,
          updatedAt: cm.updated,
        },
      },
    });
  }
  return out;
}
