import { z } from 'zod';
import { SupportedCurrencySchema } from './currency-schema';

export const PortfolioEntrySchema = z.object({
  cardId: z.string().min(1),
  qty: z.number().int().positive(),
  costValue: z.number().nonnegative(),
  costCurrency: SupportedCurrencySchema,
  addedAt: z.string(),  // ISO 8601 date (YYYY-MM-DD)
});
export type PortfolioEntry = z.infer<typeof PortfolioEntrySchema>;

export const PortfolioFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(PortfolioEntrySchema),
});
export type PortfolioFile = z.infer<typeof PortfolioFileSchema>;

// Shape the UI passes into addEntry — no addedAt yet (storage fills it).
export type NewEntryInput = {
  cardId: string;
  qty: number;
  costValue: number;
  costCurrency: PortfolioEntry['costCurrency'];
};
