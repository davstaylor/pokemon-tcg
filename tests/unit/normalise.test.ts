import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalise } from '@/data/normalise';
import { CardIdentityArraySchema } from '@/data/schema';

const fixture = JSON.parse(
  readFileSync(new URL('../../data/fixtures/sample-cards.json', import.meta.url), 'utf8'),
);

describe('normalise', () => {
  it('merges all populated language dumps into one identity per card', () => {
    const result = normalise(fixture);
    expect(result).toHaveLength(2);
    const charizard = result.find((c) => c.id === 'base1-4')!;
    expect(new Set(Object.keys(charizard.prints))).toEqual(
      new Set(['en', 'ja', 'fr', 'de', 'it', 'es', 'pt', 'zh-tw', 'zh-cn', 'th', 'id']),
    );
  });

  it('includes cards that only exist in one language', () => {
    const result = normalise(fixture);
    const blastoise = result.find((c) => c.id === 'base1-2')!;
    expect(blastoise).toBeDefined();
    expect(Object.keys(blastoise.prints)).toEqual(['en']);
  });

  it('builds multilingual search tokens across all 11 languages', () => {
    const result = normalise(fixture);
    const charizard = result.find((c) => c.id === 'base1-4')!;
    expect(charizard.searchTokens).toEqual(
      expect.arrayContaining([
        'Charizard',       // en, it, es, pt, id (same name in those langs)
        'リザードン',        // ja
        'Dracaufeu',        // fr
        'Glurak',           // de
        '噴火龍',            // zh-tw
        '喷火龙',            // zh-cn
        'ลิซาร์ดอน',         // th
      ]),
    );
  });

  it('uses English name as defaultName when available', () => {
    const result = normalise(fixture);
    expect(result.find((c) => c.id === 'base1-4')!.defaultName).toBe('Charizard');
  });

  it('falls back to Japanese defaultName when no English print exists', () => {
    const jpOnly = { ja: [fixture.ja[0]] };
    const result = normalise(jpOnly);
    expect(result[0].defaultName).toBe('リザードン');
  });

  it('falls back to French (next in preference) when no EN or JA print exists', () => {
    const frOnly = { fr: [fixture.fr[0]] };
    const result = normalise(frOnly);
    expect(result[0].defaultName).toBe('Dracaufeu');
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

  it('tolerates missing language keys in the input (Partial<RawDumps>)', () => {
    // TCGdex returning zero cards for, e.g., Polish means we never get a 'pl'
    // key in the raw dumps. normalise must not blow up on missing keys.
    const enOnly = { en: fixture.en };
    expect(() => normalise(enOnly)).not.toThrow();
    const result = normalise(enOnly);
    expect(result).toHaveLength(2);
  });
});
