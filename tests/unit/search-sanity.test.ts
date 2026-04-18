import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalise } from '@/data/normalise';

const fixture = JSON.parse(
  readFileSync(new URL('../../data/fixtures/sample-cards.json', import.meta.url), 'utf8'),
);
const cards = normalise(fixture);

type Query = { q: string; expectedId: string; description: string };

const queries: Query[] = [
  { q: 'Charizard', expectedId: 'base1-4', description: 'English exact match' },
  { q: 'リザードン', expectedId: 'base1-4', description: 'Japanese exact match' },
  { q: '리자몽', expectedId: 'base1-4', description: 'Korean exact match' },
  { q: '喷火龙', expectedId: 'base1-4', description: 'Chinese Simplified exact match' },
  { q: 'Blastoise', expectedId: 'base1-2', description: 'English, single-language card' },
];

describe('search sanity — fixed query list', () => {
  for (const { q, expectedId, description } of queries) {
    it(`resolves "${q}" to ${expectedId} (${description})`, () => {
      const match = cards.find((c) => c.searchTokens.some((t) => t === q));
      expect(match?.id).toBe(expectedId);
    });
  }
});
