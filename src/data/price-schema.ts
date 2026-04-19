import { z } from 'zod';

export const PRICE_SOURCES = ['cardmarket'] as const;
// v2.1 will extend: ['cardmarket', 'ebay']
export type PriceSource = typeof PRICE_SOURCES[number];

export const CURRENCIES = ['EUR', 'USD'] as const;
export type Currency = typeof CURRENCIES[number];

export const CardMarketPriceSchema = z.object({
  source: z.literal('cardmarket'),
  unit: z.enum(CURRENCIES),
  trend: z.number().nullable(),
  low: z.number().nullable(),
  avg30: z.number().nullable(),
  avg7: z.number().nullable(),
  avg1: z.number().nullable(),
  updatedAt: z.string(),
});
export type CardMarketPrice = z.infer<typeof CardMarketPriceSchema>;

export const CardPriceRecordSchema = z.object({
  cardId: z.string(),
  sources: z
    .object({
      cardmarket: CardMarketPriceSchema.optional(),
    })
    .strict()
    .refine((sources) => Object.keys(sources).length > 0, {
      message: 'A price record must have at least one source',
    }),
});
export type CardPriceRecord = z.infer<typeof CardPriceRecordSchema>;

export const PriceFileSchema = z.object({
  generatedAt: z.string(),
  records: z.record(z.string(), CardPriceRecordSchema),
});
export type PriceFile = z.infer<typeof PriceFileSchema>;
