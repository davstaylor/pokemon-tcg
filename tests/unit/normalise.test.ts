import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalise } from '@/data/normalise';
import { CardIdentityArraySchema } from '@/data/schema';

const fixture = JSON.parse(
  readFileSync(new URL('../../data/fixtures/sample-cards.json', import.meta.url), 'utf8'),
);

describe('normalise', () => {
  it('merges the four language dumps into one identity per card', () => {
    const result = normalise(fixture);
    expect(result).toHaveLength(2);
    const charizard = result.find((c) => c.id === 'base1-4')!;
    expect(Object.keys(charizard.prints).sort()).toEqual(['en', 'ja', 'ko', 'zh']);
  });

  it('includes cards that only exist in one language', () => {
    const result = normalise(fixture);
    const blastoise = result.find((c) => c.id === 'base1-2')!;
    expect(blastoise).toBeDefined();
    expect(Object.keys(blastoise.prints)).toEqual(['en']);
  });

  it('builds multilingual search tokens', () => {
    const result = normalise(fixture);
    const charizard = result.find((c) => c.id === 'base1-4')!;
    expect(charizard.searchTokens).toEqual(
      expect.arrayContaining(['Charizard', 'リザードン', '리자몽', '喷火龙']),
    );
  });

  it('uses English name as defaultName when available', () => {
    const result = normalise(fixture);
    expect(result.find((c) => c.id === 'base1-4')!.defaultName).toBe('Charizard');
  });

  it('falls back to Japanese defaultName when no English print exists', () => {
    const jpOnly = {
      en: [],
      ja: [fixture.ja[0]],
      ko: [],
      zh: [],
    };
    const result = normalise(jpOnly);
    expect(result[0].defaultName).toBe('リザードン');
  });

  it('produces output that passes schema validation', () => {
    const result = normalise(fixture);
    expect(() => CardIdentityArraySchema.parse(result)).not.toThrow();
  });

  it('appends /high.webp to bare image URLs', () => {
    const result = normalise(fixture);
    const charizard = result.find((c) => c.id === 'base1-4')!;
    expect(charizard.prints.en!.imageURL).toBe(
      'https://assets.tcgdex.net/en/base/base1/4/high.webp',
    );
  });
});
