import { describe, it, expect } from 'vitest';
import { CardMarketPriceSchema, CardPriceRecordSchema, PriceFileSchema } from '@/data/price-schema';

const validCM = {
  source: 'cardmarket' as const,
  unit: 'EUR' as const,
  trend: 359.17,
  low: 92.5,
  avg30: 409.46,
  avg7: 324.13,
  avg1: 361.73,
  updatedAt: '2026-04-19T00:49:45.000Z',
};

describe('CardMarketPriceSchema', () => {
  it('accepts a valid Cardmarket price with all fields', () => {
    expect(() => CardMarketPriceSchema.parse(validCM)).not.toThrow();
  });

  it('accepts null numeric fields (unpopulated dimensions)', () => {
    expect(() => CardMarketPriceSchema.parse({ ...validCM, low: null, avg30: null })).not.toThrow();
  });

  it('rejects an unknown source', () => {
    expect(() => CardMarketPriceSchema.parse({ ...validCM, source: 'ebay' })).toThrow();
  });

  it('rejects an unknown currency', () => {
    expect(() => CardMarketPriceSchema.parse({ ...validCM, unit: 'GBP' })).toThrow();
  });
});

describe('CardPriceRecordSchema', () => {
  it('accepts a record with cardmarket source only', () => {
    const record = { cardId: 'base1-4', sources: { cardmarket: validCM } };
    expect(() => CardPriceRecordSchema.parse(record)).not.toThrow();
  });

  it('rejects a record with no sources', () => {
    const empty = { cardId: 'base1-4', sources: {} };
    expect(() => CardPriceRecordSchema.parse(empty)).toThrow();
  });

  it('rejects unknown source keys (forward-compat guard)', () => {
    const bad = { cardId: 'base1-4', sources: { someOther: validCM } };
    expect(() => CardPriceRecordSchema.parse(bad)).toThrow();
  });
});

describe('PriceFileSchema', () => {
  it('accepts a well-formed price file', () => {
    const file = {
      generatedAt: '2026-04-19T00:50:00.000Z',
      records: {
        'base1-4': { cardId: 'base1-4', sources: { cardmarket: validCM } },
      },
    };
    expect(() => PriceFileSchema.parse(file)).not.toThrow();
  });

  it('accepts an empty records map', () => {
    const file = { generatedAt: '2026-04-19T00:50:00.000Z', records: {} };
    expect(() => PriceFileSchema.parse(file)).not.toThrow();
  });
});
