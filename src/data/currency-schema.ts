import { z } from 'zod';

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY'] as const;
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

// Each currency's decimal-places in display (JPY has 0, others 2)
export const CURRENCY_DECIMALS: Record<SupportedCurrency, number> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  JPY: 0,
};

export const CURRENCY_GLYPH: Record<SupportedCurrency, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  JPY: '¥',
};

// Frankfurter /latest?from=EUR&to=USD,GBP,JPY returns:
//   { amount: 1, base: 'EUR', date: '2026-04-19', rates: { USD: 1.0754, GBP: 0.8581, JPY: 162.38 } }
export const ExchangeRatesSchema = z.object({
  base: z.literal('EUR'),
  date: z.string(),
  rates: z.object({
    USD: z.number().positive(),
    GBP: z.number().positive(),
    JPY: z.number().positive(),
  }),
});
export type ExchangeRates = z.infer<typeof ExchangeRatesSchema>;
