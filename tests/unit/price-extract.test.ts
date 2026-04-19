import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractPrices } from '@/data/price-extract';
import { CardPriceRecordSchema } from '@/data/price-schema';

const fixture = JSON.parse(
  readFileSync(new URL('../../data/fixtures/sample-cards.json', import.meta.url), 'utf8'),
);

describe('extractPrices', () => {
  it('returns a price record for a card with cardmarket pricing', () => {
    const result = extractPrices(fixture.en);
    const charizard = result.find((r) => r.cardId === 'base1-4')!;
    expect(charizard).toBeDefined();
    expect(charizard.sources.cardmarket?.trend).toBe(359.17);
    expect(charizard.sources.cardmarket?.low).toBe(92.5);
    expect(charizard.sources.cardmarket?.avg30).toBe(409.46);
    expect(charizard.sources.cardmarket?.avg7).toBe(324.13);
    expect(charizard.sources.cardmarket?.avg1).toBe(361.73);
    expect(charizard.sources.cardmarket?.unit).toBe('EUR');
    expect(charizard.sources.cardmarket?.updatedAt).toBe('2026-04-19T00:49:45.000Z');
  });

  it('does not produce a record for a card without pricing', () => {
    const result = extractPrices(fixture.en);
    expect(result.find((r) => r.cardId === 'base1-2')).toBeUndefined();
  });

  it('produces records that pass schema validation', () => {
    const result = extractPrices(fixture.en);
    for (const record of result) {
      expect(() => CardPriceRecordSchema.parse(record)).not.toThrow();
    }
  });

  it('returns empty array when no cards have pricing', () => {
    const withoutPricing = fixture.en.map((c: any) => {
      const { pricing, ...rest } = c;
      return rest;
    });
    const result = extractPrices(withoutPricing);
    expect(result).toEqual([]);
  });
});
