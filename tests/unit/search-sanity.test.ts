import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalise } from '@/data/normalise';

const fixture = JSON.parse(
  readFileSync(new URL('../../data/fixtures/sample-cards.json', import.meta.url), 'utf8'),
);
const cards = normalise(fixture);

type Query = { q: string; expectedId: string; description: string };

// Cover every populated language at least once. Each query is the exact card
// name in that language; the fixture must contain Charizard in every populated
// language for this to pass.
const queries: Query[] = [
  { q: 'Charizard',  expectedId: 'base1-4', description: 'English / Italian / Spanish / Portuguese / Indonesian (same name)' },
  { q: 'リザードン',   expectedId: 'base1-4', description: 'Japanese' },
  { q: 'Dracaufeu',  expectedId: 'base1-4', description: 'French' },
  { q: 'Glurak',     expectedId: 'base1-4', description: 'German' },
  { q: '噴火龍',      expectedId: 'base1-4', description: 'Traditional Chinese' },
  { q: '喷火龙',      expectedId: 'base1-4', description: 'Simplified Chinese' },
  { q: 'ลิซาร์ดอน',   expectedId: 'base1-4', description: 'Thai' },
  { q: 'Blastoise',  expectedId: 'base1-2', description: 'English, single-language card' },
];

describe('search sanity — fixed query list covering every populated language', () => {
  for (const { q, expectedId, description } of queries) {
    it(`resolves "${q}" to ${expectedId} (${description})`, () => {
      const match = cards.find((c) => c.searchTokens.some((t) => t === q));
      expect(match?.id).toBe(expectedId);
    });
  }
});
