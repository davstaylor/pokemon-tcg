# Set & Series Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browse-by-set and browse-by-series pages (three new route families) plus automatic sitemap generation, all as a pure view layer over the existing `data/cards.json`.

**Architecture:** No new data sources. Three new Astro route families (`/set/[setId]/`, `/series/[seriesId]/`, `/sets/`) use `getStaticPaths()` to iterate groupings of the existing 23k `CardIdentity` records. Two pure helper modules (`set-sort.ts`, `set-groups.ts`) do the data shaping at build time. `@astrojs/sitemap` auto-indexes every route.

**Tech Stack:** Astro 6 SSG, Preact (no new islands needed), TypeScript strict, Vitest for unit, Playwright for e2e, `@astrojs/sitemap` (new dev dep).

---

## Spec Reference

Design doc: `docs/superpowers/specs/2026-04-20-pokemon-tcg-set-series-pages-design.md` — read before starting.

## Key Codebase Conventions

**You do NOT need to read these files — they're summarised here. Read them only if a task fails.**

- **Path alias:** `@/*` → `src/*` (configured in `tsconfig.json`).
- **Fixture data:** Tests run against `data/fixtures/sample-cards.json`, which is normalised into `data/cards.json` by `npm run build:fixtures-empty-prices`. The fixture contains:
  - 2 cards both in set `base1` (set name: `"Base"`, not `"Base Set"` — the fixture uses the abbreviation)
  - Cards: `base1-4` (Charizard, all 11 languages) and `base1-2` (Blastoise, EN only)
  - `set.releaseDate = "1999-01-09"`, `set.id = "base1"`, `set.name = "Base"`
  - Series ID derived from set ID prefix → `"base"`
- **Existing URL style in Astro templates:** hardcoded base, e.g. `href={`/pokemon-tcg/card/${card.id}`}` in `src/components/CardTile.astro:9` and `action="/pokemon-tcg/search"` in `src/pages/index.astro:17`. Follow this pattern in new Astro files. (`.tsx` islands use `import.meta.env.BASE_URL` instead — don't cross the streams.)
- **Playwright `baseURL`:** `http://localhost:4321/pokemon-tcg/` (trailing slash). In tests, `page.goto('set/base1/')` resolves to `http://localhost:4321/pokemon-tcg/set/base1/`. Use **relative paths without leading slash**, **with trailing slash** for route folders.
- **Existing `CardIdentity` schema** (`src/data/schema.ts`): has `id`, `defaultName`, `prints` (`Partial<Record<Language, PrintData>>`), `searchTokens`, `filters: { setId, setName, rarity, types, series }`. `PrintData` has `setName`, `setSymbol`, `releaseDate` (and other fields).
- **Normalise `deriveSeriesId`** (`src/data/normalise.ts:32`): derives e.g. `"swsh"` from set ID `"swsh1"`. Live TCGdex API does not expose a human series name, so `filters.series` is always the short ID.
- **Series name resolution rule** (from spec): the display name for a series is the `setName` of the **earliest-released set** within that series (e.g. `swsh` → `"Sword & Shield"`). For the fixture's single `"base"` series, this resolves to `"Base"`.
- **Existing card page (`src/pages/card/[id].astro:87`)** currently shows the set as plain text:
  `<p>Set: {card.filters.setName} <span style="color:#7a5e3a;font-size:0.8rem">({card.filters.setId})</span></p>`
- **Home page (`src/pages/index.astro`)** has a hero + featured grid + search stub. Currently no link to any browse view.
- **Unit test runner:** `npm run test:unit` (Vitest). Tests live in `tests/unit/*.test.ts`, imports via `@/` alias.
- **E2E runner:** `npm run test:e2e` (Playwright). Webserver is auto-started by Playwright via the `build:fixtures-empty-prices` + `preview` scripts (see `playwright.config.ts`).
- **Astro config (`astro.config.mjs`):** `site: 'https://davstaylor.github.io'`, `base: '/pokemon-tcg'`, integrations `[preact()]`, `output: 'static'`.
- **tsconfig `exclude`:** `["workers", "dist", ".astro", "node_modules"]` — don't put files where tsc will choke.

## File Structure

**Create:**
- `src/data/set-sort.ts` — numeric-aware `compareLocalIds(a, b)` comparator. One function, ~15 lines.
- `src/data/set-groups.ts` — pure data-shaping helpers. Exports: `SetPageData`, `SeriesSummary`, `groupCardsBySet(cards)`, `groupSetsBySeries(cards)`. ~100 lines.
- `src/components/SetHeader.astro` — visual header block (logo, name, count, release date). Used only on `/set/[setId]/`.
- `src/pages/set/[setId].astro` — one page per set, grid of card tiles.
- `src/pages/series/[seriesId].astro` — one page per series, list of set summaries.
- `src/pages/sets/index.astro` — top-level browse index of all series.
- `tests/unit/set-sorting.test.ts` — unit tests for `compareLocalIds`.
- `tests/e2e/set-pages.spec.ts` — e2e tests for all three route families.

**Modify:**
- `src/pages/card/[id].astro` — set line becomes a link to `/set/{setId}/`.
- `src/pages/index.astro` — add `Browse all sets →` link at the bottom of the featured section.
- `tests/e2e/card-page.spec.ts` — add test asserting the set link.
- `tests/e2e/home.spec.ts` — add test asserting the new Browse link.
- `astro.config.mjs` — add `@astrojs/sitemap` integration.
- `package.json` — new dev dep `@astrojs/sitemap`.

---

## Task 1: Numeric-aware local ID comparator

**Files:**
- Create: `src/data/set-sort.ts`
- Test: `tests/unit/set-sorting.test.ts`

Pure function, no external deps. Foundational — every set-page card grid relies on it.

- [ ] **Step 1.1: Write the failing unit test**

Create `tests/unit/set-sorting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compareLocalIds } from '@/data/set-sort';

describe('compareLocalIds', () => {
  it('sorts pure numeric ascending (2 before 10 before 100)', () => {
    const ids = ['100', '2', '10'];
    expect([...ids].sort(compareLocalIds)).toEqual(['2', '10', '100']);
  });

  it('places pure numeric before any alpha id', () => {
    const ids = ['TG1', '4', 'SWSH01', '10'];
    expect([...ids].sort(compareLocalIds)).toEqual(['4', '10', 'SWSH01', 'TG1']);
  });

  it('sorts alpha ids lexicographically (SWSH01 before SWSH02)', () => {
    const ids = ['SWSH02', 'SWSH01', 'SWSH10'];
    expect([...ids].sort(compareLocalIds)).toEqual(['SWSH01', 'SWSH02', 'SWSH10']);
  });

  it('returns 0 for equal ids (tied values stay put under a stable sort)', () => {
    expect(compareLocalIds('4', '4')).toBe(0);
    expect(compareLocalIds('H1', 'H1')).toBe(0);
  });

  it('does not treat "007" as numeric — String(7) !== "007" — so it sorts alpha', () => {
    // "007" -> parseInt gives 7, but String(7) is "7" which doesn't equal "007",
    // so it's treated as alpha. That's acceptable: leading-zero ids are rare and
    // behave consistently (all alpha-sorted together).
    const ids = ['007', '7', '10'];
    const sorted = [...ids].sort(compareLocalIds);
    // 7 and 10 are numeric and come first; "007" is alpha and comes last.
    expect(sorted).toEqual(['7', '10', '007']);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npm run test:unit -- set-sorting`
Expected: FAIL with `Error: Failed to load url @/data/set-sort` or similar module-not-found.

- [ ] **Step 1.3: Implement `compareLocalIds`**

Create `src/data/set-sort.ts`:

```ts
// Numeric-aware collation for card collector numbers.
//
// TCGdex's `localId` is a string that is either a pure integer ("4", "10")
// or contains letters ("SWSH01", "TG1", "H1"). Sorting by string would put
// "10" before "2"; sorting by parseInt would lose the alpha suffix. This
// comparator does the expected thing: pure numeric ascending, then alpha,
// with both sections ordered predictably.
export function compareLocalIds(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  const aNumeric = Number.isFinite(na) && String(na) === a;
  const bNumeric = Number.isFinite(nb) && String(nb) === b;
  if (aNumeric && bNumeric) return na - nb;
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a.localeCompare(b);
}
```

- [ ] **Step 1.4: Run tests to verify all pass**

Run: `npm run test:unit -- set-sorting`
Expected: PASS (5 tests).

- [ ] **Step 1.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 1.6: Commit**

```bash
git add src/data/set-sort.ts tests/unit/set-sorting.test.ts
git commit -m "feat(set-pages): add compareLocalIds numeric-aware comparator"
```

---

## Task 2: Data-shaping helpers (`set-groups.ts`)

**Files:**
- Create: `src/data/set-groups.ts`

Pure functions that group `CardIdentity[]` into set-keyed and series-keyed structures the route files consume. No tests here — the spec defers grouping-correctness verification to the e2e tests (Tasks 4-6). If a grouping bug does surface, an e2e failure will flag it.

- [ ] **Step 2.1: Create `src/data/set-groups.ts` with types, helpers, and both grouping functions**

```ts
import type { CardIdentity } from './schema';
import { SUPPORTED_LANGUAGES } from './schema';
import { compareLocalIds } from './set-sort';

// ---- Public types ----

export interface SetSummary {
  setId: string;
  setName: string;    // from filters.setName, or empty string fallback
  setSymbol: string;  // from first available print, '' if none
  releaseDate: string; // ISO date, '' if none
  seriesId: string;
  cardCount: number;
}

export interface SeriesSummary {
  seriesId: string;
  seriesName: string;   // derived: earliest-released set's setName
  setCount: number;
  cardCount: number;
  sets: SetSummary[];   // sorted newest-first by releaseDate
}

export interface SetPageData extends SetSummary {
  seriesName: string;
  cards: CardIdentity[]; // sorted by numeric-aware compareLocalIds on localId
}

// ---- Helpers ----

// Cards are "{setId}-{localId}", e.g. "base1-4" or "swsh12-TG01".
// Strip the known setId prefix to isolate the localId segment.
export function extractLocalId(cardId: string, setId: string): string {
  const prefix = `${setId}-`;
  return cardId.startsWith(prefix) ? cardId.slice(prefix.length) : cardId;
}

// setSymbol and releaseDate come from the first available print, preferring EN
// (TCGdex's canonical language). Falls back to the language-priority order
// defined in SUPPORTED_LANGUAGES. Returns empty strings if no print has data
// (shouldn't happen under PrintsSchema's "at least one print" refine, but
// defensive).
function pickSetMeta(card: CardIdentity): { setSymbol: string; releaseDate: string } {
  for (const lang of SUPPORTED_LANGUAGES) {
    const p = card.prints[lang];
    if (p) return { setSymbol: p.setSymbol, releaseDate: p.releaseDate };
  }
  return { setSymbol: '', releaseDate: '' };
}

// ---- Core groupings ----

export function groupCardsBySet(cards: CardIdentity[]): Map<string, SetPageData> {
  // First pass: bucket cards by setId, capturing set-level metadata from the
  // first card we see in each set.
  interface WorkingSet {
    cards: CardIdentity[];
    setName: string;
    seriesId: string;
    setSymbol: string;
    releaseDate: string;
  }
  const working = new Map<string, WorkingSet>();

  for (const card of cards) {
    const setId = card.filters.setId;
    let group = working.get(setId);
    if (!group) {
      const { setSymbol, releaseDate } = pickSetMeta(card);
      group = {
        cards: [],
        setName: card.filters.setName,
        seriesId: card.filters.series,
        setSymbol,
        releaseDate,
      };
      working.set(setId, group);
    }
    group.cards.push(card);
  }

  // Build series-name lookup: for each seriesId, the earliest-released set's
  // setName wins. Ties on releaseDate fall through to first-seen (Map insertion
  // order), which is deterministic given the stable input.
  const seriesNames = new Map<string, { name: string; releaseDate: string }>();
  for (const g of working.values()) {
    const existing = seriesNames.get(g.seriesId);
    if (!existing || (g.releaseDate && g.releaseDate < existing.releaseDate)) {
      seriesNames.set(g.seriesId, { name: g.setName || g.seriesId, releaseDate: g.releaseDate });
    }
  }

  // Second pass: sort cards within each set; emit final SetPageData.
  const result = new Map<string, SetPageData>();
  for (const [setId, g] of working) {
    const sortedCards = [...g.cards].sort((a, b) =>
      compareLocalIds(extractLocalId(a.id, setId), extractLocalId(b.id, setId)),
    );
    result.set(setId, {
      setId,
      setName: g.setName,
      setSymbol: g.setSymbol,
      releaseDate: g.releaseDate,
      seriesId: g.seriesId,
      seriesName: seriesNames.get(g.seriesId)?.name ?? g.seriesId,
      cardCount: sortedCards.length,
      cards: sortedCards,
    });
  }

  return result;
}

export function groupSetsBySeries(cards: CardIdentity[]): Map<string, SeriesSummary> {
  const bySet = groupCardsBySet(cards);

  // Regroup the sets under their series.
  interface WorkingSeries { seriesName: string; sets: SetSummary[] }
  const working = new Map<string, WorkingSeries>();

  for (const data of bySet.values()) {
    let group = working.get(data.seriesId);
    if (!group) {
      group = { seriesName: data.seriesName, sets: [] };
      working.set(data.seriesId, group);
    }
    group.sets.push({
      setId: data.setId,
      setName: data.setName,
      setSymbol: data.setSymbol,
      releaseDate: data.releaseDate,
      seriesId: data.seriesId,
      cardCount: data.cardCount,
    });
  }

  // Sort sets within each series newest-first (descending releaseDate).
  // Empty releaseDate sorts last under string-descending comparison.
  const result = new Map<string, SeriesSummary>();
  for (const [seriesId, g] of working) {
    const sortedSets = [...g.sets].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
    result.set(seriesId, {
      seriesId,
      seriesName: g.seriesName,
      setCount: sortedSets.length,
      cardCount: sortedSets.reduce((acc, s) => acc + s.cardCount, 0),
      sets: sortedSets,
    });
  }

  return result;
}
```

- [ ] **Step 2.2: Typecheck to verify no errors**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 2.3: Run existing unit tests to confirm nothing regressed**

Run: `npm run test:unit`
Expected: all existing tests PASS, no new tests yet.

- [ ] **Step 2.4: Commit**

```bash
git add src/data/set-groups.ts
git commit -m "feat(set-pages): add set-groups data-shaping helpers"
```

---

## Task 3: `SetHeader` component

**Files:**
- Create: `src/components/SetHeader.astro`

Small presentational component. Used only on `/set/[setId]/` (Task 4). No tests at this layer — covered by the set-page e2e in Task 4.

- [ ] **Step 3.1: Create the component**

Create `src/components/SetHeader.astro`:

```astro
---
interface Props {
  setName: string;
  setSymbol: string;
  cardCount: number;
  releaseDate: string;
}
const { setName, setSymbol, cardCount, releaseDate } = Astro.props;

// Match CardTile's image-error convention: JS removes the <img> when it fails,
// so no broken-image icon shows. Fine if JS is disabled — user just sees the
// browser's default broken-image rendering, which we accept.
const ON_IMG_ERROR = 'this.onerror=null; this.remove();';
---
<header class="set-header">
  {setSymbol && (
    <img class="symbol" src={setSymbol} alt="" loading="eager" onerror={ON_IMG_ERROR} />
  )}
  <div class="set-header-body">
    <h1>{setName || 'Unknown set'}</h1>
    <p class="meta">
      {cardCount} {cardCount === 1 ? 'card' : 'cards'}
      {releaseDate && <span> · released {releaseDate}</span>}
    </p>
  </div>
</header>

<style>
  .set-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; }
  .set-header .symbol { width: 64px; height: 64px; object-fit: contain; flex: 0 0 auto; }
  .set-header h1 { margin: 0; }
  .set-header .meta { color: var(--muted); margin: 0.25rem 0 0; }
</style>
```

- [ ] **Step 3.2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3.3: Commit**

```bash
git add src/components/SetHeader.astro
git commit -m "feat(set-pages): add SetHeader component"
```

---

## Task 4: Per-set page `/set/[setId]/`

**Files:**
- Create: `src/pages/set/[setId].astro`
- Create: `tests/e2e/set-pages.spec.ts`

Render a grid of cards for a given set, with a breadcrumb back to the series.

- [ ] **Step 4.1: Write the failing e2e test**

Create `tests/e2e/set-pages.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('set page /set/base1/ renders header and card grid', async ({ page }) => {
  await page.goto('set/base1/');
  // Fixture set name is "Base" (not "Base Set") — fixture uses the abbreviation.
  await expect(page.locator('h1')).toHaveText('Base');
  await expect(page.locator('.set-header .meta')).toContainText('2 cards');
  await expect(page.locator('.card-tile')).toHaveCount(2);

  // Breadcrumb points up to the series page.
  const crumb = page.locator('.breadcrumb a');
  await expect(crumb).toHaveAttribute('href', /\/pokemon-tcg\/series\/base\/$/);
  await expect(crumb).toContainText('Base');
});

test('set page sorts cards by local id (base1-2 before base1-4)', async ({ page }) => {
  await page.goto('set/base1/');
  // Fixture has Blastoise (localId 2) and Charizard (localId 4); after
  // numeric-aware sort, Blastoise must appear first.
  const tiles = page.locator('.card-tile strong');
  await expect(tiles.first()).toHaveText('Blastoise');
  await expect(tiles.nth(1)).toHaveText('Charizard');
});
```

- [ ] **Step 4.2: Run the test to verify it fails**

Run: `npm run test:e2e -- set-pages`
Expected: FAIL (route `/set/base1/` returns 404 because the page doesn't exist yet).

- [ ] **Step 4.3: Create the per-set page**

Create `src/pages/set/[setId].astro`:

```astro
---
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Base from '@/layouts/Base.astro';
import CardTile from '@/components/CardTile.astro';
import SetHeader from '@/components/SetHeader.astro';
import type { CardIdentity } from '@/data/schema';
import { groupCardsBySet, type SetPageData } from '@/data/set-groups';

export async function getStaticPaths() {
  const cards: CardIdentity[] = JSON.parse(
    readFileSync(resolve(process.cwd(), 'data/cards.json'), 'utf8'),
  );
  const bySet = groupCardsBySet(cards);
  return Array.from(bySet.entries()).map(([setId, data]) => ({
    params: { setId },
    props: { data },
  }));
}

interface Props { data: SetPageData }
const { data } = Astro.props;

const title = `${data.setName || data.setId} — Pokémon TCG Catalog`;
const releasedClause = data.releaseDate ? `, released ${data.releaseDate}` : '';
const seriesClause = data.seriesName ? ` ${data.seriesName} series.` : '';
const description = `All ${data.cardCount} cards from ${data.setName || data.setId}${releasedClause}.${seriesClause}`;
---
<Base title={title} description={description}>
  <nav class="breadcrumb">
    <a href={`/pokemon-tcg/series/${data.seriesId}/`}>← {data.seriesName} series</a>
  </nav>
  <SetHeader
    setName={data.setName}
    setSymbol={data.setSymbol}
    cardCount={data.cardCount}
    releaseDate={data.releaseDate}
  />
  <div class="card-grid">
    {data.cards.map((card) => <CardTile card={card} />)}
  </div>
</Base>

<style>
  .breadcrumb { margin-bottom: 1rem; font-size: 0.9rem; }
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1.5rem;
  }
</style>
```

- [ ] **Step 4.4: Run the test to verify it passes**

Run: `npm run test:e2e -- set-pages`
Expected: PASS (both tests for `/set/base1/`).

- [ ] **Step 4.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4.6: Commit**

```bash
git add src/pages/set/[setId].astro tests/e2e/set-pages.spec.ts
git commit -m "feat(set-pages): add /set/[setId]/ card-grid page"
```

---

## Task 5: Per-series page `/series/[seriesId]/`

**Files:**
- Create: `src/pages/series/[seriesId].astro`
- Modify: `tests/e2e/set-pages.spec.ts`

List every set in a series, newest-first, each linking to its `/set/[setId]/`.

- [ ] **Step 5.1: Append the failing e2e test to `tests/e2e/set-pages.spec.ts`**

Append to `tests/e2e/set-pages.spec.ts`:

```ts
test('series page /series/base/ lists sets linking to /set/[setId]/', async ({ page }) => {
  await page.goto('series/base/');
  // Fixture series "base" has only set "base1" (name "Base").
  await expect(page.locator('h1')).toHaveText('Base');
  await expect(page.locator('.series-header .meta')).toContainText('1 set');
  await expect(page.locator('.series-header .meta')).toContainText('2 cards');

  const firstLink = page.locator('.set-list a').first();
  await expect(firstLink).toHaveAttribute('href', /\/pokemon-tcg\/set\/base1\/$/);
  await expect(firstLink).toContainText('Base');
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run: `npm run test:e2e -- set-pages`
Expected: FAIL (route `/series/base/` returns 404). The two earlier set-page tests should still pass.

- [ ] **Step 5.3: Create the per-series page**

Create `src/pages/series/[seriesId].astro`:

```astro
---
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Base from '@/layouts/Base.astro';
import type { CardIdentity } from '@/data/schema';
import { groupSetsBySeries, type SeriesSummary } from '@/data/set-groups';

export async function getStaticPaths() {
  const cards: CardIdentity[] = JSON.parse(
    readFileSync(resolve(process.cwd(), 'data/cards.json'), 'utf8'),
  );
  const bySeries = groupSetsBySeries(cards);
  return Array.from(bySeries.entries()).map(([seriesId, data]) => ({
    params: { seriesId },
    props: { data },
  }));
}

interface Props { data: SeriesSummary }
const { data } = Astro.props;

const title = `${data.seriesName} series — Pokémon TCG Catalog`;
const description = `${data.setCount} ${data.setCount === 1 ? 'set' : 'sets'} and ${data.cardCount} cards in the ${data.seriesName} series of Pokémon TCG.`;

const ON_IMG_ERROR = 'this.onerror=null; this.remove();';
---
<Base title={title} description={description}>
  <header class="series-header">
    <h1>{data.seriesName}</h1>
    <p class="meta">
      {data.setCount} {data.setCount === 1 ? 'set' : 'sets'} · {data.cardCount} cards
    </p>
  </header>
  <ul class="set-list">
    {data.sets.map((s) => (
      <li>
        <a href={`/pokemon-tcg/set/${s.setId}/`} class="set-row">
          {s.setSymbol && (
            <img class="symbol" src={s.setSymbol} alt="" loading="lazy" onerror={ON_IMG_ERROR} />
          )}
          <div class="set-row-body">
            <strong>{s.setName || s.setId}</strong>
            <span class="meta">
              {s.cardCount} cards{s.releaseDate ? ` · ${s.releaseDate}` : ''}
            </span>
          </div>
        </a>
      </li>
    ))}
  </ul>
</Base>

<style>
  .series-header { margin-bottom: 2rem; }
  .series-header h1 { margin-bottom: 0.25rem; }
  .series-header .meta { color: var(--muted); margin: 0; }
  .set-list { list-style: none; padding: 0; margin: 0; }
  .set-list li { border-top: 1px solid #e8ddc6; }
  .set-list li:last-child { border-bottom: 1px solid #e8ddc6; }
  .set-row {
    display: flex; align-items: center; gap: 1rem;
    padding: 1rem 0.5rem; text-decoration: none; color: inherit;
  }
  .set-row:hover { background: var(--paper); }
  .set-row .symbol { width: 40px; height: 40px; object-fit: contain; flex: 0 0 auto; }
  .set-row strong { display: block; }
  .set-row .meta { display: block; color: var(--muted); font-size: 0.85rem; }
</style>
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `npm run test:e2e -- set-pages`
Expected: PASS (all three set-page tests now pass).

- [ ] **Step 5.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5.6: Commit**

```bash
git add src/pages/series/[seriesId].astro tests/e2e/set-pages.spec.ts
git commit -m "feat(set-pages): add /series/[seriesId]/ set-list page"
```

---

## Task 6: Top-level sets index `/sets/`

**Files:**
- Create: `src/pages/sets/index.astro`
- Modify: `tests/e2e/set-pages.spec.ts`

Single page listing all series as clickable tiles, ordered newest-first by most-recent set.

- [ ] **Step 6.1: Append the failing e2e test to `tests/e2e/set-pages.spec.ts`**

Append to `tests/e2e/set-pages.spec.ts`:

```ts
test('sets index /sets/ lists every series as a tile', async ({ page }) => {
  await page.goto('sets/');
  await expect(page.locator('h1')).toHaveText('All sets');
  // Fixture: only "base" series exists.
  const tiles = page.locator('.series-tile');
  await expect(tiles).toHaveCount(1);
  await expect(tiles.first()).toContainText('Base');
  await expect(tiles.first()).toHaveAttribute('href', /\/pokemon-tcg\/series\/base\/$/);
});
```

- [ ] **Step 6.2: Run the test to verify it fails**

Run: `npm run test:e2e -- set-pages`
Expected: FAIL (route `/sets/` returns 404).

- [ ] **Step 6.3: Create the sets index**

Create `src/pages/sets/index.astro`:

```astro
---
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Base from '@/layouts/Base.astro';
import type { CardIdentity } from '@/data/schema';
import { groupSetsBySeries } from '@/data/set-groups';

const cards: CardIdentity[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/cards.json'), 'utf8'),
);
const bySeries = groupSetsBySeries(cards);

// Order series newest-first by their most-recent set's releaseDate.
// Each SeriesSummary.sets is already sorted newest-first, so sets[0] is
// the newest set in that series. Empty releaseDate sorts last.
const seriesList = Array.from(bySeries.values()).sort((a, b) => {
  const aLatest = a.sets[0]?.releaseDate ?? '';
  const bLatest = b.sets[0]?.releaseDate ?? '';
  return bLatest.localeCompare(aLatest);
});

const totalSets = seriesList.reduce((acc, s) => acc + s.setCount, 0);
---
<Base title="All sets — Pokémon TCG Catalog" description="Browse every Pokémon TCG series and set, newest first.">
  <h1>All sets</h1>
  <p class="summary">Browse {seriesList.length} {seriesList.length === 1 ? 'series' : 'series'}, {totalSets} {totalSets === 1 ? 'set' : 'sets'} total.</p>
  <div class="series-grid">
    {seriesList.map((s) => (
      <a class="series-tile" href={`/pokemon-tcg/series/${s.seriesId}/`}>
        <strong>{s.seriesName}</strong>
        <span>{s.setCount} {s.setCount === 1 ? 'set' : 'sets'} · {s.cardCount} cards</span>
      </a>
    ))}
  </div>
</Base>

<style>
  .summary { color: var(--muted); margin-bottom: 2rem; }
  .series-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1rem;
  }
  .series-tile {
    padding: 1rem; border: 1px solid #d9c9a3; border-radius: 8px;
    background: var(--paper); text-decoration: none; color: inherit;
    transition: border-color 150ms ease;
  }
  .series-tile:hover { border-color: var(--accent); }
  .series-tile strong { display: block; font-size: 1.1rem; }
  .series-tile span { display: block; color: var(--muted); font-size: 0.85rem; margin-top: 0.25rem; }
</style>
```

- [ ] **Step 6.4: Run the test to verify it passes**

Run: `npm run test:e2e -- set-pages`
Expected: PASS (all four set-page tests now pass).

- [ ] **Step 6.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6.6: Commit**

```bash
git add src/pages/sets/index.astro tests/e2e/set-pages.spec.ts
git commit -m "feat(set-pages): add /sets/ series-index page"
```

---

## Task 7: Card detail page — set line becomes a link

**Files:**
- Modify: `src/pages/card/[id].astro`
- Modify: `tests/e2e/card-page.spec.ts`

The card page currently shows the set name as plain text; turn it into a link to the new set page.

- [ ] **Step 7.1: Append the failing e2e test to `tests/e2e/card-page.spec.ts`**

Append to `tests/e2e/card-page.spec.ts`:

```ts
test('card page set line links to /set/[setId]/', async ({ page }) => {
  await page.goto('card/base1-4');
  const setLink = page.locator('aside a[href*="/set/"]').first();
  await expect(setLink).toHaveAttribute('href', /\/pokemon-tcg\/set\/base1\/$/);
  await expect(setLink).toHaveText('Base'); // fixture set name
});
```

- [ ] **Step 7.2: Run the test to verify it fails**

Run: `npm run test:e2e -- card-page`
Expected: the new test FAILs (no anchor inside `aside` yet). Existing card-page tests still pass.

- [ ] **Step 7.3: Modify the card page**

Edit `src/pages/card/[id].astro:87` — replace the line:

```astro
<p>Set: {card.filters.setName} <span style="color:#7a5e3a;font-size:0.8rem">({card.filters.setId})</span></p>
```

with:

```astro
<p>Set: <a href={`/pokemon-tcg/set/${card.filters.setId}/`}>{card.filters.setName}</a> <span style="color:#7a5e3a;font-size:0.8rem">({card.filters.setId})</span></p>
```

No other changes. Leave imports and frontmatter as they are.

- [ ] **Step 7.4: Run tests to verify the new test passes and existing tests still pass**

Run: `npm run test:e2e -- card-page`
Expected: PASS (all card-page tests).

- [ ] **Step 7.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7.6: Commit**

```bash
git add src/pages/card/[id].astro tests/e2e/card-page.spec.ts
git commit -m "feat(set-pages): link card-page set line to /set/[setId]/"
```

---

## Task 8: Home page — "Browse all sets" link

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `tests/e2e/home.spec.ts`

Add one discoverable link from the home page to the new `/sets/` index.

- [ ] **Step 8.1: Append the failing e2e test to `tests/e2e/home.spec.ts`**

Append to `tests/e2e/home.spec.ts`:

```ts
test('home page has a Browse all sets link', async ({ page }) => {
  await page.goto('./');
  const link = page.locator('a', { hasText: /Browse all sets/i });
  await expect(link).toHaveAttribute('href', /\/pokemon-tcg\/sets\/$/);
});
```

- [ ] **Step 8.2: Run the test to verify it fails**

Run: `npm run test:e2e -- home`
Expected: new test FAILs (link doesn't exist yet). Existing home tests still pass.

- [ ] **Step 8.3: Modify the home page**

Edit `src/pages/index.astro`. Inside the `<section>` block, add the link after the `<div class="grid">...</div>`:

```astro
  <section>
    <h2>Featured cards</h2>
    <div class="grid">
      {featured.map((card) => <CardTile card={card} />)}
    </div>
    <div class="browse-all">
      <a href="/pokemon-tcg/sets/">Browse all sets →</a>
    </div>
  </section>
```

Add a `.browse-all` rule to the `<style>` block:

```css
  .browse-all { margin-top: 2rem; text-align: center; }
```

- [ ] **Step 8.4: Run tests to verify all pass**

Run: `npm run test:e2e -- home`
Expected: PASS (all home tests including the new one).

- [ ] **Step 8.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8.6: Commit**

```bash
git add src/pages/index.astro tests/e2e/home.spec.ts
git commit -m "feat(set-pages): add Browse all sets link on home"
```

---

## Task 9: `@astrojs/sitemap` integration

**Files:**
- Modify: `package.json`
- Modify: `astro.config.mjs`

Install the integration and register it. It auto-generates `sitemap-index.xml` + `sitemap-0.xml` covering every static route (23k cards + 170 new browse pages).

- [ ] **Step 9.1: Install the integration**

Run:

```bash
npm install --save-dev @astrojs/sitemap
```

Expected: `package.json` gains `"@astrojs/sitemap": "^..."` in `devDependencies`; `package-lock.json` updates.

- [ ] **Step 9.2: Register the integration in Astro config**

Edit `astro.config.mjs` to add the import and include `sitemap()` in `integrations`:

```js
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://davstaylor.github.io',
  base: '/pokemon-tcg',
  integrations: [preact(), sitemap()],
  output: 'static',
});
```

- [ ] **Step 9.3: Run a fixture build to confirm sitemap files are emitted**

Run:

```bash
npm run build:fixtures-empty-prices
```

Expected: exit 0. Inspect `dist/`:

```bash
ls dist/sitemap-*.xml
```

Expected output (exact filenames may vary slightly by version):

```
dist/sitemap-0.xml
dist/sitemap-index.xml
```

- [ ] **Step 9.4: Spot-check the sitemap includes a new browse URL**

Run:

```bash
grep -c 'pokemon-tcg/set/base1' dist/sitemap-0.xml
```

Expected: `1` or more (the new per-set page is indexed).

Run:

```bash
grep -c 'pokemon-tcg/sets/' dist/sitemap-0.xml
```

Expected: `1` or more (the sets index is indexed).

- [ ] **Step 9.5: Run the full test suite to confirm nothing regressed**

Run:

```bash
npm run test:unit && npm run test:e2e
```

Expected: all tests PASS.

- [ ] **Step 9.6: Commit**

```bash
git add package.json package-lock.json astro.config.mjs
git commit -m "feat(set-pages): add @astrojs/sitemap integration"
```

---

## Task 10: Open Graph tags + canonical URL on every page

**Files:**
- Modify: `src/layouts/Base.astro`

Spec §8 says OG tags should go in `Base.astro` so every page gets them — covers the new browse pages and every existing card/home/search page with one edit. Set pages pass `setSymbol` as the OG image; everything else falls back to text-only OG.

- [ ] **Step 10.1: Add a failing e2e test for OG tags on a set page**

Append to `tests/e2e/set-pages.spec.ts`:

```ts
test('set page emits Open Graph tags and a canonical link', async ({ page }) => {
  await page.goto('set/base1/');
  await expect(page.locator('head meta[property="og:title"]')).toHaveAttribute(
    'content',
    /Base/,
  );
  await expect(page.locator('head meta[property="og:type"]')).toHaveAttribute('content', 'website');
  await expect(page.locator('head meta[property="og:url"]')).toHaveAttribute(
    'content',
    /\/pokemon-tcg\/set\/base1\/?$/,
  );
  await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute(
    'href',
    /\/pokemon-tcg\/set\/base1\/?$/,
  );
});
```

- [ ] **Step 10.2: Run the test to verify it fails**

Run: `npm run test:e2e -- set-pages`
Expected: new test FAILs (no `og:*` meta tags exist in head yet).

- [ ] **Step 10.3: Extend `Base.astro` with OG + canonical support**

Edit `src/layouts/Base.astro` — change the `Props` interface and the `<head>` section. Leave everything else intact.

Replace the existing frontmatter block:

```astro
interface Props { title: string; description?: string }
const { title, description = 'Pokémon TCG multilingual catalog' } = Astro.props;
```

with:

```astro
interface Props { title: string; description?: string; ogImage?: string }
const { title, description = 'Pokémon TCG multilingual catalog', ogImage } = Astro.props;

// Canonical + OG URL — Astro.url is absolute when `site` is configured.
const canonicalUrl = Astro.url.href;
```

Then in the `<head>` block, add these five tags directly after the existing `<meta name="description" ... />` line:

```astro
    <link rel="canonical" href={canonicalUrl} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:type" content="website" />
    <meta property="og:url" content={canonicalUrl} />
    {ogImage && <meta property="og:image" content={ogImage} />}
```

- [ ] **Step 10.4: Pass `ogImage={data.setSymbol}` from the set page**

Edit `src/pages/set/[setId].astro` — the `<Base ...>` opening tag currently reads:

```astro
<Base title={title} description={description}>
```

Change it to:

```astro
<Base title={title} description={description} ogImage={data.setSymbol || undefined}>
```

(`undefined` if the symbol is an empty string, so the tag is omitted rather than emitted blank.)

- [ ] **Step 10.5: Pass `ogImage` from the series page too (use the most-recent set's symbol)**

Edit `src/pages/series/[seriesId].astro` — the `<Base ...>` opening tag currently reads:

```astro
<Base title={title} description={description}>
```

Change it to:

```astro
<Base title={title} description={description} ogImage={data.sets[0]?.setSymbol || undefined}>
```

`data.sets` is already sorted newest-first (see `groupSetsBySeries` in Task 2), so `sets[0]` is the most recent.

- [ ] **Step 10.6: Run the e2e test suite to verify all pass**

Run: `npm run test:e2e`
Expected: every test PASS, including the new OG-tag assertion.

- [ ] **Step 10.7: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 10.8: Commit**

```bash
git add src/layouts/Base.astro src/pages/set/[setId].astro src/pages/series/[seriesId].astro tests/e2e/set-pages.spec.ts
git commit -m "feat(set-pages): emit Open Graph tags and canonical link site-wide"
```

---

## Verification — end-to-end build & smoke test

After all tasks are committed, run one final full check.

- [ ] **Step V.1: Full typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step V.2: Full unit + e2e suite**

Run: `npm run test:unit && npm run test:e2e`
Expected: every test PASS (counts will include 5 new compareLocalIds tests + 4 new set-page e2e tests + 1 new card-page e2e test + 1 new home e2e test).

- [ ] **Step V.3: Manual preview check**

Run: `npm run build:fixtures-empty-prices && npm run preview`

Then open in a browser (or use curl to confirm HTTP 200):
- `http://localhost:4321/pokemon-tcg/sets/` — series tile visible
- `http://localhost:4321/pokemon-tcg/series/base/` — one set listed, linking to `/set/base1/`
- `http://localhost:4321/pokemon-tcg/set/base1/` — 2 cards, Blastoise first
- `http://localhost:4321/pokemon-tcg/card/base1-4` — set line is a clickable link
- `http://localhost:4321/pokemon-tcg/` — "Browse all sets →" link at the bottom of featured

Stop the preview server (Ctrl-C) when done.
