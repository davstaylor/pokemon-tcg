import { describe, it, expect } from 'vitest';
import { convertFromEUR, formatCurrency } from '@/data/currency';
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
