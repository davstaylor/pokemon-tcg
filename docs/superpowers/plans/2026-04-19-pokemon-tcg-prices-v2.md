# Pokémon TCG Prices v2.0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live-feeling price tile to every card page using Cardmarket data surfaced through the TCGdex per-card endpoint. Tracked hot set is polled every 5 minutes via a new GitHub Actions workflow; everything else refreshes nightly. chart.js mini-line + single-source delta gives the tile immediate information density.

**Architecture:** Extend the existing nightly build (`scripts/fetch-and-build-data.ts`) to emit `data/prices-baseline.json` alongside `data/cards.json` in the same pass. Add a new fast-poll workflow that runs `scripts/fetch-prices-fresh.ts` every 5 min, writing `data/prices-fresh.json`. The card page reads both files at build time and prefers fresh where available. UI is an Astro `PriceTile` component with a Preact `PriceChart` island wrapping chart.js.

**Tech Stack:** Astro 6, Preact, TypeScript strict, Zod, chart.js 4, `@tcgdex/sdk` 2, `js-yaml`, Vitest, Playwright, GitHub Actions.

**Spec reference:** [`docs/superpowers/specs/2026-04-19-pokemon-tcg-prices-v2-design.md`](../specs/2026-04-19-pokemon-tcg-prices-v2-design.md)

---

## Context the engineer must know before starting

- **The pricing data is free on the existing per-card TCGdex endpoint.** `GET /v2/en/cards/{id}` returns a `pricing.cardmarket` object with `trend / low / avg / avg1 / avg7 / avg30`, plus holo variants (`trend-holo`, etc., which v2.0 ignores). Currency is always `EUR`.
- **Nearly every card has pricing data** (~93% in our random sampling). Cards without pricing are usually special / promo / sealed products.
- **Cardmarket's own API is closed** — don't try to integrate with it directly. The TCGdex route is the only one that works.
- **eBay is explicitly v2.1.** Leave the reserved slot in the UI but do not fetch or wire anything.
- **Fail-loud philosophy continues.** If the TCGdex pricing block has fields we don't expect, Zod validation fails and the workflow fails loudly — we never ship half-broken data.
- **Repository state:** `main` branch, currently deploying to `davstaylor.github.io/pokemon-tcg/` via GitHub Pages. Two existing workflows in `.github/workflows/`: `build.yml` (nightly + push + manual). We'll add a second workflow, not replace.
- **Node 22** in CI, as bumped in commit `ade044f`. TypeScript strict mode, Zod v4, Vitest 4, Astro 6.

---

## File structure (planned end state)

```
/
├── .github/workflows/
│   ├── build.yml                              # modified: add paths-ignore for data/prices-fresh.json
│   └── prices-fast-poll.yml                   # NEW: every-5-min workflow
├── scripts/
│   ├── fetch-and-build-data.ts                # modified: also write data/prices-baseline.json
│   └── fetch-prices-fresh.ts                  # NEW: polls tracked-sets.yaml cards
├── src/
│   ├── data/
│   │   ├── price-schema.ts                    # NEW: Zod schemas + types for prices
│   │   ├── price-extract.ts                   # NEW: raw card -> CardPriceRecord
│   │   ├── price-merge.ts                     # NEW: combine baseline + fresh
│   │   ├── price-delta.ts                     # NEW: trend-vs-avg30 + percentage
│   │   └── price-freshness.ts                 # NEW: updatedAt -> badge state
│   ├── components/
│   │   ├── PriceTile.astro                    # NEW: the whole live + placeholder tile
│   │   └── PriceChart.tsx                     # NEW: Preact island, wraps chart.js
│   └── pages/card/[id].astro                  # modified: render PriceTile when data exists
├── tracked-sets.yaml                          # NEW: config — which sets get 5-min polling
├── data/
│   ├── cards.json                             # v1 output (unchanged, gitignored)
│   ├── prices-baseline.json                   # NEW nightly output (gitignored, generated)
│   ├── prices-fresh.json                      # NEW fast-poll output (committed — fast-poll pushes it)
│   └── fixtures/
│       └── sample-cards.json                  # modified: include pricing.cardmarket on 1 card
└── tests/
    ├── unit/
    │   ├── price-schema.test.ts               # NEW
    │   ├── price-extract.test.ts              # NEW
    │   ├── price-merge.test.ts                # NEW
    │   ├── price-delta.test.ts                # NEW
    │   └── price-freshness.test.ts            # NEW
    └── e2e/
        └── price-tile.spec.ts                 # NEW
```

**Gitignore policy:** `prices-fresh.json` IS committed (that's how the fast-poll propagates state to the site). `cards.json` and `prices-baseline.json` are generated at build time inside CI and gitignored.

---

## Task 1: Price schema + types

**Files:**
- Create: `src/data/price-schema.ts`
- Create: `tests/unit/price-schema.test.ts`

- [ ] **Step 1: Write the failing tests — `tests/unit/price-schema.test.ts`**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: 9 new tests fail with "Cannot find module '@/data/price-schema'". v1 tests (22) still pass.

- [ ] **Step 3: Implement `src/data/price-schema.ts`**

```ts
import { z } from 'zod';

export const PRICE_SOURCES = ['cardmarket'] as const;
// v2.1 will extend: ['cardmarket', 'ebay']
export type PriceSource = typeof PRICE_SOURCES[number];

export const CURRENCIES = ['EUR', 'USD'] as const;
export type Currency = typeof CURRENCIES[number];

export const CardMarketPriceSchema = z.object({
  source: z.literal('cardmarket'),
  unit: z.enum(CURRENCIES),
  trend: z.number().nullable(),
  low: z.number().nullable(),
  avg30: z.number().nullable(),
  avg7: z.number().nullable(),
  avg1: z.number().nullable(),
  updatedAt: z.string(),
});
export type CardMarketPrice = z.infer<typeof CardMarketPriceSchema>;

export const CardPriceRecordSchema = z.object({
  cardId: z.string(),
  sources: z
    .object({
      cardmarket: CardMarketPriceSchema.optional(),
    })
    .strict()
    .refine((sources) => Object.keys(sources).length > 0, {
      message: 'A price record must have at least one source',
    }),
});
export type CardPriceRecord = z.infer<typeof CardPriceRecordSchema>;

export const PriceFileSchema = z.object({
  generatedAt: z.string(),
  records: z.record(z.string(), CardPriceRecordSchema),
});
export type PriceFile = z.infer<typeof PriceFileSchema>;
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: 31/31 pass (22 existing + 9 new).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/data/price-schema.ts tests/unit/price-schema.test.ts
git commit -m "feat(prices): add Zod schemas for card price records"
```

---

## Task 2: Price extractor + fixture extension

**Files:**
- Create: `src/data/price-extract.ts`
- Create: `tests/unit/price-extract.test.ts`
- Modify: `data/fixtures/sample-cards.json` (add `pricing` block to Charizard EN entry only)

- [ ] **Step 1: Add pricing data to the EN Charizard fixture — `data/fixtures/sample-cards.json`**

Edit the EN Charizard object (id `base1-4`) to include a `pricing` block. The full EN array should look like:

```json
"en": [
  { "id": "base1-4", "localId": "4", "name": "Charizard", "image": "https://assets.tcgdex.net/en/base/base1/4", "set": { "id": "base1", "name": "Base", "symbol": "https://assets.tcgdex.net/en/base/base1/symbol", "serie": { "id": "base", "name": "Base" }, "releaseDate": "1999-01-09" }, "rarity": "Holo Rare", "hp": 120, "types": ["Fire"], "attacks": [], "illustrator": "Mitsuhiro Arita", "description": "Spits fire that is hot enough to melt boulders.", "pricing": { "cardmarket": { "updated": "2026-04-19T00:49:45.000Z", "unit": "EUR", "avg": 418.36, "low": 92.5, "trend": 359.17, "avg1": 361.73, "avg7": 324.13, "avg30": 409.46, "avg-holo": null, "low-holo": null, "trend-holo": 123.63, "avg1-holo": 207.4, "avg7-holo": 129.55, "avg30-holo": 202.71 }, "tcgplayer": null } },
  { "id": "base1-2", "localId": "2", "name": "Blastoise", "image": "https://assets.tcgdex.net/en/base/base1/2", "set": { "id": "base1", "name": "Base", "symbol": "https://assets.tcgdex.net/en/base/base1/symbol", "serie": { "id": "base", "name": "Base" }, "releaseDate": "1999-01-09" }, "rarity": "Holo Rare", "hp": 100, "types": ["Water"], "attacks": [], "illustrator": "Ken Sugimori", "description": null }
],
```

Note: Blastoise gets NO pricing block, so tests can verify the "missing pricing" code path. Leave all non-EN language arrays untouched — the extractor only reads the EN dump.

- [ ] **Step 2: Write failing tests — `tests/unit/price-extract.test.ts`**

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: price-extract tests fail with "Cannot find module '@/data/price-extract'".

- [ ] **Step 4: Implement `src/data/price-extract.ts`**

```ts
import type { CardPriceRecord } from './price-schema';

// Partial shape of TCGdex's raw card response — only the fields we need.
type RawCardWithPricing = {
  id: string;
  pricing?: {
    cardmarket?: {
      updated: string;
      unit: string;
      trend?: number | null;
      low?: number | null;
      avg30?: number | null;
      avg7?: number | null;
      avg1?: number | null;
    } | null;
    tcgplayer?: unknown | null;
  };
};

export function extractPrices(cards: RawCardWithPricing[]): CardPriceRecord[] {
  const out: CardPriceRecord[] = [];
  for (const card of cards) {
    const cm = card.pricing?.cardmarket;
    if (!cm) continue;
    if (cm.unit !== 'EUR' && cm.unit !== 'USD') {
      // Fail loud — we only support EUR / USD. If Cardmarket returns something
      // else, Zod validation downstream would catch it; this guard is explicit.
      throw new Error(`extractPrices: unexpected currency "${cm.unit}" for card ${card.id}`);
    }
    out.push({
      cardId: card.id,
      sources: {
        cardmarket: {
          source: 'cardmarket',
          unit: cm.unit,
          trend: cm.trend ?? null,
          low: cm.low ?? null,
          avg30: cm.avg30 ?? null,
          avg7: cm.avg7 ?? null,
          avg1: cm.avg1 ?? null,
          updatedAt: cm.updated,
        },
      },
    });
  }
  return out;
}
```

- [ ] **Step 5: Run tests**

Run: `npm run test:unit`
Expected: 35/35 pass.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/data/price-extract.ts tests/unit/price-extract.test.ts data/fixtures/sample-cards.json
git commit -m "feat(prices): extract CardPriceRecord from TCGdex raw card data"
```

---

## Task 3: Extend nightly build to emit `prices-baseline.json`

**Files:**
- Modify: `scripts/fetch-and-build-data.ts`
- Modify: `.gitignore` (add `data/prices-baseline.json`)

- [ ] **Step 1: Add `data/prices-baseline.json` to `.gitignore`**

Edit `.gitignore`. Find the `# Generated data` block and extend it:

```
# Generated data
data/cards.json
data/prices-baseline.json
```

- [ ] **Step 2: Modify `scripts/fetch-and-build-data.ts` to also write prices-baseline.json**

Read the current file first to know exactly what's there. Then make the following changes:

1. Add imports at the top (after the existing imports from `../src/data/normalise.ts` and `../src/data/schema.ts`):

```ts
import { extractPrices } from '../src/data/price-extract.ts';
import { PriceFileSchema, type PriceFile } from '../src/data/price-schema.ts';
```

2. In `async function main()`, AFTER the existing `writeFileSync(OUT_FILE, JSON.stringify(identities))` line, add:

```ts
  console.log('Extracting prices from EN dump...');
  const priceRecords = extractPrices(dumps.en ?? []);
  const priceFile: PriceFile = {
    generatedAt: new Date().toISOString(),
    records: Object.fromEntries(priceRecords.map((r) => [r.cardId, r])),
  };
  PriceFileSchema.parse(priceFile);  // fail loud on any shape drift
  const PRICE_FILE = resolve(OUT_DIR, 'prices-baseline.json');
  writeFileSync(PRICE_FILE, JSON.stringify(priceFile));
  console.log(`Wrote ${priceRecords.length} price records to data/prices-baseline.json`);
```

The final log line stays as-is (the summary of card identities).

- [ ] **Step 3: Run the updated build script with fixtures**

Run: `FIXTURES=1 npx tsx scripts/fetch-and-build-data.ts`
Expected output:
```
Loading fixture dumps...
Normalising...
Validating schema...
Extracting prices from EN dump...
Wrote 1 price records to data/prices-baseline.json
Wrote 2 card identities to data/cards.json in 0.0s
```

- [ ] **Step 4: Verify the file shape**

```bash
node -e 'const f=JSON.parse(require("fs").readFileSync("data/prices-baseline.json"));console.log("generatedAt:",f.generatedAt,"\nrecord count:",Object.keys(f.records).length,"\nbase1-4:",JSON.stringify(f.records["base1-4"],null,2))'
```

Expected: record count is 1, the Charizard record has `sources.cardmarket.trend === 359.17`.

- [ ] **Step 5: Full test suite (regression check)**

```bash
npm run typecheck
npm run test:unit
```

Expected: typecheck clean, 35/35 unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-and-build-data.ts .gitignore
git commit -m "feat(prices): write prices-baseline.json in nightly build"
```

---

## Task 4: Merge + delta + freshness utilities

**Files:**
- Create: `src/data/price-merge.ts`
- Create: `src/data/price-delta.ts`
- Create: `src/data/price-freshness.ts`
- Create: `tests/unit/price-merge.test.ts`
- Create: `tests/unit/price-delta.test.ts`
- Create: `tests/unit/price-freshness.test.ts`

All three utilities are small pure functions — fit comfortably in one task.

- [ ] **Step 1: Write failing merge tests — `tests/unit/price-merge.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mergePrices } from '@/data/price-merge';
import type { PriceFile } from '@/data/price-schema';

const priceA = {
  cardId: 'base1-4',
  sources: { cardmarket: { source: 'cardmarket' as const, unit: 'EUR' as const, trend: 300, low: 100, avg30: 320, avg7: 310, avg1: 305, updatedAt: '2026-04-19T00:00:00Z' } },
};
const priceAfresh = {
  cardId: 'base1-4',
  sources: { cardmarket: { source: 'cardmarket' as const, unit: 'EUR' as const, trend: 359, low: 92, avg30: 409, avg7: 324, avg1: 361, updatedAt: '2026-04-19T10:00:00Z' } },
};
const priceB = {
  cardId: 'base1-2',
  sources: { cardmarket: { source: 'cardmarket' as const, unit: 'EUR' as const, trend: 150, low: 50, avg30: 160, avg7: 155, avg1: 151, updatedAt: '2026-04-19T00:00:00Z' } },
};

const baseline: PriceFile = {
  generatedAt: '2026-04-19T02:00:00Z',
  records: { 'base1-4': priceA, 'base1-2': priceB },
};

describe('mergePrices', () => {
  it('returns baseline when fresh is empty', () => {
    const fresh: PriceFile = { generatedAt: '2026-04-19T09:00:00Z', records: {} };
    const merged = mergePrices(baseline, fresh);
    expect(merged['base1-4']).toEqual(priceA);
    expect(merged['base1-2']).toEqual(priceB);
  });

  it('fresh overrides baseline where both have the same card', () => {
    const fresh: PriceFile = { generatedAt: '2026-04-19T09:00:00Z', records: { 'base1-4': priceAfresh } };
    const merged = mergePrices(baseline, fresh);
    expect(merged['base1-4']).toEqual(priceAfresh);
    expect(merged['base1-2']).toEqual(priceB);   // untouched
  });

  it('fresh card not in baseline is added', () => {
    const priceC = { cardId: 'sv03-1', sources: { cardmarket: { source: 'cardmarket' as const, unit: 'EUR' as const, trend: 20, low: 10, avg30: 22, avg7: 21, avg1: 20, updatedAt: '2026-04-19T09:00:00Z' } } };
    const fresh: PriceFile = { generatedAt: '2026-04-19T09:00:00Z', records: { 'sv03-1': priceC } };
    const merged = mergePrices(baseline, fresh);
    expect(merged['sv03-1']).toEqual(priceC);
  });

  it('produces a plain object keyed by cardId', () => {
    const merged = mergePrices(baseline, { generatedAt: 'x', records: {} });
    expect(typeof merged).toBe('object');
    expect(merged['base1-4']?.cardId).toBe('base1-4');
  });
});
```

- [ ] **Step 2: Write failing delta tests — `tests/unit/price-delta.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { trendVsAvg30 } from '@/data/price-delta';

describe('trendVsAvg30', () => {
  it('returns positive delta when trend is above the 30-day average', () => {
    const r = trendVsAvg30({ trend: 440, avg30: 400 });
    expect(r.absolute).toBe(40);
    expect(r.percent).toBe(10);
    expect(r.direction).toBe('up');
  });

  it('returns negative delta when trend is below the 30-day average', () => {
    const r = trendVsAvg30({ trend: 359.17, avg30: 409.46 });
    expect(r.absolute).toBeCloseTo(-50.29, 2);
    expect(r.percent).toBeCloseTo(-12.28, 2);
    expect(r.direction).toBe('down');
  });

  it('returns flat direction when delta is zero', () => {
    const r = trendVsAvg30({ trend: 100, avg30: 100 });
    expect(r.direction).toBe('flat');
  });

  it('returns null when either input is null', () => {
    expect(trendVsAvg30({ trend: null, avg30: 400 })).toBeNull();
    expect(trendVsAvg30({ trend: 400, avg30: null })).toBeNull();
    expect(trendVsAvg30({ trend: null, avg30: null })).toBeNull();
  });

  it('returns null when avg30 is zero (avoid division by zero)', () => {
    expect(trendVsAvg30({ trend: 10, avg30: 0 })).toBeNull();
  });
});
```

- [ ] **Step 3: Write failing freshness tests — `tests/unit/price-freshness.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { freshnessBadge } from '@/data/price-freshness';

const now = new Date('2026-04-19T12:00:00Z');

describe('freshnessBadge', () => {
  it('returns LIVE when the age is under 30 minutes', () => {
    expect(freshnessBadge({ updatedAt: '2026-04-19T11:45:00Z', now }).label).toBe('LIVE');
    expect(freshnessBadge({ updatedAt: '2026-04-19T11:35:00Z', now }).kind).toBe('live');
  });

  it('switches to "N min ago" at 30+ minutes', () => {
    const b = freshnessBadge({ updatedAt: '2026-04-19T11:15:00Z', now });
    expect(b.kind).toBe('recent');
    expect(b.label).toBe('updated 45 min ago');
  });

  it('uses hours for ages 1–48 h', () => {
    const b = freshnessBadge({ updatedAt: '2026-04-19T01:00:00Z', now });
    expect(b.kind).toBe('recent');
    expect(b.label).toBe('updated 11h ago');
  });

  it('uses days for ages 48 h – 7 d, and flags stale', () => {
    const b = freshnessBadge({ updatedAt: '2026-04-16T12:00:00Z', now });
    expect(b.kind).toBe('stale');
    expect(b.label).toBe('updated 3d ago');
  });

  it('returns stale for anything older than 7 days as "N d ago"', () => {
    const b = freshnessBadge({ updatedAt: '2026-04-01T12:00:00Z', now });
    expect(b.kind).toBe('stale');
    expect(b.label).toBe('updated 18d ago');
  });
});
```

- [ ] **Step 4: Run tests to confirm they all fail**

Run: `npm run test:unit`
Expected: 14 new tests fail (4 merge + 5 delta + 5 freshness), 35 existing pass.

- [ ] **Step 5: Implement `src/data/price-merge.ts`**

```ts
import type { CardPriceRecord, PriceFile } from './price-schema';

export function mergePrices(baseline: PriceFile, fresh: PriceFile): Record<string, CardPriceRecord> {
  return { ...baseline.records, ...fresh.records };
}
```

- [ ] **Step 6: Implement `src/data/price-delta.ts`**

```ts
export type DeltaDirection = 'up' | 'down' | 'flat';
export type Delta = {
  absolute: number;
  percent: number;  // rounded to 2 decimal places
  direction: DeltaDirection;
};

export function trendVsAvg30({ trend, avg30 }: { trend: number | null; avg30: number | null }): Delta | null {
  if (trend === null || avg30 === null || avg30 === 0) return null;
  const absolute = trend - avg30;
  const percent = Math.round((absolute / avg30) * 10000) / 100;
  const direction: DeltaDirection = absolute > 0 ? 'up' : absolute < 0 ? 'down' : 'flat';
  return { absolute, percent, direction };
}
```

- [ ] **Step 7: Implement `src/data/price-freshness.ts`**

```ts
export type BadgeKind = 'live' | 'recent' | 'stale';
export type Badge = { kind: BadgeKind; label: string };

export function freshnessBadge({ updatedAt, now }: { updatedAt: string; now?: Date }): Badge {
  const then = new Date(updatedAt);
  const n = now ?? new Date();
  const ageMs = n.getTime() - then.getTime();
  const ageMin = Math.floor(ageMs / 60_000);
  const ageHr = Math.floor(ageMs / 3_600_000);
  const ageDay = Math.floor(ageMs / 86_400_000);

  if (ageMin < 30) return { kind: 'live', label: 'LIVE' };
  if (ageMin < 60) return { kind: 'recent', label: `updated ${ageMin} min ago` };
  if (ageHr < 48) return { kind: 'recent', label: `updated ${ageHr}h ago` };
  return { kind: 'stale', label: `updated ${ageDay}d ago` };
}
```

- [ ] **Step 8: Run tests**

Run: `npm run test:unit`
Expected: 49/49 pass (35 + 14 new).

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/data/price-merge.ts src/data/price-delta.ts src/data/price-freshness.ts \
  tests/unit/price-merge.test.ts tests/unit/price-delta.test.ts tests/unit/price-freshness.test.ts
git commit -m "feat(prices): merge, delta, and freshness utilities"
```

---

## Task 5: Fast-poll script + tracked-sets.yaml

**Files:**
- Create: `tracked-sets.yaml`
- Create: `scripts/fetch-prices-fresh.ts`
- Modify: `package.json` (add `js-yaml`, add `fetch-prices-fresh` script)

- [ ] **Step 1: Install js-yaml**

```bash
npm install js-yaml
npm install --save-dev @types/js-yaml
```

- [ ] **Step 2: Add script alias to `package.json`**

Edit `package.json`. In the `"scripts"` block, add one entry (preserving all existing scripts):

```json
"fetch-prices-fresh": "tsx scripts/fetch-prices-fresh.ts",
```

Place it after `"build:fixtures"` for readability.

- [ ] **Step 3: Create `tracked-sets.yaml` at repo root**

```yaml
# Sets whose cards are polled every 5 minutes for fresh price data.
# Every card in the catalog still has baseline prices from the nightly
# build; adding a set here just means its cards show a LIVE badge and
# refresh much more often.
#
# Grow this list over time. Eventually it holds every set ID TCGdex
# publishes, at which point we've reached the "every card trackable"
# end state from the design doc.
tracked:
  - base1   # Base Set (1999). Vintage scarcity and high volatility make the tile meaningful.
```

- [ ] **Step 4: Create `scripts/fetch-prices-fresh.ts`**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml } from 'js-yaml';
import TCGdex from '@tcgdex/sdk';
import { extractPrices } from '../src/data/price-extract.ts';
import { PriceFileSchema, type PriceFile } from '../src/data/price-schema.ts';

const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CONFIG_PATH = resolve(REPO_ROOT, 'tracked-sets.yaml');
const OUT_FILE = resolve(REPO_ROOT, 'data', 'prices-fresh.json');

type TrackedConfig = { tracked: string[] };

async function main() {
  const start = Date.now();

  // 1. Parse tracked-sets.yaml — fail loudly on a bad config.
  const yamlText = readFileSync(CONFIG_PATH, 'utf8');
  const config = parseYaml(yamlText) as TrackedConfig;
  if (!config || !Array.isArray(config.tracked) || config.tracked.length === 0) {
    throw new Error(`tracked-sets.yaml: expected non-empty "tracked" array, got ${JSON.stringify(config)}`);
  }
  console.log(`Tracked sets: ${config.tracked.join(', ')}`);

  // 2. For each tracked set, fetch its card list, then each full card.
  const tcgdex = new TCGdex('en' as never);
  const rawCards: Array<{ id: string; pricing?: unknown }> = [];
  let failures = 0;
  let attempts = 0;

  for (const setId of config.tracked) {
    const setData = await tcgdex.fetch('sets', setId);
    if (!setData || !Array.isArray(setData.cards)) {
      throw new Error(`Set "${setId}" not found or has no cards at TCGdex — check tracked-sets.yaml`);
    }
    console.log(`Set ${setId}: ${setData.cards.length} cards`);
    for (const resume of setData.cards) {
      attempts++;
      try {
        const card = await tcgdex.fetch('cards', resume.id);
        if (card) rawCards.push(card as unknown as { id: string; pricing?: unknown });
      } catch (err) {
        failures++;
        console.warn(`Fetch failed for ${resume.id}: ${(err as Error).message}`);
      }
    }
  }

  // 3. Fail loud if more than half the fetches failed — something systemic is wrong.
  if (attempts > 0 && failures / attempts > 0.5) {
    throw new Error(`Fast-poll: ${failures}/${attempts} fetches failed — aborting to preserve last-known prices`);
  }

  // 4. Extract + validate + write.
  const priceRecords = extractPrices(rawCards as never);
  const priceFile: PriceFile = {
    generatedAt: new Date().toISOString(),
    records: Object.fromEntries(priceRecords.map((r) => [r.cardId, r])),
  };
  PriceFileSchema.parse(priceFile);
  writeFileSync(OUT_FILE, JSON.stringify(priceFile, null, 2));

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Wrote ${priceRecords.length} fresh price records to ${OUT_FILE} in ${secs}s`);
}

main().catch((err) => {
  console.error('Fast-poll failed:', err);
  process.exit(1);
});
```

- [ ] **Step 5: Create an empty initial `data/prices-fresh.json`**

```bash
cat > data/prices-fresh.json <<'EOF'
{
  "generatedAt": "2026-04-19T00:00:00.000Z",
  "records": {}
}
EOF
```

This bootstraps the file so local builds succeed before the first real fast-poll run.

- [ ] **Step 6: Smoke-test the fast-poll script against the live TCGdex API**

```bash
npm run fetch-prices-fresh
```

Expected output (timings vary):
```
Tracked sets: base1
Set base1: 102 cards
Wrote NN fresh price records to /Users/.../data/prices-fresh.json in X.Xs
```

Where `NN` is the count of Base Set cards with Cardmarket data (probably 80-102).

- [ ] **Step 7: Verify the file shape**

```bash
node -e 'const f=JSON.parse(require("fs").readFileSync("data/prices-fresh.json"));console.log("generatedAt:",f.generatedAt,"\nrecord count:",Object.keys(f.records).length,"\nfirst record:",JSON.stringify(Object.values(f.records)[0],null,2).slice(0,400))'
```

Expected: real Cardmarket prices in the first record.

- [ ] **Step 8: Commit**

```bash
git add tracked-sets.yaml scripts/fetch-prices-fresh.ts package.json package-lock.json data/prices-fresh.json
git commit -m "feat(prices): fast-poll script reading tracked-sets.yaml"
```

---

## Task 6: PriceChart Preact island

**Files:**
- Create: `src/components/PriceChart.tsx`
- Modify: `package.json` (add chart.js)

- [ ] **Step 1: Install chart.js**

```bash
npm install chart.js
```

- [ ] **Step 2: Create `src/components/PriceChart.tsx`**

```tsx
import { useEffect, useRef } from 'preact/hooks';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

type Point = { label: string; value: number };

export default function PriceChart({ points, currency }: { points: Point[]; currency: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const chart = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: points.map((p) => p.label),
        datasets: [
          {
            data: points.map((p) => p.value),
            borderColor: '#c86f3d',
            backgroundColor: 'rgba(200, 111, 61, 0.12)',
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#fffdf6',
            pointBorderColor: '#c86f3d',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => (items[0] ? (items[0].label as string) : ''),
              label: (ctx) => `${currency} ${(ctx.parsed.y as number).toFixed(2)}`,
            },
          },
        },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });
    return () => chart.destroy();
  }, [points, currency]);

  return (
    <div style={{ height: '50px', position: 'relative' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/PriceChart.tsx package.json package-lock.json
git commit -m "feat(ui): chart.js Preact island for price mini-chart"
```

---

## Task 7: PriceTile Astro component

**Files:**
- Create: `src/components/PriceTile.astro`

- [ ] **Step 1: Implement `src/components/PriceTile.astro`**

```astro
---
import PriceChart from '@/components/PriceChart';
import type { CardPriceRecord } from '@/data/price-schema';
import { trendVsAvg30 } from '@/data/price-delta';
import { freshnessBadge } from '@/data/price-freshness';

interface Props { record: CardPriceRecord }
const { record } = Astro.props;
const cm = record.sources.cardmarket;

// Type narrowing — PriceTile is only rendered when cm exists, but double-check.
if (!cm) throw new Error('PriceTile rendered without cardmarket source');

const delta = trendVsAvg30({ trend: cm.trend, avg30: cm.avg30 });
const badge = freshnessBadge({ updatedAt: cm.updatedAt });

const CURRENCY_GLYPH: Record<string, string> = { EUR: '€', USD: '$' };
const glyph = CURRENCY_GLYPH[cm.unit] ?? cm.unit;

// Build the 4-point chart: 30d avg → 7d avg → 1d avg → current trend.
// Skip points where the value is null (graceful degradation).
const chartPoints = [
  { label: '30d avg', value: cm.avg30 },
  { label: '7d avg', value: cm.avg7 },
  { label: '1d avg', value: cm.avg1 },
  { label: 'now', value: cm.trend },
].filter((p): p is { label: string; value: number } => p.value !== null);

const trendDisplay =
  cm.trend !== null
    ? `${glyph}${Math.floor(cm.trend)}.${Math.round((cm.trend - Math.floor(cm.trend)) * 100).toString().padStart(2, '0')}`
    : '— —';
---
<section class="price-tile" data-price-tile={record.cardId}>
  <div class="live-card" data-price-source="cardmarket">
    <header>
      <span class="src-label">Cardmarket</span>
      <span class={`badge badge-${badge.kind}`}>{badge.kind === 'live' ? '● LIVE' : badge.label}</span>
    </header>

    <div class="price-headline">
      <div class="price-number">{trendDisplay}</div>
      <div class="price-caption">trend price</div>
    </div>

    {chartPoints.length >= 2 && (
      <div class="price-chart-slot">
        <PriceChart client:visible points={chartPoints} currency={cm.unit} />
      </div>
    )}

    <div class="chart-legend">
      {cm.avg30 !== null && <span>30d avg {glyph}{Math.round(cm.avg30)}</span>}
      {cm.avg7 !== null && <span>7d {glyph}{Math.round(cm.avg7)}</span>}
      {cm.avg1 !== null && <span>1d {glyph}{Math.round(cm.avg1)}</span>}
      {cm.trend !== null && <span class="legend-now">now {glyph}{Math.round(cm.trend)}</span>}
    </div>

    {delta !== null && (
      <footer class="tile-footer">
        <div class="delta">
          <span class="delta-label">vs 30d avg</span>
          <span class={`delta-value delta-${delta.direction}`} data-delta-direction={delta.direction}>
            {delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '◆'} {glyph}{Math.abs(Math.round(delta.absolute))} · {delta.percent > 0 ? '+' : ''}{delta.percent.toFixed(1)}%
          </span>
        </div>
        <div class="src-footer">updated {badge.kind === 'live' ? 'just now' : badge.label.replace('updated ', '')}<br/>TCGdex → Cardmarket</div>
      </footer>
    )}
  </div>

  <div class="placeholder-card" aria-label="eBay integration reserved for v2.1">
    <header>
      <span class="src-label">eBay · completed sales</span>
    </header>
    <div class="price-headline">
      <div class="price-number muted">— —</div>
      <div class="price-caption">latest sale (USD)</div>
    </div>
    <div class="placeholder-body">awaiting v2.1 integration</div>
    <footer class="tile-footer">
      <div class="placeholder-note">Cross-source delta, regional arbitrage signals, and multi-source time-series plot here once live.</div>
    </footer>
  </div>
</section>

<style>
  .price-tile {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 1.5rem;
  }
  @media (max-width: 720px) {
    .price-tile { grid-template-columns: 1fr; }
  }

  .live-card, .placeholder-card {
    border-radius: 12px;
    padding: 14px 16px;
    font-family: 'Helvetica Neue', system-ui, sans-serif;
  }
  .live-card {
    background: linear-gradient(180deg, #fffdf6, #f5efe2);
    border: 1px solid #d9c9a3;
  }
  .placeholder-card {
    background: repeating-linear-gradient(45deg, #fffdf6, #fffdf6 6px, #faf3e4 6px, #faf3e4 12px);
    border: 1px dashed #d9c9a3;
    color: #a89878;
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .src-label {
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #7a5e3a;
  }
  .badge {
    font-size: 9px;
    padding: 2px 8px;
    border-radius: 10px;
  }
  .badge-live { color: #2d7d47; background: #e5f2e8; }
  .badge-recent { color: #7a5e3a; }
  .badge-stale { color: #a84b1f; }

  .price-headline { margin-top: 4px; }
  .price-number { font-size: 28px; font-weight: 700; color: #3b2a1a; line-height: 1; }
  .price-number.muted { color: #bfb09b; }
  .price-caption { font-size: 11px; color: #5a4a36; margin-top: 2px; }

  .price-chart-slot { margin-top: 10px; }

  .chart-legend {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #7a5e3a;
    letter-spacing: 1px;
    margin-top: 2px;
  }
  .legend-now { color: #c86f3d; font-weight: 600; }

  .tile-footer {
    border-top: 1px solid #e8ddc6;
    margin-top: 10px;
    padding-top: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .placeholder-card .tile-footer { border-top-style: dashed; }

  .delta-label { display: block; font-size: 10px; color: #7a5e3a; }
  .delta-value { font-size: 14px; font-weight: 600; }
  .delta-up { color: #2d7d47; }
  .delta-down { color: #c86f3d; }
  .delta-flat { color: #7a5e3a; }
  .src-footer {
    font-size: 10px;
    color: #7a5e3a;
    text-align: right;
    line-height: 1.4;
  }

  .placeholder-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin: 10px 0;
    color: #bfb09b;
  }
  .placeholder-note { font-size: 10px; line-height: 1.5; }
</style>
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/PriceTile.astro
git commit -m "feat(ui): PriceTile Astro component with chart slot and reserved eBay placeholder"
```

---

## Task 8: Integrate PriceTile into the card detail page + E2E

**Files:**
- Modify: `src/pages/card/[id].astro`
- Create: `tests/e2e/price-tile.spec.ts`

- [ ] **Step 1: Modify `src/pages/card/[id].astro` to load prices and render PriceTile**

Read the file first. Replace the frontmatter block (between the `---` fences) with:

```ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Base from '@/layouts/Base.astro';
import PrintGallery from '@/components/PrintGallery.astro';
import PriceTile from '@/components/PriceTile.astro';
import type { CardIdentity } from '@/data/schema';
import type { PriceFile, CardPriceRecord } from '@/data/price-schema';
import { mergePrices } from '@/data/price-merge';

export async function getStaticPaths() {
  const cards: CardIdentity[] = JSON.parse(
    readFileSync(resolve(process.cwd(), 'data/cards.json'), 'utf8'),
  );

  // Load both price files; either may be absent for a fresh checkout.
  const baselinePath = resolve(process.cwd(), 'data/prices-baseline.json');
  const freshPath = resolve(process.cwd(), 'data/prices-fresh.json');
  const empty: PriceFile = { generatedAt: new Date(0).toISOString(), records: {} };
  const baseline: PriceFile = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : empty;
  const fresh: PriceFile = existsSync(freshPath) ? JSON.parse(readFileSync(freshPath, 'utf8')) : empty;
  const merged = mergePrices(baseline, fresh);

  return cards.map((card) => ({
    params: { id: card.id },
    props: { card, priceRecord: merged[card.id] ?? null },
  }));
}

interface Props { card: CardIdentity; priceRecord: CardPriceRecord | null }
const { card, priceRecord } = Astro.props;
```

Then replace the existing card-page body template with:

```astro
<Base title={`${card.defaultName} — Pokémon TCG Catalog`}>
  <article data-pagefind-body data-pagefind-meta={`title:${card.defaultName}`}>
    <h1>{card.defaultName}</h1>
    <PrintGallery card={card} />
    {priceRecord !== null && priceRecord.sources.cardmarket && (
      <PriceTile record={priceRecord} />
    )}
    <div style="position:absolute;left:-9999px" aria-hidden="true">
      {card.searchTokens.join(' ')}
    </div>
    <aside>
      <p>Set: {card.filters.setId}</p>
      <p>Rarity: {card.filters.rarity}</p>
      <p>Types: {card.filters.types.join(', ') || '—'}</p>
    </aside>
  </article>
</Base>
```

- [ ] **Step 2: Write failing e2e tests — `tests/e2e/price-tile.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('card page with cardmarket data renders the PriceTile with chart + delta', async ({ page }) => {
  await page.goto('card/base1-4');

  const tile = page.locator('.price-tile');
  await expect(tile).toBeVisible();

  const live = tile.locator('.live-card');
  await expect(live).toBeVisible();
  await expect(live.locator('.src-label').first()).toHaveText('Cardmarket');
  await expect(live.locator('.price-number').first()).toContainText(/€[0-9]/);

  // Chart canvas hydrates on visibility.
  const canvas = live.locator('canvas');
  await expect(canvas).toBeVisible();

  // Delta should be present with a direction indicator.
  const delta = live.locator('.delta-value');
  await expect(delta).toBeVisible();
  await expect(delta).toHaveAttribute('data-delta-direction', /(up|down|flat)/);
});

test('card page with no pricing data does not render the PriceTile', async ({ page }) => {
  await page.goto('card/base1-2');
  await expect(page.locator('.price-tile')).toHaveCount(0);
});

test('eBay placeholder is rendered alongside the live tile for v2.1 forward-compat', async ({ page }) => {
  await page.goto('card/base1-4');
  const placeholder = page.locator('.price-tile .placeholder-card');
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toContainText(/awaiting v2\.1/i);
  await expect(placeholder.locator('.src-label').first()).toContainText(/eBay/i);
});
```

- [ ] **Step 3: Run a full rebuild + e2e**

```bash
npm run build:fixtures
npx playwright test tests/e2e/price-tile.spec.ts --reporter=list
```

Expected: 3 new tests pass. Existing e2e tests should also still pass — run the full suite next to confirm.

- [ ] **Step 4: Run the full e2e suite for regression**

```bash
npx playwright test --reporter=list
```

Expected: 16/16 pass (13 existing + 3 new).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/pages/card/[id].astro tests/e2e/price-tile.spec.ts
git commit -m "feat(ui): render PriceTile on card pages when pricing data exists"
```

---

## Task 9: Fast-poll GitHub Actions workflow + build.yml paths-ignore

**Files:**
- Create: `.github/workflows/prices-fast-poll.yml`
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Add `paths-ignore` to `build.yml` so price-only commits don't trigger it**

Read `.github/workflows/build.yml`. Modify the `on.push` block to exclude price-fresh updates. Replace:

```yaml
  push:
    branches: [main]
```

with:

```yaml
  push:
    branches: [main]
    paths-ignore:
      - 'data/prices-fresh.json'
```

Leave everything else in `build.yml` untouched.

- [ ] **Step 2: Create `.github/workflows/prices-fast-poll.yml`**

```yaml
name: prices-fast-poll

on:
  schedule:
    - cron: '*/5 * * * *'     # every 5 minutes
  workflow_dispatch: {}

permissions:
  contents: write             # needs to commit data/prices-fresh.json
  pages: write
  id-token: write

concurrency:
  group: price-update
  cancel-in-progress: false   # let runs queue, don't drop updates

jobs:
  poll-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Fetch fresh prices
        run: npm run fetch-prices-fresh

      - name: Commit prices-fresh.json if changed
        run: |
          if git diff --quiet data/prices-fresh.json; then
            echo "No price changes — skipping commit and deploy."
            echo "changed=false" >> "$GITHUB_OUTPUT"
          else
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add data/prices-fresh.json
            git commit -m "chore(prices): update fresh prices"
            git push
            echo "changed=true" >> "$GITHUB_OUTPUT"
          fi
        id: commit

      - name: Build (fixture-mode pipeline, picks up fresh prices via merge)
        if: steps.commit.outputs.changed == 'true'
        run: npm run build:fixtures
        env:
          PUBLIC_BUILD_TIMESTAMP: ${{ github.run_started_at }}

      - uses: actions/upload-pages-artifact@v3
        if: steps.commit.outputs.changed == 'true'
        with: { path: dist }

  deploy:
    needs: poll-and-deploy
    if: needs.poll-and-deploy.result == 'success'
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/prices-fast-poll.yml .github/workflows/build.yml
git commit -m "ci: add 5-minute fast-poll workflow for prices and exclude prices-fresh.json from regular build trigger"
```

- [ ] **Step 4: Push to origin and manually trigger the workflow once to smoke-test**

```bash
git push origin main
```

Then in the GitHub UI: Actions tab → `prices-fast-poll` → "Run workflow". Watch the run. Expected: succeeds, commits an updated `data/prices-fresh.json` if Cardmarket data has changed, and deploys. (If no Cardmarket values have moved since the last run, the workflow skips the commit + deploy — that's the `if: steps.commit.outputs.changed == 'true'` guard.)

- [ ] **Step 5: Verify the live site shows live prices**

After the workflow's deploy step succeeds (usually ~30-60 s after the build step), visit https://davstaylor.github.io/pokemon-tcg/card/base1-4/ and confirm:

- PriceTile renders with a Cardmarket EUR number
- Chart mini-line is visible
- Delta indicator (▲ / ▼) is present
- Freshness badge shows `● LIVE` (if the fast-poll just ran) or `updated Nh ago` otherwise
- The dashed eBay placeholder is visible alongside

- [ ] **Step 6: No additional commit unless a post-deploy fix was needed.**

---

## Self-review checklist (done by writer before handoff)

**Spec coverage:**

| Spec § | Covered in task(s) |
| --- | --- |
| §1 Vision | Implicit throughout |
| §2 Milestone decomposition | v2.0 is in scope; v2.1/v2.2 explicitly deferred. UI placeholder (Task 7) signals the roadmap. |
| §3 Architecture | Task 3 (baseline file in nightly), Task 5 (fast-poll), Task 8 (merge at build time), Task 9 (CI) |
| §4 Schema | Task 1 |
| §5 Tracked scope | Task 5 (tracked-sets.yaml, fast-poll script) |
| §6.1 PriceTile | Task 7 |
| §6.2 chart.js | Task 6 + Task 7 (client:visible integration) |
| §6.3 Freshness badge | Task 4 (freshness util) + Task 7 (rendering) |
| §6.4 Placement | Task 8 |
| §6.5 Home page out of scope | Confirmed — no task touches home page |
| §7 Error handling | Task 5 (>50% failure threshold, yaml validation), Task 1 (Zod schema validation), Task 9 (concurrency group) |
| §8 Testing | Task 1 (schema), Task 4 (merge/delta/freshness), Task 8 (e2e) |
| §9 Disclaimers | Existing v1 footer covered; card-page disclaimer is part of PriceTile template in Task 7 ("TCGdex → Cardmarket") |
| §10 Key decisions | Embedded in this plan's Context block and per-task rationales |

**Placeholder scan:** no "TBD", "similar to Task N", or "add appropriate error handling" phrases. Every step has concrete code or commands.

**Type consistency:** `CardPriceRecord`, `PriceFile`, `CardMarketPrice` defined in Task 1 and imported identically in Tasks 2, 3, 4, 5, 7, 8. `mergePrices` signature matches at callsite in Task 8. `PriceChart` prop types match between Task 6 (definition) and Task 7 (callsite).

**Known risks / notes for executor:**
- The fast-poll workflow commits to main every time Cardmarket values change, which at 5-min cadence is basically every run. That's fine but worth noting for anyone reviewing git log.
- `build:fixtures` is used in `prices-fast-poll.yml` deliberately — the fast-poll workflow doesn't fetch the full catalog, it just uses the fixture-backed cards.json from whatever state main is in. This aligns with the current "CI switched to fixtures" state from `6194252`. When that's eventually flipped back to `npm run build` (live fetch), this workflow will need to follow suit.

---

## Estimated effort

| Task | Effort |
| --- | --- |
| 1 Schema + tests | 25 min |
| 2 Extractor + fixture + tests | 30 min |
| 3 Extend nightly build | 20 min |
| 4 Merge/delta/freshness utilities | 45 min |
| 5 Fast-poll script + tracked yaml | 60 min |
| 6 PriceChart island | 30 min |
| 7 PriceTile component | 45 min |
| 8 Card-page integration + e2e | 45 min |
| 9 Workflows + smoke-test deploy | 30 min |
| **Total** | **~5½ hours** |

Realistically a single focused afternoon, including investigation time.
