import { describe, it, expect } from 'vitest';
import { CardIdentitySchema } from '@/data/schema';

const makePrint = (name: string) => ({
  name,
  setName: 'Base',
  setSymbol: 'x',
  rarity: 'Holo Rare',
  hp: 120,
  types: ['Fire'],
  attacks: [],
  artist: 'Mitsuhiro Arita',
  imageURL: 'x',
  releaseDate: '1999-01-09',
  flavorText: null,
});

describe('CardIdentitySchema', () => {
  it('accepts a minimal valid card identity with one print', () => {
    const valid = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: { en: { ...makePrint('Charizard'), flavorText: 'Spits fire.' } },
      searchTokens: ['Charizard'],
      filters: { setId: 'base1', rarity: 'Holo Rare', types: ['Fire'], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(valid)).not.toThrow();
  });

  it('accepts a card with many regional prints including hyphenated codes', () => {
    const multi = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: {
        en: makePrint('Charizard'),
        ja: makePrint('リザードン'),
        fr: makePrint('Dracaufeu'),
        de: makePrint('Glurak'),
        'zh-tw': makePrint('噴火龍'),
        'zh-cn': makePrint('喷火龙'),
      },
      searchTokens: ['Charizard', 'リザードン', 'Dracaufeu', 'Glurak', '噴火龍', '喷火龙'],
      filters: { setId: 'base1', rarity: 'Holo Rare', types: ['Fire'], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(multi)).not.toThrow();
  });

  it('rejects a card with no prints at all', () => {
    const empty = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: {},
      searchTokens: [],
      filters: { setId: 'base1', rarity: 'x', types: [], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(empty)).toThrow();
  });

  it('rejects unknown language keys (languages TCGdex does not publish)', () => {
    const bad = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: { xx: makePrint('Unknown') },
      searchTokens: ['Charizard'],
      filters: { setId: 'base1', rarity: 'x', types: [], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(bad)).toThrow();
  });

  it('rejects aspirational-but-empty codes (ko, pl, ru, nl) — not fetched in v1', () => {
    // TCGdex has /v2/ko/cards as an endpoint but returns zero cards. We drop
    // those codes from SUPPORTED_LANGUAGES until TCGdex populates them; when
    // that happens, add them and update this test to expect success.
    const withKorean = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: { en: makePrint('Charizard'), ko: makePrint('리자몽') },
      searchTokens: ['Charizard', '리자몽'],
      filters: { setId: 'base1', rarity: 'Holo Rare', types: ['Fire'], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(withKorean)).toThrow();
  });
});
