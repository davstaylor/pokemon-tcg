import type { ExchangeRates, SupportedCurrency } from './currency-schema';
import { CURRENCY_DECIMALS, CURRENCY_GLYPH } from './currency-schema';

export function convertFromEUR(
  eurValue: number | null,
  target: SupportedCurrency,
  rates: ExchangeRates,
): number | null {
  if (eurValue === null) return null;
  if (target === 'EUR') return eurValue;
  return eurValue * rates.rates[target];
}

export function formatCurrency(value: number | null, currency: SupportedCurrency): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const decimals = CURRENCY_DECIMALS[currency];
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${CURRENCY_GLYPH[currency]}${formatter.format(value)}`;
}
