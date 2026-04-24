# Portfolio Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a client-side "my cards" tracker. `/portfolio/` page with summary dashboard + 30-day value trend + autocomplete add form + inline-editable holdings table + export/import JSON. Card detail pages gain an "+ Add to my cards" button. Default display currency switches to GBP.

**Architecture:** Pure client-side state (localStorage). Two new Preact islands consume three new pure-function modules (`portfolio-schema`, `portfolio-storage`, `portfolio-aggregate`). Runtime data fetch of `/sparkline-dump` from the existing v2.1 Worker, cached in localStorage for 1h. No new npm dependencies, no Worker changes, no data-pipeline changes.

**Tech Stack:** Astro 6 SSG, Preact islands, Zod v4, TypeScript strict, Vitest, Playwright, Pagefind (reused for autocomplete).

---

## Spec Reference

Design doc: `docs/superpowers/specs/2026-04-22-pokemon-tcg-portfolio-tracker-design.md` — read before starting.

## Key Codebase Conventions

**You do NOT need to read these files — they are summarised here. Read them only if a task fails.**

- **Path alias:** `@/*` → `src/*`.
- **Existing `SupportedCurrency` type and constants** live in `src/data/currency-schema.ts`:
  ```ts
  export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY'] as const;
  export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];
  export const CURRENCY_GLYPH: Record<SupportedCurrency, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' };
  export const CURRENCY_DECIMALS: Record<SupportedCurrency, number> = { EUR: 2, USD: 2, GBP: 2, JPY: 0 };
  export const ExchangeRatesSchema = z.object({ base: z.literal('EUR'), date: z.string(), rates: z.object({ USD, GBP, JPY }) });
  export type ExchangeRates = z.infer<typeof ExchangeRatesSchema>;
  ```
  There is **no** `SupportedCurrencySchema` Zod schema yet; Task 1 adds it.
- **Existing `currency.ts`** has `convertFromEUR(eurValue, target, rates)` and `formatCurrency(value, currency)`. Task 1 adds `convertBetween(value, from, to, rates)`.
- **Existing `CurrencySelect.tsx`** has `DEFAULT: SupportedCurrency = 'EUR'` on line 5 and a `detectDefault()` that prefers locale (GB→GBP etc.). Task 4 changes the hard-coded fallback to `'GBP'` and adds one `window.dispatchEvent(new CustomEvent('currencychange', { detail: { currency: next } }))` in the `onChange` handler.
- **Existing `SparklineDumpSchema`** is exported from `src/data/history-schema.ts`:
  ```ts
  type Snapshot = { cardId: string; date: string; trend: number|null; low, avg30, avg7, avg1: number|null };
  type SparklineDump = { days: number; cutoff: string; records: Record<string, Snapshot[]> };
  ```
- **`pickBaseline` in `src/data/hot-cards.ts:45`** — walks a date-sorted series backwards, returns most-recent snapshot with `date ≤ targetIso`. The plan references this for forward-fill in the trend series; inline a copy in `portfolio-aggregate.ts` (YAGNI — don't promote to a shared helper yet).
- **Worker URL:** `https://pokemon-tcg-history-api.david-taylor-pokemon.workers.dev/sparkline-dump` — returns the full `SparklineDump` JSON with CORS allow-all. Public. ~30 MB uncompressed, ~5 MB gzipped.
- **Astro `.astro` URL convention:** hardcode `/pokemon-tcg/…`. `.tsx` islands use `import.meta.env.BASE_URL`.
- **Playwright `baseURL`:** `http://localhost:4321/pokemon-tcg/`. Tests use relative paths (`portfolio/`, `card/base1-4`). Kill stale preview before e2e runs: `pkill -f "astro preview" || true`.
- **Fixture sparkline** at `data/fixtures/sample-sparkline.json` (from Hot Cards Task 3) — 13 snapshots for `base1-4` (rising 300→360), 8 snapshots for `base1-2` (falling 80→58). Copied to `data/sparkline-snapshot.json` by `build:fixtures-empty-prices`. E2e tests intercept the Worker fetch via `page.route()` and serve this fixture.
- **Design tokens (globals in `Base.astro`):** `--bg #f5efe2`, `--paper #fffdf6`, `--ink #3b2a1a`, `--muted #7a5e3a`, `--accent #c86f3d`.
- **Image-error convention:** `const ON_IMG_ERROR = 'this.onerror=null; this.remove();'` paired with a `.placeholder:only-child { display: grid }` CSS rule. Used by `CardTile.astro`, `SetHeader.astro`, `HotSection.astro`.
- **Pagefind is already wired:** every card page has `<article data-pagefind-body data-pagefind-meta="title:…, subtitle:…">`; `SearchBox.tsx` loads pagefind from `${BASE_URL}/pagefind/pagefind.js`. Task 6 adds `thumb` + `cardId` to the meta; Task 10's autocomplete consumes them.

## File Structure

**Create (new files):**
- `src/data/portfolio-schema.ts` — Zod schemas + types (`PortfolioEntry`, `PortfolioFile`).
- `src/data/portfolio-storage.ts` — localStorage wrappers: `loadPortfolio`, `savePortfolio`, `addEntry`, `removeEntry`, `updateEntry`. Pure functions that take/return `PortfolioFile`; a separate `loadPortfolioSafe()` handles parse failures.
- `src/data/portfolio-aggregate.ts` — pure data-shaping: `computeSummary`, `computeTrendSeries`, `entryCurrentEur`, `findSnapshotOnOrBefore` (copied from `hot-cards.ts`).
- `src/data/sparkline-fetch.ts` — `fetchSparklineWithCache()`: reads localStorage cache if fresh (<1h), else fetches the Worker, validates via Zod, caches.
- `src/components/PortfolioDashboard.tsx` — the big island. Rendered inside `/portfolio/index.astro`. Holds state for the portfolio, the sparkline dump, and the display currency. Emits DOM for summary stats, trend chart, add form, holdings table, export/import controls.
- `src/components/PortfolioAddButton.tsx` — small island. Rendered inside `/card/[id].astro`. Inline button + mini-form for add/update.
- `src/pages/portfolio/index.astro` — server-renders the page shell; mounts the dashboard island.
- `tests/unit/portfolio-storage.test.ts` — 8 cases.
- `tests/unit/portfolio-aggregate.test.ts` — 7 cases.
- `tests/e2e/portfolio.spec.ts` — 5 tests for the portfolio page flows (add, edit, remove, export, import).

**Modify (existing files):**
- `src/data/currency-schema.ts` — add `SupportedCurrencySchema = z.enum(SUPPORTED_CURRENCIES)` export.
- `src/data/currency.ts` — add `convertBetween(value, from, to, rates)` helper.
- `tests/unit/currency.test.ts` — 2 new `convertBetween` cases.
- `src/components/CurrencySelect.tsx` — change `DEFAULT` from `'EUR'` to `'GBP'`; dispatch `currencychange` CustomEvent on select change.
- `src/pages/card/[id].astro` — extend `data-pagefind-meta` with `thumb:…, cardId:…`; mount `<PortfolioAddButton client:load cardId={card.id} cardName={card.defaultName} />` below the existing `<aside>`.
- `src/pages/index.astro` — add third link "My portfolio →" to `.browse-links`.
- `tests/e2e/card-page.spec.ts` — one new test for the Add button flow.
- `tests/e2e/home.spec.ts` — one new test for the portfolio home link.

---

## Task 1: Currency helpers (prereq)

**Files:**
- Modify: `src/data/currency-schema.ts`
- Modify: `src/data/currency.ts`
- Modify: `tests/unit/currency.test.ts`

Add the `SupportedCurrencySchema` Zod enum and `convertBetween` helper — both consumed by subsequent tasks.

- [ ] **Step 1.1: Write failing tests for `convertBetween`**

Append to `tests/unit/currency.test.ts`:

```ts
import { convertBetween } from '@/data/currency';

const rates = { base: 'EUR' as const, date: '2026-04-22', rates: { USD: 1.08, GBP: 0.86, JPY: 162.0 } };

describe('convertBetween', () => {
  it('returns value unchanged when from === to', () => {
    expect(convertBetween(100, 'GBP', 'GBP', rates)).toBe(100);
    expect(convertBetween(42, 'EUR', 'EUR', rates)).toBe(42);
  });

  it('converts via EUR for non-EUR pairs', () => {
    // £100 → €100 / 0.86 = €116.28... → $116.28 × 1.08 = $125.58...
    const usd = convertBetween(100, 'GBP', 'USD', rates);
    expect(usd).toBeCloseTo((100 / 0.86) * 1.08, 3);
  });

  it('converts EUR → target via the direct multiplier', () => {
    expect(convertBetween(100, 'EUR', 'USD', rates)).toBeCloseTo(108, 3);
    expect(convertBetween(100, 'EUR', 'GBP', rates)).toBeCloseTo(86, 3);
  });

  it('converts target → EUR via the direct divisor', () => {
    expect(convertBetween(108, 'USD', 'EUR', rates)).toBeCloseTo(100, 3);
    expect(convertBetween(86, 'GBP', 'EUR', rates)).toBeCloseTo(100, 3);
  });
});
```

- [ ] **Step 1.2: Run tests to verify red**

Run: `npm run test:unit -- currency`
Expected: FAIL — `convertBetween is not exported from @/data/currency`.

- [ ] **Step 1.3: Add `SupportedCurrencySchema` to `src/data/currency-schema.ts`**

Insert immediately after the `SUPPORTED_CURRENCIES` / `SupportedCurrency` declarations (around line 5):

```ts
export const SupportedCurrencySchema = z.enum(SUPPORTED_CURRENCIES);
```

The file already imports `z`, so no new import needed.

- [ ] **Step 1.4: Add `convertBetween` to `src/data/currency.ts`**

Append to the file (after `formatCurrency`):

```ts
export function convertBetween(
  value: number,
  from: SupportedCurrency,
  to: SupportedCurrency,
  rates: ExchangeRates,
): number {
  if (from === to) return value;
  // All rates are stored as EUR → X multipliers. Convert via EUR.
  const inEur = from === 'EUR' ? value : value / rates.rates[from];
  return to === 'EUR' ? inEur : inEur * rates.rates[to];
}
```

- [ ] **Step 1.5: Run tests to verify green**

Run: `npm run test:unit -- currency`
Expected: PASS — 4 new `convertBetween` tests plus the pre-existing currency tests.

- [ ] **Step 1.6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 1.7: Commit**

```bash
git add src/data/currency-schema.ts src/data/currency.ts tests/unit/currency.test.ts
git commit -m "feat(portfolio): add SupportedCurrencySchema + convertBetween helper"
```

---

## Task 2: Portfolio schema + storage

**Files:**
- Create: `src/data/portfolio-schema.ts`
- Create: `src/data/portfolio-storage.ts`
- Create: `tests/unit/portfolio-storage.test.ts`

- [ ] **Step 2.1: Write the failing storage tests**

Create `tests/unit/portfolio-storage.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPortfolio,
  loadPortfolioSafe,
  savePortfolio,
  addEntry,
  removeEntry,
  updateEntry,
  PORTFOLIO_STORAGE_KEY,
} from '@/data/portfolio-storage';
import type { ExchangeRates } from '@/data/currency-schema';

// Fake localStorage — Vitest's jsdom env provides one, but keep the
// per-test reset explicit so order doesn't matter.
beforeEach(() => {
  localStorage.clear();
});

const rates: ExchangeRates = {
  base: 'EUR',
  date: '2026-04-22',
  rates: { USD: 1.08, GBP: 0.86, JPY: 162.0 },
};

describe('loadPortfolio / savePortfolio', () => {
  it('loadPortfolio returns empty file when key missing', () => {
    const file = loadPortfolio();
    expect(file).toEqual({ version: 1, entries: [] });
  });

  it('loadPortfolioSafe flags corrupted JSON without throwing', () => {
    localStorage.setItem(PORTFOLIO_STORAGE_KEY, 'not json');
    const result = loadPortfolioSafe();
    expect(result.corrupted).toBe(true);
    expect(result.file).toEqual({ version: 1, entries: [] });
  });

  it('savePortfolio round-trips via loadPortfolio', () => {
    const file = {
      version: 1 as const,
      entries: [
        { cardId: 'base1-4', qty: 1, costValue: 150, costCurrency: 'GBP' as const, addedAt: '2026-04-22' },
      ],
    };
    savePortfolio(file);
    expect(loadPortfolio()).toEqual(file);
  });
});

describe('addEntry', () => {
  it('adds a new entry with addedAt populated', () => {
    const start = { version: 1 as const, entries: [] };
    const next = addEntry(start, {
      cardId: 'base1-4', qty: 2, costValue: 150, costCurrency: 'GBP',
    }, rates, '2026-04-22');
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toEqual({
      cardId: 'base1-4', qty: 2, costValue: 150, costCurrency: 'GBP', addedAt: '2026-04-22',
    });
  });

  it('sums qty and cost when cardId already exists with matching currency', () => {
    const start = {
      version: 1 as const,
      entries: [{ cardId: 'base1-4', qty: 1, costValue: 100, costCurrency: 'GBP' as const, addedAt: '2026-04-20' }],
    };
    const next = addEntry(start, {
      cardId: 'base1-4', qty: 2, costValue: 300, costCurrency: 'GBP',
    }, rates, '2026-04-22');
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].qty).toBe(3);
    expect(next.entries[0].costValue).toBe(400);
    expect(next.entries[0].costCurrency).toBe('GBP');
    // addedAt should remain the original add date.
    expect(next.entries[0].addedAt).toBe('2026-04-20');
  });

  it('converts new cost to existing currency when currencies differ', () => {
    const start = {
      version: 1 as const,
      entries: [{ cardId: 'base1-4', qty: 1, costValue: 100, costCurrency: 'GBP' as const, addedAt: '2026-04-20' }],
    };
    // Adding €50 to a GBP row: €50 converts to £50 × (0.86) — no, wait.
    // convertBetween(50, EUR, GBP, rates): 50 * 0.86 = 43. New cost = 100 + 43 = 143.
    const next = addEntry(start, {
      cardId: 'base1-4', qty: 1, costValue: 50, costCurrency: 'EUR',
    }, rates, '2026-04-22');
    expect(next.entries[0].qty).toBe(2);
    expect(next.entries[0].costValue).toBeCloseTo(143, 1);
    expect(next.entries[0].costCurrency).toBe('GBP');  // existing currency wins
  });
});

describe('removeEntry', () => {
  it('removes the entry by cardId', () => {
    const start = {
      version: 1 as const,
      entries: [
        { cardId: 'a', qty: 1, costValue: 10, costCurrency: 'GBP' as const, addedAt: '2026-04-22' },
        { cardId: 'b', qty: 2, costValue: 20, costCurrency: 'GBP' as const, addedAt: '2026-04-22' },
      ],
    };
    const next = removeEntry(start, 'a');
    expect(next.entries).toEqual([start.entries[1]]);
  });

  it('is a no-op when cardId absent', () => {
    const start = {
      version: 1 as const,
      entries: [{ cardId: 'a', qty: 1, costValue: 10, costCurrency: 'GBP' as const, addedAt: '2026-04-22' }],
    };
    expect(removeEntry(start, 'missing')).toEqual(start);
  });
});

describe('updateEntry', () => {
  it('writes qty and cost in place', () => {
    const start = {
      version: 1 as const,
      entries: [{ cardId: 'a', qty: 1, costValue: 10, costCurrency: 'GBP' as const, addedAt: '2026-04-22' }],
    };
    const next = updateEntry(start, 'a', { qty: 5, costValue: 500 });
    expect(next.entries[0].qty).toBe(5);
    expect(next.entries[0].costValue).toBe(500);
    expect(next.entries[0].costCurrency).toBe('GBP');
    expect(next.entries[0].addedAt).toBe('2026-04-22');  // unchanged
  });

  it('rejects qty < 1 (caller must use removeEntry)', () => {
    const start = {
      version: 1 as const,
      entries: [{ cardId: 'a', qty: 1, costValue: 10, costCurrency: 'GBP' as const, addedAt: '2026-04-22' }],
    };
    expect(() => updateEntry(start, 'a', { qty: 0 })).toThrow(/qty/);
  });
});
```

- [ ] **Step 2.2: Run the tests to verify red**

Run: `npm run test:unit -- portfolio-storage`
Expected: FAIL — `Cannot find package '@/data/portfolio-storage'`.

- [ ] **Step 2.3: Create `src/data/portfolio-schema.ts`**

```ts
import { z } from 'zod';
import { SupportedCurrencySchema } from './currency-schema';

export const PortfolioEntrySchema = z.object({
  cardId: z.string().min(1),
  qty: z.number().int().positive(),
  costValue: z.number().nonnegative(),
  costCurrency: SupportedCurrencySchema,
  addedAt: z.string(),  // ISO 8601 date (YYYY-MM-DD)
});
export type PortfolioEntry = z.infer<typeof PortfolioEntrySchema>;

export const PortfolioFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(PortfolioEntrySchema),
});
export type PortfolioFile = z.infer<typeof PortfolioFileSchema>;

// Shape the UI passes into addEntry — no addedAt yet (storage fills it).
export type NewEntryInput = {
  cardId: string;
  qty: number;
  costValue: number;
  costCurrency: PortfolioEntry['costCurrency'];
};
```

- [ ] **Step 2.4: Create `src/data/portfolio-storage.ts`**

```ts
import type { ExchangeRates } from './currency-schema';
import { convertBetween } from './currency';
import type { PortfolioEntry, PortfolioFile, NewEntryInput } from './portfolio-schema';
import { PortfolioFileSchema } from './portfolio-schema';

export const PORTFOLIO_STORAGE_KEY = 'pokemon-tcg:portfolio';

const EMPTY_FILE: PortfolioFile = { version: 1, entries: [] };

export function loadPortfolio(): PortfolioFile {
  return loadPortfolioSafe().file;
}

export function loadPortfolioSafe(): { file: PortfolioFile; corrupted: boolean } {
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (raw === null) return { file: EMPTY_FILE, corrupted: false };
    const parsed = JSON.parse(raw);
    const validated = PortfolioFileSchema.parse(parsed);
    return { file: validated, corrupted: false };
  } catch {
    return { file: EMPTY_FILE, corrupted: true };
  }
}

export function savePortfolio(file: PortfolioFile): void {
  localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(file));
}

// Pure function: merge a new add into the existing file. See Task 2 tests for
// the dedup + cross-currency merging semantics.
export function addEntry(
  file: PortfolioFile,
  input: NewEntryInput,
  rates: ExchangeRates,
  todayIso: string,
): PortfolioFile {
  const existingIdx = file.entries.findIndex((e) => e.cardId === input.cardId);
  if (existingIdx === -1) {
    const entry: PortfolioEntry = {
      cardId: input.cardId,
      qty: input.qty,
      costValue: input.costValue,
      costCurrency: input.costCurrency,
      addedAt: todayIso,
    };
    return { ...file, entries: [...file.entries, entry] };
  }
  const existing = file.entries[existingIdx];
  const convertedNewCost =
    input.costCurrency === existing.costCurrency
      ? input.costValue
      : convertBetween(input.costValue, input.costCurrency, existing.costCurrency, rates);
  const merged: PortfolioEntry = {
    ...existing,
    qty: existing.qty + input.qty,
    costValue: existing.costValue + convertedNewCost,
  };
  const entries = [...file.entries];
  entries[existingIdx] = merged;
  return { ...file, entries };
}

export function removeEntry(file: PortfolioFile, cardId: string): PortfolioFile {
  const filtered = file.entries.filter((e) => e.cardId !== cardId);
  if (filtered.length === file.entries.length) return file;  // no-op
  return { ...file, entries: filtered };
}

export function updateEntry(
  file: PortfolioFile,
  cardId: string,
  patch: { qty?: number; costValue?: number },
): PortfolioFile {
  if (patch.qty !== undefined && patch.qty < 1) {
    throw new Error('updateEntry: qty must be ≥ 1 (use removeEntry to delete)');
  }
  const idx = file.entries.findIndex((e) => e.cardId === cardId);
  if (idx === -1) return file;
  const merged: PortfolioEntry = {
    ...file.entries[idx],
    ...(patch.qty !== undefined ? { qty: patch.qty } : {}),
    ...(patch.costValue !== undefined ? { costValue: patch.costValue } : {}),
  };
  const entries = [...file.entries];
  entries[idx] = merged;
  return { ...file, entries };
}
```

- [ ] **Step 2.5: Run the tests to verify green**

Run: `npm run test:unit -- portfolio-storage`
Expected: PASS — 8 tests.

- [ ] **Step 2.6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 2.7: Commit**

```bash
git add src/data/portfolio-schema.ts src/data/portfolio-storage.ts tests/unit/portfolio-storage.test.ts
git commit -m "feat(portfolio): add portfolio schema + storage helpers"
```

---

## Task 3: Portfolio aggregate helpers

**Files:**
- Create: `src/data/portfolio-aggregate.ts`
- Create: `tests/unit/portfolio-aggregate.test.ts`

- [ ] **Step 3.1: Write the failing aggregate tests**

Create `tests/unit/portfolio-aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeSummary,
  computeTrendSeries,
  entryCurrentEur,
  findSnapshotOnOrBefore,
} from '@/data/portfolio-aggregate';
import type { PortfolioEntry } from '@/data/portfolio-schema';
import type { SparklineDump, Snapshot } from '@/data/history-schema';
import type { ExchangeRates } from '@/data/currency-schema';

const rates: ExchangeRates = {
  base: 'EUR',
  date: '2026-04-22',
  rates: { USD: 1.08, GBP: 0.86, JPY: 162.0 },
};

function snap(cardId: string, date: string, trend: number | null): Snapshot {
  return { cardId, date, trend, low: null, avg30: null, avg7: null, avg1: null };
}
function dump(records: Record<string, Snapshot[]>): SparklineDump {
  return { days: 30, cutoff: '2026-03-22', records };
}
function entry(partial: Partial<PortfolioEntry> & { cardId: string }): PortfolioEntry {
  return {
    qty: 1, costValue: 0, costCurrency: 'GBP', addedAt: '2026-04-22',
    ...partial,
  };
}

describe('entryCurrentEur', () => {
  it('returns the last snapshot trend for a present card', () => {
    const d = dump({ a: [snap('a', '2026-04-21', 50), snap('a', '2026-04-22', 60)] });
    expect(entryCurrentEur(entry({ cardId: 'a' }), d)).toBe(60);
  });

  it('returns null for missing card', () => {
    const d = dump({});
    expect(entryCurrentEur(entry({ cardId: 'missing' }), d)).toBe(null);
  });

  it('returns null when latest trend is null', () => {
    const d = dump({ a: [snap('a', '2026-04-22', null)] });
    expect(entryCurrentEur(entry({ cardId: 'a' }), d)).toBe(null);
  });
});

describe('computeSummary', () => {
  it('returns all zeros on empty entries', () => {
    const s = computeSummary([], dump({}), rates, 'GBP');
    expect(s).toEqual({
      cards: 0, uniqueCards: 0, paidInDisplay: 0, valueInDisplay: 0,
      pnlValue: 0, pnlPct: 0, unpriced: 0,
    });
  });

  it('sums qty and converts mixed-currency costs to display', () => {
    const entries = [
      entry({ cardId: 'a', qty: 2, costValue: 100, costCurrency: 'GBP' }),
      entry({ cardId: 'b', qty: 1, costValue: 50, costCurrency: 'EUR' }),
    ];
    const d = dump({
      a: [snap('a', '2026-04-22', 70)],    // €70 each
      b: [snap('b', '2026-04-22', 30)],    // €30 each
    });
    const s = computeSummary(entries, d, rates, 'GBP');
    expect(s.cards).toBe(3);
    expect(s.uniqueCards).toBe(2);
    // paid = £100 + (€50 → £43) = £143
    expect(s.paidInDisplay).toBeCloseTo(143, 1);
    // value = (2 × €70 + 1 × €30) × 0.86 = €170 × 0.86 = £146.20
    expect(s.valueInDisplay).toBeCloseTo(146.2, 1);
    expect(s.pnlValue).toBeCloseTo(146.2 - 143, 1);
    expect(s.pnlPct).toBeCloseTo((146.2 - 143) / 143, 3);
    expect(s.unpriced).toBe(0);
  });

  it('counts unpriced cards but excludes them from value', () => {
    const entries = [
      entry({ cardId: 'a', qty: 1, costValue: 100, costCurrency: 'GBP' }),
      entry({ cardId: 'ghost', qty: 1, costValue: 50, costCurrency: 'GBP' }),
    ];
    const d = dump({ a: [snap('a', '2026-04-22', 70)] });  // no 'ghost'
    const s = computeSummary(entries, d, rates, 'GBP');
    expect(s.unpriced).toBe(1);
    // cost still includes ghost
    expect(s.paidInDisplay).toBeCloseTo(150, 1);
    // value = 1 × €70 × 0.86 = £60.20
    expect(s.valueInDisplay).toBeCloseTo(60.2, 1);
  });

  it('pnlPct is 0 when paid is 0 (no divide-by-zero)', () => {
    const entries = [entry({ cardId: 'a', qty: 1, costValue: 0, costCurrency: 'GBP' })];
    const d = dump({ a: [snap('a', '2026-04-22', 50)] });
    const s = computeSummary(entries, d, rates, 'GBP');
    expect(s.pnlPct).toBe(0);
  });
});

describe('findSnapshotOnOrBefore', () => {
  it('returns the most-recent snapshot with date ≤ target', () => {
    const series = [snap('a', '2026-04-10', 10), snap('a', '2026-04-15', 20), snap('a', '2026-04-22', 30)];
    expect(findSnapshotOnOrBefore(series, '2026-04-22')?.trend).toBe(30);
    expect(findSnapshotOnOrBefore(series, '2026-04-16')?.trend).toBe(20);
    expect(findSnapshotOnOrBefore(series, '2026-04-09')).toBe(null);
  });
});

describe('computeTrendSeries', () => {
  it('returns empty array on empty portfolio', () => {
    expect(computeTrendSeries([], dump({}), rates, 'GBP')).toEqual([]);
  });

  it('sums qty × trend per distinct date, forward-filling gaps, in display currency', () => {
    const entries = [
      entry({ cardId: 'a', qty: 2 }),
      entry({ cardId: 'b', qty: 1 }),
    ];
    const d = dump({
      a: [snap('a', '2026-04-20', 10), snap('a', '2026-04-22', 12)],
      b: [snap('b', '2026-04-21', 20)],
    });
    const series = computeTrendSeries(entries, d, rates, 'EUR');
    expect(series.map((p) => p.date)).toEqual(['2026-04-20', '2026-04-21', '2026-04-22']);
    // 2026-04-20: a=10 × 2, b missing → total €20
    // 2026-04-21: a=10 (fwd-fill) × 2, b=20 × 1 → total €40
    // 2026-04-22: a=12 × 2, b=20 (fwd-fill) × 1 → total €44
    expect(series[0].valueInDisplay).toBeCloseTo(20, 3);
    expect(series[1].valueInDisplay).toBeCloseTo(40, 3);
    expect(series[2].valueInDisplay).toBeCloseTo(44, 3);
  });
});
```

- [ ] **Step 3.2: Run tests to verify red**

Run: `npm run test:unit -- portfolio-aggregate`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Create `src/data/portfolio-aggregate.ts`**

```ts
import type { Snapshot, SparklineDump } from './history-schema';
import type { ExchangeRates, SupportedCurrency } from './currency-schema';
import type { PortfolioEntry } from './portfolio-schema';
import { convertBetween, convertFromEUR } from './currency';

export interface PortfolioSummary {
  cards: number;             // sum of qty
  uniqueCards: number;       // distinct cardIds
  paidInDisplay: number;
  valueInDisplay: number;
  pnlValue: number;          // valueInDisplay − paidInDisplay
  pnlPct: number;            // decimal, 0 when paid is 0
  unpriced: number;          // cards whose cardId has no history
}

export interface TrendPoint {
  date: string;              // YYYY-MM-DD
  valueInDisplay: number;
}

// Returns the last snapshot's trend for a card, or null if unavailable.
export function entryCurrentEur(entry: PortfolioEntry, dump: SparklineDump): number | null {
  const series = dump.records[entry.cardId];
  if (!series || series.length === 0) return null;
  const latest = series[series.length - 1];
  return latest.trend;
}

// Walks series (sorted oldest→newest) backwards, returns the most-recent
// snapshot with date ≤ target. Returns null if no such snapshot exists.
export function findSnapshotOnOrBefore(series: Snapshot[], targetIso: string): Snapshot | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= targetIso) return series[i];
  }
  return null;
}

export function computeSummary(
  entries: PortfolioEntry[],
  dump: SparklineDump,
  rates: ExchangeRates,
  display: SupportedCurrency,
): PortfolioSummary {
  let cards = 0;
  let paidInDisplay = 0;
  let valueInDisplay = 0;
  let unpriced = 0;

  for (const e of entries) {
    cards += e.qty;
    paidInDisplay += convertBetween(e.costValue, e.costCurrency, display, rates);
    const curEur = entryCurrentEur(e, dump);
    if (curEur === null) {
      unpriced++;
      continue;
    }
    const converted = convertFromEUR(curEur, display, rates);
    if (converted !== null) valueInDisplay += e.qty * converted;
  }

  return {
    cards,
    uniqueCards: entries.length,
    paidInDisplay,
    valueInDisplay,
    pnlValue: valueInDisplay - paidInDisplay,
    pnlPct: paidInDisplay > 0 ? (valueInDisplay - paidInDisplay) / paidInDisplay : 0,
    unpriced,
  };
}

export function computeTrendSeries(
  entries: PortfolioEntry[],
  dump: SparklineDump,
  rates: ExchangeRates,
  display: SupportedCurrency,
): TrendPoint[] {
  // Collect every distinct date across all owned cards' series.
  const dateSet = new Set<string>();
  for (const e of entries) {
    const series = dump.records[e.cardId] ?? [];
    for (const s of series) if (s.trend !== null) dateSet.add(s.date);
  }
  const dates = [...dateSet].sort();

  return dates.map((date) => {
    let totalEur = 0;
    for (const e of entries) {
      const series = dump.records[e.cardId] ?? [];
      const snap = findSnapshotOnOrBefore(series, date);
      if (snap !== null && snap.trend !== null) totalEur += e.qty * snap.trend;
    }
    const converted = convertFromEUR(totalEur, display, rates) ?? 0;
    return { date, valueInDisplay: converted };
  });
}
```

- [ ] **Step 3.4: Run tests to verify green**

Run: `npm run test:unit -- portfolio-aggregate`
Expected: PASS — 7 tests.

- [ ] **Step 3.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3.6: Commit**

```bash
git add src/data/portfolio-aggregate.ts tests/unit/portfolio-aggregate.test.ts
git commit -m "feat(portfolio): add aggregate helpers (summary, trend series)"
```

---

## Task 4: CurrencySelect — GBP default + currencychange event

**Files:**
- Modify: `src/components/CurrencySelect.tsx`

- [ ] **Step 4.1: Change the default currency constant**

In `src/components/CurrencySelect.tsx` line 5, change:

```ts
const DEFAULT: SupportedCurrency = 'EUR';
```

to:

```ts
const DEFAULT: SupportedCurrency = 'GBP';
```

- [ ] **Step 4.2: Dispatch `currencychange` on select change**

Inside the existing `onChange` function body in `src/components/CurrencySelect.tsx`, add one line after the `applyCurrencyToDOM(next, rates)` call:

Before:
```ts
  function onChange(e: Event) {
    const next = (e.target as HTMLSelectElement).value as SupportedCurrency;
    setCurrent(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    applyCurrencyToDOM(next, rates);
  }
```

After:
```ts
  function onChange(e: Event) {
    const next = (e.target as HTMLSelectElement).value as SupportedCurrency;
    setCurrent(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    applyCurrencyToDOM(next, rates);
    window.dispatchEvent(new CustomEvent('currencychange', { detail: { currency: next } }));
  }
```

Also add the same dispatch in the `useEffect` initial-detection branch so islands get notified on first load too. Replace the existing `useEffect` block:

Before:
```ts
  useEffect(() => {
    const detected = detectDefault();
    setCurrent(detected);
    if (detected !== DEFAULT) applyCurrencyToDOM(detected, rates);
  }, []);
```

After:
```ts
  useEffect(() => {
    const detected = detectDefault();
    setCurrent(detected);
    if (detected !== DEFAULT) applyCurrencyToDOM(detected, rates);
    window.dispatchEvent(new CustomEvent('currencychange', { detail: { currency: detected } }));
  }, []);
```

- [ ] **Step 4.3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4.4: Run existing currency e2e to confirm no regression**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- currency-switch
```

Expected: existing currency-switch tests still PASS (the new event dispatch doesn't affect the existing `[data-price-currency-field]` walk).

- [ ] **Step 4.5: Commit**

```bash
git add src/components/CurrencySelect.tsx
git commit -m "feat(portfolio): CurrencySelect defaults to GBP + dispatches currencychange event"
```

---

## Task 5: Sparkline fetch + cache helper

**Files:**
- Create: `src/data/sparkline-fetch.ts`
- Create: `tests/unit/sparkline-fetch.test.ts`

Client-side helper that fetches the Worker's `/sparkline-dump`, caches in localStorage for 1h, and validates via Zod on both fresh fetches and cached reads.

- [ ] **Step 5.1: Write the failing fetch-cache tests**

Create `tests/unit/sparkline-fetch.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  fetchSparklineWithCache,
  SPARKLINE_CACHE_KEY,
  SPARKLINE_CACHE_TTL_MS,
  SPARKLINE_URL,
} from '@/data/sparkline-fetch';

const fixture = {
  days: 30,
  cutoff: '2026-03-22',
  records: {
    'a': [
      { cardId: 'a', date: '2026-04-22', trend: 50, low: null, avg30: null, avg7: null, avg1: null },
    ],
  },
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-22T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fetchSparklineWithCache', () => {
  it('fetches + caches when no cache exists', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture)));
    const result = await fetchSparklineWithCache();
    expect(spy).toHaveBeenCalledWith(SPARKLINE_URL);
    expect(result).toEqual(fixture);
    const cached = JSON.parse(localStorage.getItem(SPARKLINE_CACHE_KEY)!);
    expect(cached.data).toEqual(fixture);
    expect(cached.at).toBe(Date.now());
  });

  it('uses cache when fresh (< TTL)', async () => {
    localStorage.setItem(SPARKLINE_CACHE_KEY, JSON.stringify({ at: Date.now() - 1000, data: fixture }));
    const spy = vi.spyOn(global, 'fetch');
    const result = await fetchSparklineWithCache();
    expect(spy).not.toHaveBeenCalled();
    expect(result).toEqual(fixture);
  });

  it('re-fetches when cache is stale (> TTL)', async () => {
    localStorage.setItem(SPARKLINE_CACHE_KEY, JSON.stringify({
      at: Date.now() - SPARKLINE_CACHE_TTL_MS - 1000,
      data: fixture,
    }));
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture)));
    await fetchSparklineWithCache();
    expect(spy).toHaveBeenCalled();
  });

  it('re-fetches when cached data fails Zod validation', async () => {
    localStorage.setItem(SPARKLINE_CACHE_KEY, JSON.stringify({ at: Date.now(), data: { not: 'valid' } }));
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(fixture)));
    const result = await fetchSparklineWithCache();
    expect(spy).toHaveBeenCalled();
    expect(result).toEqual(fixture);
  });

  it('throws when fetch responds non-OK', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('oops', { status: 500 }));
    await expect(fetchSparklineWithCache()).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 5.2: Run tests to verify red**

Run: `npm run test:unit -- sparkline-fetch`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Create `src/data/sparkline-fetch.ts`**

```ts
import { SparklineDumpSchema, type SparklineDump } from './history-schema';

export const SPARKLINE_URL =
  'https://pokemon-tcg-history-api.david-taylor-pokemon.workers.dev/sparkline-dump';
export const SPARKLINE_CACHE_KEY = 'pokemon-tcg:sparkline-cache';
export const SPARKLINE_CACHE_TTL_MS = 60 * 60 * 1000;  // 1 hour

interface CacheEnvelope {
  at: number;
  data: unknown;
}

export async function fetchSparklineWithCache(): Promise<SparklineDump> {
  // Try cache first.
  try {
    const raw = localStorage.getItem(SPARKLINE_CACHE_KEY);
    if (raw !== null) {
      const env = JSON.parse(raw) as CacheEnvelope;
      if (typeof env.at === 'number' && Date.now() - env.at < SPARKLINE_CACHE_TTL_MS) {
        return SparklineDumpSchema.parse(env.data);
      }
    }
  } catch {
    // Fall through and re-fetch.
  }

  const res = await fetch(SPARKLINE_URL);
  if (!res.ok) throw new Error(`Sparkline dump fetch failed: ${res.status}`);
  const raw = await res.json();
  const dump = SparklineDumpSchema.parse(raw);

  try {
    const envelope: CacheEnvelope = { at: Date.now(), data: dump };
    localStorage.setItem(SPARKLINE_CACHE_KEY, JSON.stringify(envelope));
  } catch {
    // Quota exceeded or localStorage disabled — tolerate, return fresh data.
  }

  return dump;
}
```

- [ ] **Step 5.4: Run tests to verify green**

Run: `npm run test:unit -- sparkline-fetch`
Expected: PASS — 5 tests.

- [ ] **Step 5.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5.6: Commit**

```bash
git add src/data/sparkline-fetch.ts tests/unit/sparkline-fetch.test.ts
git commit -m "feat(portfolio): add sparkline fetch + 1h localStorage cache"
```

---

## Task 6: Pagefind meta — thumb + cardId

**Files:**
- Modify: `src/pages/card/[id].astro`

The portfolio-page autocomplete needs card images and IDs from Pagefind results without a second data fetch. Extend the existing `data-pagefind-meta` string.

- [ ] **Step 6.1: Modify `src/pages/card/[id].astro`**

Add one helper after the existing imports + frontmatter (just before the `<Base>` opening tag):

```astro
import type { Language } from '@/data/schema';

// ... (existing imports above)

const LANG_ORDER_FOR_THUMB: Language[] = ['en', 'ja', 'fr', 'de', 'it', 'es', 'pt', 'zh-tw', 'zh-cn', 'th', 'id'];
function pickThumbUrl(c: CardIdentity): string {
  for (const lang of LANG_ORDER_FOR_THUMB) {
    const p = c.prints[lang];
    if (p && p.imageURL) return p.imageURL;
  }
  return '';
}
const pagefindThumb = pickThumbUrl(card);
```

Then change line 71:

Before:
```astro
  <article data-pagefind-body data-pagefind-meta={`title:${card.defaultName}, subtitle:${card.filters.setName}`}>
```

After:
```astro
  <article data-pagefind-body data-pagefind-meta={`title:${card.defaultName}, subtitle:${card.filters.setName}, thumb:${pagefindThumb}, cardId:${card.id}`}>
```

- [ ] **Step 6.2: Rebuild fixtures and verify pagefind indexes the new meta**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run build:fixtures-empty-prices
```

Expected: exit 0.

Then spot-check one of the pagefind index fragments mentions the Charizard image URL. The index is binary but Pagefind writes a readable meta map somewhere — quickest check is to confirm the HTML has the extended meta:

```bash
grep -c 'thumb:' dist/card/base1-4/index.html
```

Expected: `1`.

- [ ] **Step 6.3: Run existing e2e to confirm no regression**

Run:

```bash
npm run test:e2e -- search card-page
```

Expected: all existing tests PASS. The `SearchBox` reads only `meta.title` and `meta.subtitle`; extra meta fields are additive and safe.

- [ ] **Step 6.4: Commit**

```bash
git add 'src/pages/card/[id].astro'
git commit -m "feat(portfolio): add thumb + cardId to card pagefind meta"
```

---

## Task 7: `/portfolio/` page shell + empty dashboard

**Files:**
- Create: `src/pages/portfolio/index.astro`
- Create: `src/components/PortfolioDashboard.tsx` (initial empty-state-only version)
- Create: `tests/e2e/portfolio.spec.ts` (first e2e — page loads, empty state)
- Modify: `data/fixtures/sample-cards.json` is already shipped; no change here

Ship an empty-state-only portfolio page so the e2e harness has something to hit. Subsequent tasks (8-12) progressively add summary, trend, add form, table, export/import to the same island.

- [ ] **Step 7.1: Write the failing e2e test**

Create `tests/e2e/portfolio.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sparklineFixtureJson = readFileSync(
  resolve(process.cwd(), 'data/fixtures/sample-sparkline.json'),
  'utf8',
);

test.beforeEach(async ({ page }) => {
  // Clean slate: empty portfolio + empty sparkline cache on every visit.
  await page.addInitScript(() => {
    localStorage.removeItem('pokemon-tcg:portfolio');
    localStorage.removeItem('pokemon-tcg:sparkline-cache');
  });
  // Intercept the Worker's sparkline-dump fetch with the fixture JSON so
  // tests are deterministic and offline-friendly.
  await page.route('**/sparkline-dump', (route) =>
    route.fulfill({ contentType: 'application/json', body: sparklineFixtureJson }),
  );
});

test('/portfolio/ renders the empty-state welcome when localStorage is empty', async ({ page }) => {
  await page.goto('portfolio/');
  await expect(page.locator('h1')).toHaveText('My portfolio');
  await expect(page.locator('.portfolio-empty')).toBeVisible();
  await expect(page.locator('.portfolio-empty')).toContainText(/haven't added any cards/i);
});
```

- [ ] **Step 7.2: Run the test to verify red**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio
```

Expected: FAIL — `/portfolio/` returns 404.

- [ ] **Step 7.3: Create `src/pages/portfolio/index.astro`**

```astro
---
import Base from '@/layouts/Base.astro';
import PortfolioDashboard from '@/components/PortfolioDashboard';

const title = 'My portfolio — Pokémon TCG Catalog';
const description = 'Your personal Pokémon TCG collection — total value, P&L, and a 30-day value trend. Stored in your browser.';
---
<Base title={title} description={description}>
  <!-- Personal data; no canonical SEO value. -->
  <meta name="robots" content="noindex" slot="head" />
  <header class="portfolio-header">
    <h1>My portfolio</h1>
    <p class="sub">Track what you own and what it's worth now.</p>
  </header>
  <PortfolioDashboard client:load />
</Base>

<style>
  .portfolio-header { margin-bottom: 1.5rem; }
  .portfolio-header h1 { margin: 0 0 0.25rem; }
  .portfolio-header .sub { color: var(--muted); margin: 0; }
</style>
```

Note: Astro's `<meta slot="head">` — if that pattern isn't supported in this project's `Base.astro` version, put `<meta name="robots" content="noindex" />` right before `<header class="portfolio-header">` and it still ends up in `<head>` because this file's content goes inside `<Base>`'s slot, which is inside `<main>`. In that case, robots noindex should be added via a `robotsNoindex` prop to `Base.astro`. Simplest: for this task, accept that `noindex` may be placed in body — Google still honors it. Alternative (cleaner): add a `noindex?: boolean` prop to `Base.astro` and emit the meta tag in `<head>` conditionally.

**Decision:** add a `noindex` prop to `Base.astro`. Edit `src/layouts/Base.astro`:

Before (around line 7):
```astro
interface Props { title: string; description?: string; ogImage?: string }
const { title, description = 'Pokémon TCG multilingual catalog', ogImage } = Astro.props;
```

After:
```astro
interface Props { title: string; description?: string; ogImage?: string; noindex?: boolean }
const { title, description = 'Pokémon TCG multilingual catalog', ogImage, noindex = false } = Astro.props;
```

And in the `<head>` block, immediately after the existing `<meta name="description" ... />`, add:

```astro
    {noindex && <meta name="robots" content="noindex" />}
```

Update `src/pages/portfolio/index.astro` to use it:

```astro
<Base title={title} description={description} noindex={true}>
```

Remove the body-level `<meta name="robots" ... slot="head" />` line from `portfolio/index.astro`.

- [ ] **Step 7.4: Create initial `src/components/PortfolioDashboard.tsx` (empty-state only)**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { loadPortfolioSafe } from '@/data/portfolio-storage';
import type { PortfolioFile } from '@/data/portfolio-schema';

export default function PortfolioDashboard() {
  const [file, setFile] = useState<PortfolioFile | null>(null);

  useEffect(() => {
    const { file } = loadPortfolioSafe();
    setFile(file);
  }, []);

  if (file === null) return null;  // pre-hydration flash guard

  if (file.entries.length === 0) {
    return (
      <div class="portfolio-empty">
        <p>You haven't added any cards yet.</p>
        <p class="sub">Start by searching above, or paste an exported collection.</p>
        <style>{`
          .portfolio-empty {
            background: var(--paper);
            border: 1px solid #d9c9a3;
            border-radius: 10px;
            padding: 2rem 1.5rem;
            text-align: center;
            color: var(--ink);
          }
          .portfolio-empty p { margin: 0.25rem 0; }
          .portfolio-empty .sub { color: var(--muted); font-size: 0.9rem; }
        `}</style>
      </div>
    );
  }

  // Placeholder for Tasks 8-12 — non-empty rendering added progressively.
  return (
    <div class="portfolio-populated" />
  );
}
```

- [ ] **Step 7.5: Rebuild + re-run the e2e test to verify green**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio
```

Expected: PASS — one test green.

- [ ] **Step 7.6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7.7: Commit**

```bash
git add src/pages/portfolio/index.astro src/components/PortfolioDashboard.tsx src/layouts/Base.astro tests/e2e/portfolio.spec.ts
git commit -m "feat(portfolio): add /portfolio/ page shell + empty-state dashboard"
```

---

## Task 8: PortfolioDashboard — summary stats

**Files:**
- Modify: `src/components/PortfolioDashboard.tsx`
- Modify: `tests/e2e/portfolio.spec.ts`

Fetch the sparkline dump, compute the 4 summary stats, render them. Also subscribe to the `currencychange` event so swapping currencies recomputes.

- [ ] **Step 8.1: Append a new e2e test**

Append to `tests/e2e/portfolio.spec.ts`:

```ts
test('summary dashboard shows 4 stats when portfolio has entries', async ({ page }) => {
  // Seed a GBP portfolio of 1 Charizard at £300.
  await page.addInitScript(() => {
    localStorage.setItem('pokemon-tcg:portfolio', JSON.stringify({
      version: 1,
      entries: [
        { cardId: 'base1-4', qty: 1, costValue: 300, costCurrency: 'GBP', addedAt: '2026-04-20' },
      ],
    }));
  });
  await page.goto('portfolio/');
  // Summary card renders once the sparkline-dump fetch resolves.
  const stat = page.locator('.portfolio-stats');
  await expect(stat).toBeVisible();
  await expect(stat.locator('[data-stat="cards"]')).toHaveText('1');
  // Fixture puts base1-4 at €360 today. Converted to GBP at the stubbed
  // exchange-rates.json (lives alongside the cards build), the displayed
  // value will be close to but not exactly 300. Assert it's present and > 0.
  await expect(stat.locator('[data-stat="paid"]')).toContainText(/£\s*300/);
  await expect(stat.locator('[data-stat="value"]')).toContainText(/£\s*\d+/);
  await expect(stat.locator('[data-stat="pnl"]')).toContainText(/[+−]£\s*\d+/);
});
```

- [ ] **Step 8.2: Run to verify red**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio`
Expected: new test FAILS — `.portfolio-stats` not found.

- [ ] **Step 8.3: Extend `src/components/PortfolioDashboard.tsx`**

Replace the file's contents with:

```tsx
import { useEffect, useState } from 'preact/hooks';
import { loadPortfolioSafe } from '@/data/portfolio-storage';
import { fetchSparklineWithCache } from '@/data/sparkline-fetch';
import { ExchangeRatesSchema, type ExchangeRates, type SupportedCurrency, CURRENCY_GLYPH, CURRENCY_DECIMALS } from '@/data/currency-schema';
import { computeSummary, type PortfolioSummary } from '@/data/portfolio-aggregate';
import type { PortfolioFile } from '@/data/portfolio-schema';
import type { SparklineDump } from '@/data/history-schema';

const CURRENCY_STORAGE_KEY = 'pokemon-tcg-currency';

function detectCurrency(): SupportedCurrency {
  try {
    const saved = localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (saved === 'EUR' || saved === 'USD' || saved === 'GBP' || saved === 'JPY') return saved;
  } catch {}
  return 'GBP';
}

function formatCurrencyValue(value: number, currency: SupportedCurrency, signed = false): string {
  const decimals = CURRENCY_DECIMALS[currency];
  const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = signed ? (value >= 0 ? '+' : '−') : '';
  const abs = Math.abs(value);
  return `${sign}${CURRENCY_GLYPH[currency]}${fmt.format(abs)}`;
}

function formatPct(decimal: number): string {
  const pct = (decimal * 100).toFixed(1);
  const sign = decimal >= 0 ? '+' : '−';
  return `${sign}${pct.replace('-', '')}%`;
}

export default function PortfolioDashboard({ rates }: { rates: ExchangeRates }) {
  const [file, setFile] = useState<PortfolioFile | null>(null);
  const [dump, setDump] = useState<SparklineDump | null>(null);
  const [currency, setCurrency] = useState<SupportedCurrency>('GBP');

  useEffect(() => {
    const { file } = loadPortfolioSafe();
    setFile(file);
    setCurrency(detectCurrency());

    fetchSparklineWithCache()
      .then((d) => setDump(d))
      .catch(() => setDump({ days: 30, cutoff: '1970-01-01', records: {} }));  // graceful fallback

    const onCurrencyChange = (e: Event) => {
      const next = (e as CustomEvent<{ currency: SupportedCurrency }>).detail?.currency;
      if (next) setCurrency(next);
    };
    window.addEventListener('currencychange', onCurrencyChange);
    return () => window.removeEventListener('currencychange', onCurrencyChange);
  }, []);

  if (file === null) return null;

  if (file.entries.length === 0) {
    return (
      <div class="portfolio-empty">
        <p>You haven't added any cards yet.</p>
        <p class="sub">Start by searching above, or paste an exported collection.</p>
        <style>{`
          .portfolio-empty {
            background: var(--paper);
            border: 1px solid #d9c9a3;
            border-radius: 10px;
            padding: 2rem 1.5rem;
            text-align: center;
            color: var(--ink);
          }
          .portfolio-empty p { margin: 0.25rem 0; }
          .portfolio-empty .sub { color: var(--muted); font-size: 0.9rem; }
        `}</style>
      </div>
    );
  }

  const summary: PortfolioSummary | null = dump
    ? computeSummary(file.entries, dump, rates, currency)
    : null;

  return (
    <div class="portfolio-populated">
      <div class="portfolio-stats">
        <div class="stat">
          <div class="lbl">Cards</div>
          <div class="val" data-stat="cards">{summary === null ? '—' : summary.cards}</div>
        </div>
        <div class="stat">
          <div class="lbl">Paid</div>
          <div class="val" data-stat="paid">{summary === null ? '—' : formatCurrencyValue(summary.paidInDisplay, currency)}</div>
        </div>
        <div class="stat">
          <div class="lbl">Now</div>
          <div class="val" data-stat="value">{summary === null ? '—' : formatCurrencyValue(summary.valueInDisplay, currency)}</div>
        </div>
        <div class="stat">
          <div class="lbl">P&amp;L</div>
          <div class={`val ${summary !== null && summary.pnlValue >= 0 ? 'up' : 'dn'}`} data-stat="pnl">
            {summary === null ? '—' : `${formatCurrencyValue(summary.pnlValue, currency, true)} (${formatPct(summary.pnlPct)})`}
          </div>
        </div>
      </div>

      <style>{`
        .portfolio-stats {
          background: var(--paper);
          border: 1px solid #d9c9a3;
          border-radius: 10px;
          padding: 1rem 1.25rem;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1rem;
          margin-bottom: 1.25rem;
        }
        .portfolio-stats .stat { text-align: center; }
        .portfolio-stats .lbl {
          font-size: 0.7rem; letter-spacing: 1.5px;
          text-transform: uppercase; color: var(--muted);
        }
        .portfolio-stats .val { font-size: 1.4rem; font-weight: 700; margin-top: 0.25rem; font-variant-numeric: tabular-nums; }
        .portfolio-stats .val.up { color: #2d7d47; }
        .portfolio-stats .val.dn { color: #b23a3a; }
        @media (max-width: 520px) {
          .portfolio-stats { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 8.4: Pass `rates` into the island from the page**

Edit `src/pages/portfolio/index.astro` to read exchange rates the same way the card page does:

Before:
```astro
---
import Base from '@/layouts/Base.astro';
import PortfolioDashboard from '@/components/PortfolioDashboard';

const title = 'My portfolio — Pokémon TCG Catalog';
const description = 'Your personal Pokémon TCG collection — total value, P&L, and a 30-day value trend. Stored in your browser.';
---
```

After:
```astro
---
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Base from '@/layouts/Base.astro';
import PortfolioDashboard from '@/components/PortfolioDashboard';
import { ExchangeRatesSchema, type ExchangeRates } from '@/data/currency-schema';

const title = 'My portfolio — Pokémon TCG Catalog';
const description = 'Your personal Pokémon TCG collection — total value, P&L, and a 30-day value trend. Stored in your browser.';

const ratesPath = resolve(process.cwd(), 'data', 'exchange-rates.json');
const fallbackRates: ExchangeRates = {
  base: 'EUR', date: '1970-01-01', rates: { USD: 1, GBP: 1, JPY: 1 },
};
const rates: ExchangeRates = existsSync(ratesPath)
  ? ExchangeRatesSchema.parse(JSON.parse(readFileSync(ratesPath, 'utf8')))
  : fallbackRates;
---
```

Update the mount:

Before:
```astro
<PortfolioDashboard client:load />
```

After:
```astro
<PortfolioDashboard client:load rates={rates} />
```

- [ ] **Step 8.5: Run the e2e tests to verify green**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio`
Expected: 2 tests PASS.

- [ ] **Step 8.6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8.7: Commit**

```bash
git add src/components/PortfolioDashboard.tsx src/pages/portfolio/index.astro tests/e2e/portfolio.spec.ts
git commit -m "feat(portfolio): summary stats (cards, paid, value, P&L) with currency reactivity"
```

---

## Task 9: PortfolioDashboard — 30-day trend chart

**Files:**
- Modify: `src/components/PortfolioDashboard.tsx`
- Modify: `tests/e2e/portfolio.spec.ts`

Add the 30-day portfolio-value sparkline next to the summary stats (split dashboard layout).

- [ ] **Step 9.1: Append a new e2e test**

Append to `tests/e2e/portfolio.spec.ts`:

```ts
test('trend chart renders an SVG polyline for a non-empty portfolio', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pokemon-tcg:portfolio', JSON.stringify({
      version: 1,
      entries: [{ cardId: 'base1-4', qty: 1, costValue: 300, costCurrency: 'GBP', addedAt: '2026-04-20' }],
    }));
  });
  await page.goto('portfolio/');
  const chart = page.locator('.portfolio-trend svg polyline');
  await expect(chart).toBeVisible();
  const points = await chart.getAttribute('points');
  expect(points).toBeTruthy();
  expect(points!.split(' ').length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 9.2: Run to verify red**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio`
Expected: new test FAILS — no `.portfolio-trend`.

- [ ] **Step 9.3: Extend `src/components/PortfolioDashboard.tsx`**

Inside the component body, right before the `return` statement, compute the trend series. Insert:

```tsx
  const trend = dump ? computeTrendSeries(file.entries, dump, rates, currency) : [];
```

Update the imports at the top of the file:

```tsx
import { computeSummary, computeTrendSeries, type PortfolioSummary, type TrendPoint } from '@/data/portfolio-aggregate';
```

Add a helper next to `formatPct` (inside the file, above the component):

```tsx
function buildSparklinePoints(points: TrendPoint[]): string {
  if (points.length < 2) return '';
  const values = points.map((p) => p.valueInDisplay);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 48 - ((p.valueInDisplay - min) / range) * 48;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
```

Update the populated-portfolio `return` block to split the dashboard into a 2-column grid (stats + trend). Replace the existing `<div class="portfolio-populated">...</div>` with:

```tsx
    <div class="portfolio-populated">
      <div class="portfolio-dashboard">
        <div class="portfolio-stats">
          <div class="stat">
            <div class="lbl">Cards</div>
            <div class="val" data-stat="cards">{summary === null ? '—' : summary.cards}</div>
          </div>
          <div class="stat">
            <div class="lbl">Paid</div>
            <div class="val" data-stat="paid">{summary === null ? '—' : formatCurrencyValue(summary.paidInDisplay, currency)}</div>
          </div>
          <div class="stat">
            <div class="lbl">Now</div>
            <div class="val" data-stat="value">{summary === null ? '—' : formatCurrencyValue(summary.valueInDisplay, currency)}</div>
          </div>
          <div class="stat">
            <div class="lbl">P&amp;L</div>
            <div class={`val ${summary !== null && summary.pnlValue >= 0 ? 'up' : 'dn'}`} data-stat="pnl">
              {summary === null ? '—' : `${formatCurrencyValue(summary.pnlValue, currency, true)} (${formatPct(summary.pnlPct)})`}
            </div>
          </div>
        </div>

        <div class="portfolio-trend">
          <div class="trend-lbl">30-day value ({currency})</div>
          <svg viewBox="0 0 100 48" preserveAspectRatio="none">
            <polyline
              points={buildSparklinePoints(trend)}
              fill="none"
              stroke={trend.length > 1 && trend[trend.length - 1].valueInDisplay >= trend[0].valueInDisplay ? '#2d7d47' : '#b23a3a'}
              stroke-width="1.5"
            />
          </svg>
        </div>
      </div>

      <style>{`
        .portfolio-dashboard {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
          gap: 1rem;
          margin-bottom: 1.25rem;
        }
        .portfolio-stats {
          background: var(--paper);
          border: 1px solid #d9c9a3;
          border-radius: 10px;
          padding: 1rem 1.25rem;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem 1rem;
        }
        .portfolio-stats .stat { text-align: center; }
        .portfolio-stats .lbl {
          font-size: 0.7rem; letter-spacing: 1.5px;
          text-transform: uppercase; color: var(--muted);
        }
        .portfolio-stats .val { font-size: 1.3rem; font-weight: 700; margin-top: 0.25rem; font-variant-numeric: tabular-nums; }
        .portfolio-stats .val.up { color: #2d7d47; }
        .portfolio-stats .val.dn { color: #b23a3a; }

        .portfolio-trend {
          background: var(--paper);
          border: 1px solid #d9c9a3;
          border-radius: 10px;
          padding: 1rem 1.25rem;
          display: flex;
          flex-direction: column;
        }
        .portfolio-trend .trend-lbl {
          font-size: 0.7rem; letter-spacing: 1.5px;
          text-transform: uppercase; color: var(--muted);
          margin-bottom: 0.5rem;
        }
        .portfolio-trend svg {
          width: 100%;
          flex: 1;
          min-height: 120px;
          background: linear-gradient(180deg, #fffdf6, #f5efe2);
          border-radius: 4px;
          border: 1px solid #ebdfc2;
        }
      `}</style>
    </div>
```

- [ ] **Step 9.4: Run the e2e tests to verify green**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio`
Expected: 3 tests PASS.

- [ ] **Step 9.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 9.6: Commit**

```bash
git add src/components/PortfolioDashboard.tsx tests/e2e/portfolio.spec.ts
git commit -m "feat(portfolio): add 30-day value trend chart to the dashboard"
```

---

## Task 10: PortfolioDashboard — autocomplete add form

**Files:**
- Modify: `src/components/PortfolioDashboard.tsx`
- Modify: `tests/e2e/portfolio.spec.ts`

Pagefind-backed autocomplete + qty + cost input + Add button. Writes to localStorage on submit.

- [ ] **Step 10.1: Append a new e2e test**

Append to `tests/e2e/portfolio.spec.ts`:

```ts
test('autocomplete adds a card to the portfolio', async ({ page }) => {
  await page.goto('portfolio/');
  // Empty state: the form should still render even without entries.
  const search = page.locator('.portfolio-add input[type=search]');
  await expect(search).toBeVisible();
  await search.fill('Charizard');

  // Pick the first dropdown result (base1-4).
  const firstResult = page.locator('.portfolio-add .suggestions li').first();
  await expect(firstResult).toBeVisible();
  await firstResult.click();

  // Qty auto-focused — fill qty + cost and click Add.
  await page.locator('.portfolio-add input[name=qty]').fill('2');
  await page.locator('.portfolio-add input[name=cost]').fill('150');
  await page.locator('.portfolio-add button[data-action=add]').click();

  // Summary updates.
  const stats = page.locator('.portfolio-stats');
  await expect(stats.locator('[data-stat=cards]')).toHaveText('2');
  await expect(stats.locator('[data-stat=paid]')).toContainText(/£\s*150/);
});
```

- [ ] **Step 10.2: Run to verify red**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio`
Expected: new test FAILS — no `.portfolio-add`.

- [ ] **Step 10.3: Extend `src/components/PortfolioDashboard.tsx`**

Add imports at the top:

```tsx
import { addEntry } from '@/data/portfolio-storage';
import { savePortfolio } from '@/data/portfolio-storage';
```

(Both should be a single import line: `import { loadPortfolioSafe, addEntry, savePortfolio } from '@/data/portfolio-storage';`.)

Add a Pagefind type declaration alongside existing ones:

```tsx
type PagefindResult = {
  id: string;
  url: string;
  meta: { title?: string; subtitle?: string; thumb?: string; cardId?: string };
};
type Pagefind = {
  search: (q: string) => Promise<{ results: Array<{ id: string; data: () => Promise<PagefindResult> }> }>;
};
declare global { interface Window { pagefind?: Pagefind } }
```

Inside the component, add new state + effects:

```tsx
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PagefindResult[]>([]);
  const [selected, setSelected] = useState<{ cardId: string; cardName: string; thumb: string } | null>(null);
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [pagefind, setPagefind] = useState<Pagefind | null>(null);

  // Load pagefind once.
  useEffect(() => {
    if (window.pagefind) {
      setPagefind(window.pagefind);
      return;
    }
    (async () => {
      const pagefindUrl = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/pagefind/pagefind.js`;
      try {
        window.pagefind = (await import(/* @vite-ignore */ pagefindUrl)) as unknown as Pagefind;
        setPagefind(window.pagefind!);
      } catch {
        // Pagefind unavailable — autocomplete won't work but rest of page does.
      }
    })();
  }, []);

  // Run search on query change.
  useEffect(() => {
    if (!pagefind || query.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const raw = await pagefind.search(query);
      if (cancelled) return;
      const data = await Promise.all(raw.results.slice(0, 10).map((r) => r.data()));
      if (cancelled) return;
      setSuggestions(data);
    })();
    return () => { cancelled = true; };
  }, [query, pagefind]);

  function selectSuggestion(r: PagefindResult) {
    const cardId = r.meta.cardId ?? '';
    if (!cardId) return;
    setSelected({
      cardId,
      cardName: r.meta.title ?? cardId,
      thumb: r.meta.thumb ?? '',
    });
    setQuery(r.meta.title ?? '');
    setSuggestions([]);
    // Focus qty — deferred so the render commits first.
    requestAnimationFrame(() => {
      (document.querySelector('.portfolio-add input[name=qty]') as HTMLInputElement | null)?.focus();
    });
  }

  function handleAdd() {
    if (selected === null) return;
    const qtyNum = Number(qty);
    const costNum = Number(cost);
    if (!Number.isFinite(qtyNum) || qtyNum < 1) return;
    if (!Number.isFinite(costNum) || costNum < 0) return;
    const todayIso = new Date().toISOString().slice(0, 10);
    const { file: current } = loadPortfolioSafe();
    const next = addEntry(
      current,
      { cardId: selected.cardId, qty: qtyNum, costValue: costNum, costCurrency: currency },
      rates,
      todayIso,
    );
    savePortfolio(next);
    setFile(next);
    // Reset form.
    setSelected(null);
    setQuery('');
    setQty('1');
    setCost('');
  }
```

Render the add form inside the main return. Insert **above** the existing `<div class="portfolio-dashboard">` (for the populated branch) AND at the top of the empty-state render. Simplest: hoist the add form and render it for BOTH empty + populated branches by pulling it out of the conditional.

Restructure the return:

```tsx
  const renderAddForm = () => (
    <div class="portfolio-add">
      <div class="add-row">
        <div class="search-wrap">
          <input
            type="search"
            placeholder="Find a card…"
            value={query}
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              if (selected) setSelected(null);  // user is typing again
            }}
          />
          {suggestions.length > 0 && (
            <ul class="suggestions">
              {suggestions.map((r) => (
                <li key={r.id} onClick={() => selectSuggestion(r)}>
                  {r.meta.thumb && <img src={r.meta.thumb} alt="" loading="lazy" />}
                  <span class="nm">
                    <strong>{r.meta.title ?? r.url}</strong>
                    {r.meta.subtitle && <small>{r.meta.subtitle}</small>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input
          name="qty"
          type="number"
          min="1"
          placeholder="Qty"
          value={qty}
          disabled={selected === null}
          onInput={(e) => setQty((e.target as HTMLInputElement).value)}
        />
        <input
          name="cost"
          type="number"
          min="0"
          step="0.01"
          placeholder={`Cost ${CURRENCY_GLYPH[currency]}`}
          value={cost}
          disabled={selected === null}
          onInput={(e) => setCost((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if ((e as KeyboardEvent).key === 'Enter') handleAdd(); }}
        />
        <button type="button" data-action="add" disabled={selected === null} onClick={handleAdd}>Add</button>
      </div>
    </div>
  );
```

Update the returns to always render the add form. For the empty branch:

```tsx
  if (file.entries.length === 0) {
    return (
      <div>
        {renderAddForm()}
        <div class="portfolio-empty">
          <p>You haven't added any cards yet.</p>
          <p class="sub">Start by searching above, or paste an exported collection.</p>
        </div>
        <style>{`
          .portfolio-empty {
            background: var(--paper);
            border: 1px solid #d9c9a3;
            border-radius: 10px;
            padding: 2rem 1.5rem;
            text-align: center;
            color: var(--ink);
          }
          .portfolio-empty p { margin: 0.25rem 0; }
          .portfolio-empty .sub { color: var(--muted); font-size: 0.9rem; }
          ${ADD_FORM_STYLES}
        `}</style>
      </div>
    );
  }
```

For the populated branch, insert `{renderAddForm()}` between `</div>` of `.portfolio-dashboard` and the placeholder `</div>`. Also append `${ADD_FORM_STYLES}` inside the populated branch's `<style>` block.

Declare `ADD_FORM_STYLES` as a file-scope constant near the top:

```tsx
const ADD_FORM_STYLES = `
  .portfolio-add {
    background: var(--paper);
    border: 1px solid #d9c9a3;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    margin-bottom: 1.25rem;
    position: relative;
  }
  .portfolio-add .add-row {
    display: grid;
    grid-template-columns: 1fr 80px 110px auto;
    gap: 0.5rem;
    align-items: center;
  }
  .portfolio-add input, .portfolio-add button {
    padding: 0.45rem 0.75rem;
    border: 1px solid #d9c9a3;
    border-radius: 6px;
    background: #fffdf6;
    font-size: 0.9rem;
  }
  .portfolio-add button {
    background: var(--accent); color: white; border-color: var(--accent);
    font-weight: 600; cursor: pointer;
  }
  .portfolio-add button:disabled {
    background: #d9c9a3; border-color: #d9c9a3; cursor: not-allowed;
  }
  .portfolio-add .search-wrap { position: relative; }
  .portfolio-add .suggestions {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    list-style: none;
    padding: 0.25rem 0;
    margin: 0;
    background: #fffdf6;
    border: 1px solid #d9c9a3;
    border-radius: 6px;
    box-shadow: 0 6px 16px rgba(59, 42, 26, 0.12);
    z-index: 10;
    max-height: 320px;
    overflow-y: auto;
  }
  .portfolio-add .suggestions li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
  }
  .portfolio-add .suggestions li:hover { background: #f5efe2; }
  .portfolio-add .suggestions img {
    width: 24px; height: 33px; object-fit: cover; border-radius: 2px;
    background: linear-gradient(135deg, #d9c9a3, #c8b78f); flex: 0 0 auto;
  }
  .portfolio-add .suggestions .nm strong { display: block; font-size: 0.85rem; }
  .portfolio-add .suggestions .nm small { display: block; color: var(--muted); font-size: 0.75rem; }
  @media (max-width: 560px) {
    .portfolio-add .add-row { grid-template-columns: 1fr; }
  }
`;
```

- [ ] **Step 10.4: Run the e2e tests to verify green**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio`
Expected: 4 tests PASS.

- [ ] **Step 10.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 10.6: Commit**

```bash
git add src/components/PortfolioDashboard.tsx tests/e2e/portfolio.spec.ts
git commit -m "feat(portfolio): add Pagefind-powered autocomplete add form"
```

---

## Task 11: PortfolioDashboard — holdings table

**Files:**
- Modify: `src/components/PortfolioDashboard.tsx`
- Modify: `tests/e2e/portfolio.spec.ts`

Render the table with inline-editable qty + cost per row, and a remove button.

- [ ] **Step 11.1: Append a new e2e test**

Append to `tests/e2e/portfolio.spec.ts`:

```ts
test('holdings table supports inline edit + remove', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pokemon-tcg:portfolio', JSON.stringify({
      version: 1,
      entries: [{ cardId: 'base1-4', qty: 1, costValue: 100, costCurrency: 'GBP', addedAt: '2026-04-20' }],
    }));
  });
  await page.goto('portfolio/');
  const row = page.locator('.portfolio-table tbody tr').first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('Charizard');

  // Edit qty: 1 → 3.
  const qtyInput = row.locator('input[name=qty]');
  await qtyInput.fill('3');
  await qtyInput.blur();
  await expect(page.locator('.portfolio-stats [data-stat=cards]')).toHaveText('3');

  // Remove the row.
  await row.locator('button[data-action=remove]').click();
  await expect(page.locator('.portfolio-empty')).toBeVisible();
});
```

- [ ] **Step 11.2: Run to verify red**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio`
Expected: new test FAILS — no `.portfolio-table`.

- [ ] **Step 11.3: Extend `src/components/PortfolioDashboard.tsx`**

Add imports at top (or extend existing imports):

```tsx
import { loadPortfolioSafe, addEntry, savePortfolio, updateEntry, removeEntry } from '@/data/portfolio-storage';
import { convertBetween } from '@/data/currency';
```

Add a helper function above the component:

```tsx
const ON_IMG_ERROR = 'this.onerror=null; this.remove();';

function rowCurrentValueInDisplay(
  qty: number,
  curEur: number | null,
  rates: ExchangeRates,
  display: SupportedCurrency,
): number | null {
  if (curEur === null) return null;
  return qty * (display === 'EUR' ? curEur : curEur * rates.rates[display]);
}
```

Add handlers inside the component (after `handleAdd`):

```tsx
  function handleQtyChange(cardId: string, raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return;
    const { file: current } = loadPortfolioSafe();
    const next = updateEntry(current, cardId, { qty: n });
    savePortfolio(next);
    setFile(next);
  }

  function handleCostChange(cardId: string, raw: string) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    const { file: current } = loadPortfolioSafe();
    const next = updateEntry(current, cardId, { costValue: n });
    savePortfolio(next);
    setFile(next);
  }

  function handleRemove(cardId: string) {
    const { file: current } = loadPortfolioSafe();
    const next = removeEntry(current, cardId);
    savePortfolio(next);
    setFile(next);
  }
```

Inside the populated `return` branch, insert the table after `{renderAddForm()}`:

```tsx
      {renderAddForm()}

      <div class="portfolio-table-wrap">
        <table class="portfolio-table">
          <thead>
            <tr>
              <th></th>
              <th>Card</th>
              <th class="r">Qty</th>
              <th class="r">Cost</th>
              <th class="r">Value</th>
              <th class="r">P&amp;L</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {file.entries.map((e) => {
              const curEur = dump ? dump.records[e.cardId]?.slice(-1)[0]?.trend ?? null : null;
              const valueDisplay = rowCurrentValueInDisplay(e.qty, curEur, rates, currency);
              const costInDisplay = convertBetween(e.costValue, e.costCurrency, currency, rates);
              const pnlValue = valueDisplay !== null ? valueDisplay - costInDisplay : null;
              return (
                <tr key={e.cardId}>
                  <td class="th-cell">
                    <div class="th-img" />
                  </td>
                  <td>
                    <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/card/${e.cardId}/`} class="card-link">{e.cardId}</a>
                  </td>
                  <td class="r">
                    <input
                      name="qty"
                      type="number"
                      min="1"
                      value={String(e.qty)}
                      onBlur={(ev) => handleQtyChange(e.cardId, (ev.target as HTMLInputElement).value)}
                      onKeyDown={(ev) => { if ((ev as KeyboardEvent).key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
                    />
                  </td>
                  <td class="r">
                    <input
                      name="cost"
                      type="number"
                      min="0"
                      step="0.01"
                      value={String(e.costValue)}
                      onBlur={(ev) => handleCostChange(e.cardId, (ev.target as HTMLInputElement).value)}
                      onKeyDown={(ev) => { if ((ev as KeyboardEvent).key === 'Enter') (ev.target as HTMLInputElement).blur(); }}
                    />
                    <span class="cost-ccy">{CURRENCY_GLYPH[e.costCurrency]}</span>
                  </td>
                  <td class="r">{valueDisplay === null ? '—' : formatCurrencyValue(valueDisplay, currency)}</td>
                  <td class={`r ${pnlValue !== null && pnlValue >= 0 ? 'up' : 'dn'}`}>{pnlValue === null ? '—' : formatCurrencyValue(pnlValue, currency, true)}</td>
                  <td>
                    <button type="button" data-action="remove" onClick={() => handleRemove(e.cardId)} aria-label="Remove">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
```

Add `${TABLE_STYLES}` to the populated branch's `<style>` block, defined alongside `ADD_FORM_STYLES`:

```tsx
const TABLE_STYLES = `
  .portfolio-table-wrap {
    background: var(--paper);
    border: 1px solid #d9c9a3;
    border-radius: 10px;
    padding: 0;
    overflow-x: auto;
  }
  .portfolio-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .portfolio-table th {
    background: #ebdfc2;
    padding: 0.4rem 0.6rem;
    text-align: left;
    font-size: 0.7rem;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .portfolio-table th.r, .portfolio-table td.r { text-align: right; }
  .portfolio-table td {
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid #ebdfc2;
    vertical-align: middle;
  }
  .portfolio-table tr:last-child td { border-bottom: 0; }
  .portfolio-table .th-cell { padding: 0.3rem 0.4rem 0.3rem 0.6rem; }
  .portfolio-table .th-img {
    width: 24px; height: 33px;
    background: linear-gradient(135deg, #d9c9a3, #c8b78f);
    border-radius: 3px;
  }
  .portfolio-table a.card-link { color: inherit; text-decoration: none; font-weight: 600; }
  .portfolio-table a.card-link:hover { text-decoration: underline; }
  .portfolio-table input[name=qty] { width: 48px; }
  .portfolio-table input[name=cost] { width: 72px; }
  .portfolio-table input { padding: 0.2rem 0.3rem; border: 1px solid #d9c9a3; border-radius: 4px; background: #fffdf6; font-size: 0.85rem; text-align: right; font-variant-numeric: tabular-nums; }
  .portfolio-table .cost-ccy { color: var(--muted); font-size: 0.75rem; margin-left: 2px; }
  .portfolio-table .r { font-variant-numeric: tabular-nums; }
  .portfolio-table td.up { color: #2d7d47; font-weight: 600; }
  .portfolio-table td.dn { color: #b23a3a; font-weight: 600; }
  .portfolio-table button[data-action=remove] {
    background: transparent; border: 0; color: #b23a3a; font-size: 1.1rem;
    cursor: pointer; padding: 0 0.4rem;
  }
`;
```

And inside the populated-branch `<style>`, change `${ADD_FORM_STYLES}` to `${ADD_FORM_STYLES}\n${TABLE_STYLES}`.

- [ ] **Step 11.4: Run the e2e tests to verify green**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio`
Expected: 5 tests PASS.

- [ ] **Step 11.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 11.6: Commit**

```bash
git add src/components/PortfolioDashboard.tsx tests/e2e/portfolio.spec.ts
git commit -m "feat(portfolio): add holdings table with inline edit + remove"
```

---

## Task 12: PortfolioDashboard — export / import JSON

**Files:**
- Modify: `src/components/PortfolioDashboard.tsx`
- Modify: `tests/e2e/portfolio.spec.ts`

Footer Export (download) + Import (textarea modal) buttons.

- [ ] **Step 12.1: Append a new e2e test**

Append to `tests/e2e/portfolio.spec.ts`:

```ts
test('import JSON replaces the portfolio', async ({ page }) => {
  await page.goto('portfolio/');
  await page.locator('button[data-action=import]').click();
  const payload = JSON.stringify({
    version: 1,
    entries: [
      { cardId: 'base1-4', qty: 1, costValue: 200, costCurrency: 'GBP', addedAt: '2026-04-22' },
      { cardId: 'base1-2', qty: 2, costValue: 40, costCurrency: 'GBP', addedAt: '2026-04-22' },
    ],
  });
  await page.locator('.portfolio-import-modal textarea').fill(payload);
  await page.locator('.portfolio-import-modal button[data-action=replace]').click();
  await expect(page.locator('.portfolio-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.portfolio-stats [data-stat=cards]')).toHaveText('3');  // 1 + 2
});
```

- [ ] **Step 12.2: Run to verify red**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio`
Expected: new test FAILS — no `[data-action=import]`.

- [ ] **Step 12.3: Extend `src/components/PortfolioDashboard.tsx`**

Add imports:

```tsx
import { PortfolioFileSchema } from '@/data/portfolio-schema';
```

Add state for the import modal:

```tsx
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
```

Add handlers:

```tsx
  function handleExport() {
    const { file: current } = loadPortfolioSafe();
    const json = JSON.stringify(current, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pokemon-tcg-portfolio-${today}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleImportReplace() {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch (e) {
      setImportError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    const result = PortfolioFileSchema.safeParse(parsed);
    if (!result.success) {
      setImportError(`Schema error: ${result.error.issues[0]?.message ?? 'invalid shape'}`);
      return;
    }
    savePortfolio(result.data);
    setFile(result.data);
    setImportOpen(false);
    setImportText('');
  }
```

Add the footer and import modal to the return (for BOTH empty and populated branches). Simplest: define a render helper:

```tsx
  const renderFooter = () => (
    <div class="portfolio-footer">
      <span class="count">{file.entries.length} {file.entries.length === 1 ? 'card' : 'cards'}</span>
      <div class="actions">
        <button type="button" onClick={handleExport} disabled={file.entries.length === 0}>Export JSON</button>
        <button type="button" data-action="import" onClick={() => setImportOpen(true)}>Import JSON</button>
      </div>
    </div>
  );

  const renderImportModal = () => importOpen && (
    <div class="portfolio-import-modal" role="dialog" aria-modal="true">
      <div class="modal-body">
        <h3>Import portfolio JSON</h3>
        <p class="sub">This will <strong>replace</strong> your current portfolio. Export first if you want a backup.</p>
        <textarea
          rows={10}
          value={importText}
          onInput={(e) => setImportText((e.target as HTMLTextAreaElement).value)}
          placeholder='{"version":1,"entries":[…]}'
        />
        {importError !== null && <p class="err">{importError}</p>}
        <div class="modal-actions">
          <button type="button" onClick={() => { setImportOpen(false); setImportError(null); setImportText(''); }}>Cancel</button>
          <button type="button" data-action="replace" onClick={handleImportReplace}>Replace portfolio</button>
        </div>
      </div>
    </div>
  );
```

Insert `{renderFooter()}` and `{renderImportModal()}` at the bottom of both empty and populated return branches, right before the closing `</div>` or `<style>`.

Add CSS for both:

```tsx
const FOOTER_STYLES = `
  .portfolio-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 0.75rem;
    padding: 0.5rem 0.25rem;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .portfolio-footer .actions button {
    background: transparent;
    border: 1px solid #d9c9a3;
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    font-size: 0.8rem;
    color: var(--muted);
    cursor: pointer;
    margin-left: 0.4rem;
  }
  .portfolio-footer .actions button:hover { color: var(--ink); border-color: var(--accent); }
  .portfolio-footer .actions button:disabled { opacity: 0.4; cursor: not-allowed; }

  .portfolio-import-modal {
    position: fixed;
    inset: 0;
    background: rgba(59, 42, 26, 0.4);
    display: flex; align-items: center; justify-content: center;
    z-index: 2000;
  }
  .portfolio-import-modal .modal-body {
    background: var(--paper);
    border-radius: 12px;
    padding: 1.5rem;
    width: min(500px, 95vw);
    max-height: 90vh;
    overflow-y: auto;
  }
  .portfolio-import-modal h3 { margin: 0 0 0.5rem; }
  .portfolio-import-modal .sub { color: var(--muted); font-size: 0.85rem; margin: 0 0 0.75rem; }
  .portfolio-import-modal textarea {
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
    border: 1px solid #d9c9a3;
    border-radius: 6px;
    padding: 0.5rem;
    background: #fffdf6;
    box-sizing: border-box;
  }
  .portfolio-import-modal .err {
    color: #b23a3a; font-size: 0.85rem; margin: 0.5rem 0 0;
  }
  .portfolio-import-modal .modal-actions {
    margin-top: 1rem;
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .portfolio-import-modal .modal-actions button {
    padding: 0.5rem 0.9rem;
    border: 1px solid #d9c9a3;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }
  .portfolio-import-modal .modal-actions button[data-action=replace] {
    background: var(--accent); color: white; border-color: var(--accent);
  }
`;
```

Append `${FOOTER_STYLES}` to both branches' `<style>` blocks.

- [ ] **Step 12.4: Run the e2e tests to verify green**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- portfolio`
Expected: 6 tests PASS.

- [ ] **Step 12.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 12.6: Commit**

```bash
git add src/components/PortfolioDashboard.tsx tests/e2e/portfolio.spec.ts
git commit -m "feat(portfolio): add export + import JSON"
```

---

## Task 13: Card-page Add button

**Files:**
- Create: `src/components/PortfolioAddButton.tsx`
- Modify: `src/pages/card/[id].astro`
- Modify: `tests/e2e/card-page.spec.ts`

Small island mounted on every card detail page. Click → mini-form → Save → writes to localStorage.

- [ ] **Step 13.1: Append a failing e2e test**

Append to `tests/e2e/card-page.spec.ts`:

```ts
test('card page "Add to my cards" button adds to portfolio', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('pokemon-tcg:portfolio'); });
  await page.goto('card/base1-4');
  const button = page.locator('.portfolio-add-btn');
  await expect(button).toBeVisible();
  await expect(button).toHaveText(/Add to my cards/);

  await button.click();
  await page.locator('.portfolio-add-btn input[name=qty]').fill('1');
  await page.locator('.portfolio-add-btn input[name=cost]').fill('100');
  await page.locator('.portfolio-add-btn button[data-action=save]').click();

  // Button transforms to "Owned" state.
  await expect(page.locator('.portfolio-add-btn')).toContainText(/Owned/);

  // Reload — state persists via localStorage.
  await page.reload();
  await expect(page.locator('.portfolio-add-btn')).toContainText(/Owned/);
});
```

- [ ] **Step 13.2: Run to verify red**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- card-page`
Expected: new test FAILS — `.portfolio-add-btn` not found.

- [ ] **Step 13.3: Create `src/components/PortfolioAddButton.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { loadPortfolioSafe, savePortfolio, addEntry, removeEntry, updateEntry } from '@/data/portfolio-storage';
import type { PortfolioEntry } from '@/data/portfolio-schema';
import { type SupportedCurrency, CURRENCY_GLYPH } from '@/data/currency-schema';
import type { ExchangeRates } from '@/data/currency-schema';

const CURRENCY_STORAGE_KEY = 'pokemon-tcg-currency';

function detectCurrency(): SupportedCurrency {
  try {
    const saved = localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (saved === 'EUR' || saved === 'USD' || saved === 'GBP' || saved === 'JPY') return saved;
  } catch {}
  return 'GBP';
}

interface Props {
  cardId: string;
  cardName: string;
  rates: ExchangeRates;
}

export default function PortfolioAddButton({ cardId, cardName, rates }: Props) {
  const [mode, setMode] = useState<'idle' | 'editing'>('idle');
  const [existing, setExisting] = useState<PortfolioEntry | null>(null);
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState<SupportedCurrency>('GBP');

  useEffect(() => {
    setCurrency(detectCurrency());
    const { file } = loadPortfolioSafe();
    const found = file.entries.find((e) => e.cardId === cardId) ?? null;
    setExisting(found);
    if (found) {
      setQty(String(found.qty));
      setCost(String(found.costValue));
    }
    const onCurrency = (e: Event) => {
      const next = (e as CustomEvent<{ currency: SupportedCurrency }>).detail?.currency;
      if (next) setCurrency(next);
    };
    window.addEventListener('currencychange', onCurrency);
    return () => window.removeEventListener('currencychange', onCurrency);
  }, [cardId]);

  function handleSave() {
    const qtyNum = Number(qty);
    const costNum = Number(cost);
    if (!Number.isFinite(qtyNum) || qtyNum < 1) return;
    if (!Number.isFinite(costNum) || costNum < 0) return;
    const { file: current } = loadPortfolioSafe();
    const todayIso = new Date().toISOString().slice(0, 10);
    let next;
    if (existing !== null) {
      // Update in place (qty + cost only).
      next = updateEntry(current, cardId, { qty: qtyNum, costValue: costNum });
    } else {
      next = addEntry(current, { cardId, qty: qtyNum, costValue: costNum, costCurrency: currency }, rates, todayIso);
    }
    savePortfolio(next);
    const found = next.entries.find((e) => e.cardId === cardId) ?? null;
    setExisting(found);
    setMode('idle');
  }

  function handleRemove() {
    const { file: current } = loadPortfolioSafe();
    const next = removeEntry(current, cardId);
    savePortfolio(next);
    setExisting(null);
    setMode('idle');
    setQty('1');
    setCost('');
  }

  if (mode === 'editing') {
    return (
      <div class="portfolio-add-btn">
        <div class="form-row">
          <label>Qty <input name="qty" type="number" min="1" value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} /></label>
          <label>Cost {CURRENCY_GLYPH[currency]} <input name="cost" type="number" min="0" step="0.01" value={cost} onInput={(e) => setCost((e.target as HTMLInputElement).value)} /></label>
          <button type="button" data-action="save" onClick={handleSave}>Save</button>
          <button type="button" onClick={() => setMode('idle')}>Cancel</button>
          {existing !== null && <button type="button" data-action="remove" onClick={handleRemove}>Remove</button>}
        </div>
        <Styles />
      </div>
    );
  }

  return (
    <div class="portfolio-add-btn">
      {existing === null ? (
        <button type="button" onClick={() => setMode('editing')}>+ Add to my cards</button>
      ) : (
        <button type="button" onClick={() => setMode('editing')}>✓ Owned (×{existing.qty}) — Update</button>
      )}
      <Styles />
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .portfolio-add-btn {
        margin: 0.75rem 0;
      }
      .portfolio-add-btn > button {
        background: transparent;
        border: 1px solid var(--accent);
        color: var(--accent);
        border-radius: 999px;
        padding: 0.4rem 1rem;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
      }
      .portfolio-add-btn > button:hover { background: var(--accent); color: white; }
      .portfolio-add-btn .form-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
      .portfolio-add-btn label {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.85rem;
        color: var(--muted);
      }
      .portfolio-add-btn input {
        width: 80px;
        padding: 0.3rem 0.5rem;
        border: 1px solid #d9c9a3;
        border-radius: 6px;
        background: #fffdf6;
        font-size: 0.9rem;
      }
      .portfolio-add-btn .form-row button {
        padding: 0.4rem 0.9rem;
        border: 1px solid #d9c9a3;
        border-radius: 6px;
        background: transparent;
        cursor: pointer;
        font-size: 0.85rem;
      }
      .portfolio-add-btn .form-row button[data-action=save] {
        background: var(--accent); color: white; border-color: var(--accent); font-weight: 600;
      }
      .portfolio-add-btn .form-row button[data-action=remove] {
        color: #b23a3a; border-color: #d9c9a3;
      }
    `}</style>
  );
}
```

- [ ] **Step 13.4: Mount in `src/pages/card/[id].astro`**

Add to the frontmatter imports (alongside the existing ones):

```astro
import PortfolioAddButton from '@/components/PortfolioAddButton';
```

Add the mount just BELOW the closing `</aside>` and above `</article>`:

Before:
```astro
    <aside>
      <p>Set: …</p>
      <p>Rarity: …</p>
      <p>Types: …</p>
    </aside>
  </article>
```

After:
```astro
    <aside>
      <p>Set: …</p>
      <p>Rarity: …</p>
      <p>Types: …</p>
    </aside>
    <PortfolioAddButton client:load cardId={card.id} cardName={card.defaultName} rates={rates} />
  </article>
```

- [ ] **Step 13.5: Run the e2e tests to verify green**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- card-page`
Expected: all card-page tests PASS, including the new one.

- [ ] **Step 13.6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 13.7: Commit**

```bash
git add src/components/PortfolioAddButton.tsx 'src/pages/card/[id].astro' tests/e2e/card-page.spec.ts
git commit -m "feat(portfolio): add '+ Add to my cards' button to card detail pages"
```

---

## Task 14: Home discovery link + final verification

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `tests/e2e/home.spec.ts`

- [ ] **Step 14.1: Append a failing e2e test to `tests/e2e/home.spec.ts`**

```ts
test('home page has a My portfolio link', async ({ page }) => {
  await page.goto('./');
  const link = page.locator('a', { hasText: /My portfolio/i });
  await expect(link).toHaveAttribute('href', /\/pokemon-tcg\/portfolio\/$/);
});
```

- [ ] **Step 14.2: Run to verify red**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- home`
Expected: new test FAILS — link not present.

- [ ] **Step 14.3: Modify `src/pages/index.astro`**

Find the existing `.browse-links` block:

```astro
    <div class="browse-links">
      <a href="/pokemon-tcg/sets/">Browse all sets →</a>
      <a href="/pokemon-tcg/hot/">See hot cards →</a>
    </div>
```

Replace with:

```astro
    <div class="browse-links">
      <a href="/pokemon-tcg/sets/">Browse all sets →</a>
      <a href="/pokemon-tcg/hot/">See hot cards →</a>
      <a href="/pokemon-tcg/portfolio/">My portfolio →</a>
    </div>
```

The existing `.browse-links` CSS rule (flex with wrap) already handles three children.

- [ ] **Step 14.4: Run all home tests**

Run: `pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- home`
Expected: all home tests PASS.

- [ ] **Step 14.5: Full-suite verification**

Run: `pkill -f "astro preview" 2>/dev/null; npm run typecheck && npm run test:unit && npm run test:e2e`
Expected: all green. Expect counts to include:
- 4 new currency tests (convertBetween)
- 8 portfolio-storage tests
- 7 portfolio-aggregate tests
- 5 sparkline-fetch tests
- 6 new portfolio.spec.ts e2e tests
- 1 new card-page.spec.ts e2e test
- 1 new home.spec.ts e2e test

- [ ] **Step 14.6: Commit**

```bash
git add src/pages/index.astro tests/e2e/home.spec.ts
git commit -m "feat(portfolio): add My portfolio link on home"
```

---

## Verification — end-to-end manual smoke test

After all tasks are committed, manual check.

- [ ] **Step V.1: Full build + preview**

Run: `pkill -f "astro preview" 2>/dev/null; npm run build:fixtures-empty-prices && npm run preview`

- [ ] **Step V.2: Manual smoke**

Open in a browser:
- `http://localhost:4321/pokemon-tcg/` — "My portfolio →" link visible.
- `http://localhost:4321/pokemon-tcg/portfolio/` — empty state + add form + Export/Import footer.
- Type "Chari" → autocomplete dropdown shows base1-4.
- Pick it → fill Qty=1, Cost=100 → Add. Summary updates. Table row appears. Trend chart renders.
- Edit qty to 3 (blur). Remove the row. Empty state returns.
- Visit `/card/base1-4` — "+ Add to my cards" button in aside. Click, fill, Save. Reload, still says "Owned". Back to `/portfolio/`, row is there.
- Switch currency GBP ↔ USD via the header select; summary stats update, cost column keeps native currency.
- Export JSON. Clear localStorage (DevTools). Import JSON. Portfolio restored.

Stop preview (Ctrl-C) when done.
