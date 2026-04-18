import { describe, it, expect } from 'vitest';
import { CardIdentitySchema } from '@/data/schema';

describe('CardIdentitySchema', () => {
  it('accepts a minimal valid card identity with one print', () => {
    const valid = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: {
        en: {
          name: 'Charizard',
          setName: 'Base',
          setSymbol: 'https://assets.tcgdex.net/en/base/base1/symbol.png',
          rarity: 'Holo Rare',
          hp: 120,
          types: ['Fire'],
          attacks: [],
          artist: 'Mitsuhiro Arita',
          imageURL: 'https://assets.tcgdex.net/en/base/base1/4/high.webp',
          releaseDate: '1999-01-09',
          flavorText: 'Spits fire that is hot enough to melt boulders.',
        },
      },
      searchTokens: ['Charizard'],
      filters: { setId: 'base1', rarity: 'Holo Rare', types: ['Fire'], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(valid)).not.toThrow();
  });

  it('accepts a card with multiple regional prints', () => {
    const multi = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: {
        en: { name: 'Charizard', setName: 'Base', setSymbol: 'x', rarity: 'Holo Rare', hp: 120, types: ['Fire'], attacks: [], artist: 'A', imageURL: 'x', releaseDate: '1999-01-09', flavorText: null },
        ja: { name: 'リザードン', setName: '拡張パック', setSymbol: 'x', rarity: 'Holo Rare', hp: 120, types: ['Fire'], attacks: [], artist: 'A', imageURL: 'x', releaseDate: '1996-10-20', flavorText: null },
      },
      searchTokens: ['Charizard', 'リザードン'],
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

  it('rejects unknown language keys in prints', () => {
    const bad = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: { fr: { /* doesn't matter */ } },
      searchTokens: ['Charizard'],
      filters: { setId: 'base1', rarity: 'x', types: [], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(bad)).toThrow();
  });
});
