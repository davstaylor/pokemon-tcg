import { describe, it, expect } from 'vitest';
import { convertFromEUR, formatCurrency, convertBetween } from '@/data/currency';
import type { ExchangeRates } from '@/data/currency-schema';

const rates: ExchangeRates = {
  base: 'EUR',
  date: '2026-04-19',
  rates: { USD: 1.0754, GBP: 0.8581, JPY: 162.38 },
};

describe('convertFromEUR', () => {
  it('returns the same value when target is EUR', () => {
    expect(convertFromEUR(100, 'EUR', rates)).toBe(100);
  });
  it('multiplies by USD rate', () => {
    expect(convertFromEUR(100, 'USD', rates)).toBeCloseTo(107.54, 2);
  });
  it('multiplies by GBP rate', () => {
    expect(convertFromEUR(100, 'GBP', rates)).toBeCloseTo(85.81, 2);
  });
  it('multiplies by JPY rate', () => {
    expect(convertFromEUR(100, 'JPY', rates)).toBeCloseTo(16238, 0);
  });
  it('passes null through as null', () => {
    expect(convertFromEUR(null, 'USD', rates)).toBeNull();
  });
});

describe('formatCurrency', () => {
  it('formats EUR with two decimals and € glyph', () => {
    expect(formatCurrency(359.17, 'EUR')).toBe('€359.17');
  });
  it('formats USD with two decimals and $ glyph', () => {
    expect(formatCurrency(386.4, 'USD')).toBe('$386.40');
  });
  it('formats GBP with two decimals and £ glyph', () => {
    expect(formatCurrency(308.22, 'GBP')).toBe('£308.22');
  });
  it('formats JPY with no decimals and ¥ glyph', () => {
    expect(formatCurrency(58349, 'JPY')).toBe('¥58,349');
  });
  it('renders em-dash for null values', () => {
    expect(formatCurrency(null, 'EUR')).toBe('—');
  });
});

const rates2 = { base: 'EUR' as const, date: '2026-04-22', rates: { USD: 1.08, GBP: 0.86, JPY: 162.0 } };

describe('convertBetween', () => {
  it('returns value unchanged when from === to', () => {
    expect(convertBetween(100, 'GBP', 'GBP', rates2)).toBe(100);
    expect(convertBetween(42, 'EUR', 'EUR', rates2)).toBe(42);
  });

  it('converts via EUR for non-EUR pairs', () => {
    // £100 → €100 / 0.86 = €116.28... → $116.28 × 1.08 = $125.58...
    const usd = convertBetween(100, 'GBP', 'USD', rates2);
    expect(usd).toBeCloseTo((100 / 0.86) * 1.08, 3);
  });

  it('converts EUR → target via the direct multiplier', () => {
    expect(convertBetween(100, 'EUR', 'USD', rates2)).toBeCloseTo(108, 3);
    expect(convertBetween(100, 'EUR', 'GBP', rates2)).toBeCloseTo(86, 3);
  });

  it('converts target → EUR via the direct divisor', () => {
    expect(convertBetween(108, 'USD', 'EUR', rates2)).toBeCloseTo(100, 3);
    expect(convertBetween(86, 'GBP', 'EUR', rates2)).toBeCloseTo(100, 3);
  });
});
