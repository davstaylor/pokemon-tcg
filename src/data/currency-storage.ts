import type { SupportedCurrency } from './currency-schema';

/**
 * localStorage key used to persist the user's display-currency preference.
 * Shared across CurrencySelect, PortfolioDashboard, and PortfolioAddButton
 * so there's a single source of truth when the key is renamed.
 */
export const CURRENCY_STORAGE_KEY = 'pokemon-tcg-currency';

const FALLBACK_CURRENCY: SupportedCurrency = 'GBP';

/**
 * Resolve the display currency for any island: read localStorage first, then
 * infer from the browser locale (GB→GBP, US→USD, JP→JPY), then fall back to
 * GBP. Same logic CurrencySelect uses — kept in one place to avoid drift.
 */
export function detectDisplayCurrency(): SupportedCurrency {
  try {
    const saved = localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (saved === 'EUR' || saved === 'USD' || saved === 'GBP' || saved === 'JPY') return saved;
  } catch {
    // localStorage may throw in sandboxed iframes — fall through.
  }
  try {
    const locale = Intl.NumberFormat().resolvedOptions().locale;
    const region = locale.split('-')[1]?.toUpperCase();
    if (region === 'US') return 'USD';
    if (region === 'GB') return 'GBP';
    if (region === 'JP') return 'JPY';
  } catch {
    // Intl may not be available in very old runtimes.
  }
  return FALLBACK_CURRENCY;
}
