import type { CardPriceRecord, PriceFile } from './price-schema';

export function mergePrices(baseline: PriceFile, fresh: PriceFile): Record<string, CardPriceRecord> {
  return { ...baseline.records, ...fresh.records };
}
