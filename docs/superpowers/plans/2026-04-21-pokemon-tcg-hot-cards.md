# Hot Cards / Movers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browse-by-movement pages (`/hot/24h/`, `/hot/7d/`, `/hot/30d/`) ranking risers, fallers, € gainers, € losers; with a hover popup per row showing a 30-day sparkline and card image.

**Architecture:** Pure Astro SSG reading `data/sparkline-snapshot.json` at build time. A new `src/data/hot-cards.ts` helper shapes four ranked lists per window. One Preact island (`HotHoverPopup`) handles hover interactivity with a shared inline SVG sparkline — no chart.js, no per-row init.

**Tech Stack:** Astro 6 SSG, Preact (one new island), TypeScript strict, Vitest, Playwright. No new npm dependencies.

---

## Spec Reference

Design doc: `docs/superpowers/specs/2026-04-21-pokemon-tcg-hot-cards-design.md` — read before starting.

## Key Codebase Conventions

**You do not need to read these files — they are summarised here. Read them only if a task fails.**

- **Path alias:** `@/*` → `src/*`.
- **History data shape (`src/data/history-schema.ts`):**
  ```ts
  type Snapshot = {
    cardId: string;
    date: string;        // YYYY-MM-DD
    trend: number | null;
    low: number | null;
    avg30: number | null;
    avg7: number | null;
    avg1: number | null;
  };
  type SparklineDump = {
    days: number;
    cutoff: string;      // earliest date covered
    records: Record<string, Snapshot[]>;  // keyed by cardId, sorted oldest → newest
  };
  ```
- **`CardIdentity` shape (`src/data/schema.ts`):** `{ id, defaultName, prints, searchTokens, filters: { setId, setName, rarity, types, series } }`. `prints` is `Partial<Record<Language, PrintData>>`; each `PrintData` carries `imageURL` (TCGdex high-res webp URL).
- **Existing fallback pattern** for missing history (see `src/pages/card/[id].astro:29`):
  ```ts
  const emptySparkline: SparklineDump = { days: 30, cutoff: '1970-01-01', records: {} };
  const spark: SparklineDump = existsSync(sparkPath)
    ? SparklineDumpSchema.parse(JSON.parse(readFileSync(sparkPath, 'utf8')))
    : emptySparkline;
  ```
- **Astro URL convention in `.astro` files:** hardcode `/pokemon-tcg/…` (e.g. `src/components/CardTile.astro:9`, `src/pages/set/[setId].astro`). `.tsx` islands use `import.meta.env.BASE_URL`.
- **Playwright `baseURL`:** `http://localhost:4321/pokemon-tcg/` (trailing slash). Test paths: `page.goto('hot/7d/')`.
- **Fixture data:** `data/fixtures/sample-cards.json` has 2 EN cards (`base1-4` Charizard, `base1-2` Blastoise). This plan adds a sparkline fixture so Hot pages have data during e2e runs.
- **Fixture build pipeline:** `npm run build:fixtures-empty-prices` writes `data/prices-fresh.json` and then runs `build:fixtures`. We modify it to also stage the sparkline fixture.
- **E2E build cache caveat:** Playwright uses `reuseExistingServer: !process.env.CI`. When adding a NEW route, kill any stale preview first: `pkill -f "astro preview" || true`.
- **Hardcoded colour tokens (`src/layouts/Base.astro`):** `--bg #f5efe2`, `--paper #fffdf6`, `--ink #3b2a1a`, `--muted #7a5e3a`, `--accent #c86f3d`. Use `var(--*)` in styles.
- **Image error convention:** `const ON_IMG_ERROR = 'this.onerror=null; this.remove();';` — see `CardTile.astro:7`. Paired with a `.placeholder:only-child { display: grid }` CSS rule.
- **"Today" semantics:** the spec defines per-card "today" as `series[series.length - 1].date` — not the wall clock. Baseline is found by scanning the series for the most-recent snapshot whose date is ≤ `today − N days`.

## File Structure

**Create:**
- `src/data/hot-cards.ts` — pure-function module. Types (`HotWindow`, `HotRow`, `HotLists`), constants (`HOT_WINDOWS`, `WINDOW_DAYS`, `HOT_LIST_SIZE`, `PCT_MIN_BASELINE_EUR`), the `computeHotLists(cards, sparkline, window)` entry point, and the `isoDateMinusDays` / `pickBaseline` internal helpers.
- `src/components/HotSection.astro` — presentational block rendering one of the four sections (heading + up-to-10 rows). No JS.
- `src/components/HotHoverPopup.tsx` — single Preact island. Uses document-level event delegation on `.hot-row`; updates one shared DOM fragment in place on hover/tap.
- `src/pages/hot/[window].astro` — per-window page. `getStaticPaths` over `HOT_WINDOWS`, renders tabs + four `<HotSection>` + the `<HotHoverPopup client:load />` mount.
- `src/pages/hot/index.astro` — 10-line page with `<meta http-equiv="refresh">` to `/hot/7d/` and a `<meta name="robots" content="noindex">`.
- `data/fixtures/sample-sparkline.json` — synthetic 30-day series for the two fixture cards so e2e runs have data.
- `tests/unit/hot-cards.test.ts` — 6 cases for `computeHotLists` covering all four rankings, the window-gap skip, the €1 % floor, and the baseline=0 skip.
- `tests/e2e/hot-pages.spec.ts` — 4 tests: page renders, tabs work, popup appears on hover, home-page link.

**Modify:**
- `package.json` — one-line change to `build:fixtures-empty-prices` to stage the sparkline fixture.
- `src/pages/index.astro` — add "See hot cards →" next to existing "Browse all sets →" link, plus a wrapper class.
- `tests/e2e/home.spec.ts` — one new test asserting the hot-cards home link.

---

## Task 1: `hot-cards.ts` helper + unit tests

**Files:**
- Create: `src/data/hot-cards.ts`
- Create: `tests/unit/hot-cards.test.ts`

Foundational pure module. Every other task consumes it.

- [ ] **Step 1.1: Write the failing unit tests**

Create `tests/unit/hot-cards.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeHotLists,
  HOT_LIST_SIZE,
  PCT_MIN_BASELINE_EUR,
} from '@/data/hot-cards';
import type { CardIdentity } from '@/data/schema';
import type { SparklineDump, Snapshot } from '@/data/history-schema';

// Minimal CardIdentity shape — the helper only reads `id`, `defaultName`,
// `filters.setName`, and `prints` (for the popup image). The computation
// path itself only touches `id`; everything else is passed through.
function makeCard(id: string, defaultName = id): CardIdentity {
  return {
    id,
    defaultName,
    prints: {},
    searchTokens: [],
    filters: { setId: 'test', setName: 'Test', rarity: 'C', types: [], series: 'test' },
  };
}

function snap(cardId: string, date: string, trend: number | null): Snapshot {
  return { cardId, date, trend, low: null, avg30: null, avg7: null, avg1: null };
}

function dump(records: Record<string, Snapshot[]>): SparklineDump {
  return { days: 30, cutoff: '2026-03-22', records };
}

describe('computeHotLists', () => {
  it('ranks pctRisers by deltaPct desc and slices to top 10', () => {
    const cards = Array.from({ length: 12 }, (_, i) => makeCard(`c${i}`, `Card ${i}`));
    // Each card has a baseline of €10 and a different delta. c0..c11 → +10% .. +120%.
    const records: Record<string, Snapshot[]> = {};
    for (let i = 0; i < 12; i++) {
      records[`c${i}`] = [
        snap(`c${i}`, '2026-04-14', 10),
        snap(`c${i}`, '2026-04-21', 10 + i + 1),
      ];
    }
    const out = computeHotLists(cards, dump(records), '7d');
    expect(out.pctRisers).toHaveLength(HOT_LIST_SIZE);
    // Top card is c11 (+120%), second is c10 (+110%).
    expect(out.pctRisers[0].card.id).toBe('c11');
    expect(out.pctRisers[1].card.id).toBe('c10');
    // deltaPct stored as decimal, not percent × 100.
    expect(out.pctRisers[0].deltaPct).toBeCloseTo(1.2);
  });

  it('ranks eurGainers by deltaEur desc regardless of sign', () => {
    const cards = [makeCard('big'), makeCard('small'), makeCard('neg')];
    const records: Record<string, Snapshot[]> = {
      big:   [snap('big',   '2026-04-14', 100), snap('big',   '2026-04-21', 150)], // +€50
      small: [snap('small', '2026-04-14',  10), snap('small', '2026-04-21',  14)], // +€4
      neg:   [snap('neg',   '2026-04-14',  50), snap('neg',   '2026-04-21',  40)], // -€10
    };
    const out = computeHotLists(cards, dump(records), '7d');
    expect(out.eurGainers.map((r) => r.card.id)).toEqual(['big', 'small']);
    expect(out.eurLosers.map((r) => r.card.id)).toEqual(['neg']);
  });

  it('ranks pctFallers by deltaPct asc (most-negative first)', () => {
    const cards = [makeCard('a'), makeCard('b'), makeCard('c')];
    const records: Record<string, Snapshot[]> = {
      a: [snap('a', '2026-04-14', 100), snap('a', '2026-04-21',  80)], // -20%
      b: [snap('b', '2026-04-14', 100), snap('b', '2026-04-21',  50)], // -50%
      c: [snap('c', '2026-04-14', 100), snap('c', '2026-04-21', 110)], // +10%
    };
    const out = computeHotLists(cards, dump(records), '7d');
    expect(out.pctFallers.map((r) => r.card.id)).toEqual(['b', 'a']);
  });

  it('skips cards whose oldest snapshot is newer than the window target', () => {
    // Card with 3 days of history can't appear in 7d or 30d lists.
    const cards = [makeCard('fresh'), makeCard('old')];
    const records: Record<string, Snapshot[]> = {
      fresh: [
        snap('fresh', '2026-04-19', 50),
        snap('fresh', '2026-04-20', 55),
        snap('fresh', '2026-04-21', 60),
      ],
      old: [
        snap('old', '2026-04-14', 50),
        snap('old', '2026-04-21', 60),
      ],
    };
    const out = computeHotLists(cards, dump(records), '7d');
    expect(out.pctRisers.map((r) => r.card.id)).toEqual(['old']);
    expect(out.eurGainers.map((r) => r.card.id)).toEqual(['old']);
  });

  it('excludes baselineEur < PCT_MIN_BASELINE_EUR from % lists, keeps them in € lists', () => {
    expect(PCT_MIN_BASELINE_EUR).toBe(1.0);
    const cards = [makeCard('penny'), makeCard('real')];
    const records: Record<string, Snapshot[]> = {
      // Penny stock: €0.50 → €2 (+300%, but €1.50 absolute — small).
      penny: [snap('penny', '2026-04-14', 0.5), snap('penny', '2026-04-21', 2)],
      // Real card: €100 → €110 (+10%, +€10).
      real:  [snap('real',  '2026-04-14', 100), snap('real',  '2026-04-21', 110)],
    };
    const out = computeHotLists(cards, dump(records), '7d');
    // Penny excluded from pctRisers despite biggest pct, real keeps its spot.
    expect(out.pctRisers.map((r) => r.card.id)).toEqual(['real']);
    // Both appear in eurGainers (no € floor); real out-ranks penny on absolute €.
    expect(out.eurGainers.map((r) => r.card.id)).toEqual(['real', 'penny']);
  });

  it('skips cards whose baseline trend is zero (division-by-zero guard)', () => {
    const cards = [makeCard('zero'), makeCard('ok')];
    const records: Record<string, Snapshot[]> = {
      zero: [snap('zero', '2026-04-14', 0), snap('zero', '2026-04-21', 10)],
      ok:   [snap('ok',   '2026-04-14', 5), snap('ok',   '2026-04-21', 15)],
    };
    const out = computeHotLists(cards, dump(records), '7d');
    expect(out.pctRisers.map((r) => r.card.id)).toEqual(['ok']);
    expect(out.eurGainers.map((r) => r.card.id)).toEqual(['ok']);
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `npm run test:unit -- hot-cards`
Expected: FAIL — `Error: Failed to load url @/data/hot-cards`.

- [ ] **Step 1.3: Implement `src/data/hot-cards.ts`**

Create the file:

```ts
import type { CardIdentity } from './schema';
import type { SparklineDump, Snapshot } from './history-schema';

// ---- Public types ----

export type HotWindow = '24h' | '7d' | '30d';
export const HOT_WINDOWS: HotWindow[] = ['24h', '7d', '30d'];
export const WINDOW_DAYS: Record<HotWindow, number> = { '24h': 1, '7d': 7, '30d': 30 };

// Human label for the chosen window — used in page titles, descriptions,
// and the hover popup.
export const WINDOW_LABEL: Record<HotWindow, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

// How many rows each section shows.
export const HOT_LIST_SIZE = 10;

// The % rankings filter out cards whose baseline trend is below this value.
// Penny-stock movers (a €0.10 card doubling to €0.20) dominate a raw
// percentage ranking without adding useful signal.
export const PCT_MIN_BASELINE_EUR = 1.0;

export interface HotRow {
  card: CardIdentity;
  currentEur: number;
  baselineEur: number;
  deltaEur: number;
  deltaPct: number;       // stored as a decimal (0.54 = +54%)
  history: number[];      // trend values, oldest → newest, for the popup sparkline
}

export interface HotLists {
  pctRisers: HotRow[];
  pctFallers: HotRow[];
  eurGainers: HotRow[];
  eurLosers: HotRow[];
}

// ---- Internal helpers ----

// Subtract N days from an ISO date string (YYYY-MM-DD).
function isoDateMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Given a date-sorted snapshot series and an ISO target date, find the
// most-recent snapshot whose date is ≤ target. Returns null if no such
// snapshot exists (i.e. the card's oldest data point is newer than target).
function pickBaseline(series: Snapshot[], targetIso: string): Snapshot | null {
  // series is sorted oldest → newest, so walk backwards to find the first
  // date ≤ target.
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].date <= targetIso) return series[i];
  }
  return null;
}

// Build a HotRow for a card if it has enough history in the window; return
// null to signal "skip this card for this window".
function buildRow(card: CardIdentity, series: Snapshot[], window: HotWindow): HotRow | null {
  if (series.length === 0) return null;

  const latest = series[series.length - 1];
  const currentEur = latest.trend;
  if (currentEur === null || currentEur === 0) return null;

  const target = isoDateMinusDays(latest.date, WINDOW_DAYS[window]);
  const base = pickBaseline(series, target);
  if (base === null) return null;
  const baselineEur = base.trend;
  if (baselineEur === null || baselineEur === 0) return null;

  const deltaEur = currentEur - baselineEur;
  const deltaPct = deltaEur / baselineEur;

  const history = series
    .map((s) => s.trend)
    .filter((v): v is number => v !== null);

  return { card, currentEur, baselineEur, deltaEur, deltaPct, history };
}

// ---- Core entry point ----

export function computeHotLists(
  cards: CardIdentity[],
  sparkline: SparklineDump,
  window: HotWindow,
): HotLists {
  const rows: HotRow[] = [];
  for (const card of cards) {
    const series = sparkline.records[card.id];
    if (!series) continue;
    const row = buildRow(card, series, window);
    if (row !== null) rows.push(row);
  }

  // Full lists first (€ lists include all rows; % lists apply the floor).
  const forPct = rows.filter((r) => r.baselineEur >= PCT_MIN_BASELINE_EUR);

  const pctRisers = [...forPct]
    .sort((a, b) => b.deltaPct - a.deltaPct)
    .filter((r) => r.deltaEur > 0)
    .slice(0, HOT_LIST_SIZE);
  const pctFallers = [...forPct]
    .sort((a, b) => a.deltaPct - b.deltaPct)
    .filter((r) => r.deltaEur < 0)
    .slice(0, HOT_LIST_SIZE);
  const eurGainers = [...rows]
    .sort((a, b) => b.deltaEur - a.deltaEur)
    .filter((r) => r.deltaEur > 0)
    .slice(0, HOT_LIST_SIZE);
  const eurLosers = [...rows]
    .sort((a, b) => a.deltaEur - b.deltaEur)
    .filter((r) => r.deltaEur < 0)
    .slice(0, HOT_LIST_SIZE);

  return { pctRisers, pctFallers, eurGainers, eurLosers };
}
```

- [ ] **Step 1.4: Run the tests to verify all pass**

Run: `npm run test:unit -- hot-cards`
Expected: PASS — 6 tests green.

- [ ] **Step 1.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 1.6: Commit**

```bash
git add src/data/hot-cards.ts tests/unit/hot-cards.test.ts
git commit -m "feat(hot-cards): add computeHotLists helper + unit tests"
```

---

## Task 2: `HotSection` component

**Files:**
- Create: `src/components/HotSection.astro`

Presentational block — one of the four sections (risers/fallers × %/€). No JS.

- [ ] **Step 2.1: Create `src/components/HotSection.astro`**

```astro
---
import type { HotRow } from '@/data/hot-cards';
import type { Language } from '@/data/schema';

interface Props {
  title: string;
  direction: 'up' | 'down';
  metric: 'pct' | 'eur';
  rows: HotRow[];
}
const { title, direction, metric, rows } = Astro.props;

// Image preference — EN first, then JA, then the European block, then Asian.
// Same order used throughout the codebase (see normalise.ts pickDefaultName).
const LANG_ORDER: Language[] = ['en', 'ja', 'fr', 'de', 'it', 'es', 'pt', 'zh-tw', 'zh-cn', 'th', 'id'];

function pickThumbnailUrl(card: HotRow['card']): string {
  for (const lang of LANG_ORDER) {
    const p = card.prints[lang];
    if (p && p.imageURL) return p.imageURL;
  }
  return '';
}

// Always emit 2 fraction digits for EUR prices to avoid ragged columns.
const eurFmt = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
function formatEur(v: number): string { return eurFmt.format(v); }
function formatEurSigned(v: number): string {
  const sign = v >= 0 ? '+' : '−';
  return `${sign}${eurFmt.format(Math.abs(v))}`;
}
function formatPct(v: number): string {
  const pct = (v * 100).toFixed(0);
  const sign = v >= 0 ? '+' : '−';
  return `${sign}${pct.replace('-', '')}%`;
}

const arrow = direction === 'up' ? '▲' : '▼';
const ON_IMG_ERROR = 'this.onerror=null; this.remove();';
---
<section class="hot-section" data-direction={direction} data-metric={metric}>
  <h2>
    <span class={`arrow ${direction}`}>{arrow}</span>
    <span>{title}</span>
  </h2>
  {rows.length === 0 ? (
    <p class="empty">Not enough history yet — check back tomorrow.</p>
  ) : (
    <ol class="hot-list">
      {rows.map((row, i) => (
        <li>
          <a
            class="hot-row"
            href={`/pokemon-tcg/card/${row.card.id}`}
            data-card-id={row.card.id}
            data-card-name={row.card.defaultName}
            data-set-name={row.card.filters.setName}
            data-current={row.currentEur}
            data-delta-eur={row.deltaEur}
            data-delta-pct={row.deltaPct}
            data-image={pickThumbnailUrl(row.card)}
            data-history={JSON.stringify(row.history)}
          >
            <span class="rk">{i + 1}</span>
            <div class="image-wrap">
              {pickThumbnailUrl(row.card) && (
                <img
                  class="th"
                  src={pickThumbnailUrl(row.card)}
                  alt=""
                  loading="lazy"
                  onerror={ON_IMG_ERROR}
                />
              )}
              <div class="th-placeholder" />
            </div>
            <span class="nm">
              <strong>{row.card.defaultName}</strong>
              <small>{row.card.filters.setName}</small>
            </span>
            <span class="pr">{formatEur(row.currentEur)}</span>
            <span class={`dl ${row.deltaEur >= 0 ? 'up' : 'dn'}`}>
              {metric === 'pct' ? formatPct(row.deltaPct) : formatEurSigned(row.deltaEur)}
            </span>
          </a>
        </li>
      ))}
    </ol>
  )}
</section>

<style>
  .hot-section {
    background: var(--paper);
    border: 1px solid #d9c9a3;
    border-radius: 10px;
    padding: 1rem 1.25rem;
  }
  .hot-section h2 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 0.75rem;
    font-weight: 600;
  }
  .hot-section .arrow.up { color: #2d7d47; }
  .hot-section .arrow.dn { color: #b23a3a; }

  .hot-section .empty { color: var(--muted); font-style: italic; margin: 0.5rem 0; font-size: 0.9rem; }

  .hot-list { list-style: none; padding: 0; margin: 0; }
  .hot-list li { border-bottom: 1px solid #ebdfc2; }
  .hot-list li:last-child { border-bottom: 0; }

  .hot-row {
    display: grid;
    grid-template-columns: 1.5rem 28px 1fr auto 60px;
    gap: 0.6rem;
    align-items: center;
    padding: 0.45rem 0.25rem;
    text-decoration: none;
    color: inherit;
    font-size: 0.9rem;
  }
  .hot-row:hover { background: #fffdf6; }
  .hot-row:focus-visible { background: #fffdf6; outline: 2px solid var(--accent); outline-offset: -2px; }

  .hot-row .rk { color: var(--muted); font-size: 0.8rem; text-align: right; }
  .hot-row .image-wrap { position: relative; width: 28px; height: 39px; }
  .hot-row .th {
    width: 28px;
    height: 39px;
    object-fit: cover;
    border-radius: 3px;
    display: block;
  }
  .hot-row .th-placeholder {
    width: 28px; height: 39px; border-radius: 3px;
    background: linear-gradient(135deg, #fffdf6, #e8ddc6);
    border: 1px dashed #c8b78f;
    display: none;
  }
  .hot-row .th-placeholder:only-child { display: block; }

  .hot-row .nm {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hot-row .nm strong { display: block; }
  .hot-row .nm small { display: block; color: var(--muted); font-size: 0.75rem; }

  .hot-row .pr { font-variant-numeric: tabular-nums; text-align: right; }
  .hot-row .dl {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    text-align: right;
  }
  .hot-row .dl.up { color: #2d7d47; }
  .hot-row .dl.dn { color: #b23a3a; }
</style>
```

- [ ] **Step 2.2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 2.3: Commit**

```bash
git add src/components/HotSection.astro
git commit -m "feat(hot-cards): add HotSection presentational component"
```

---

## Task 3: Fixture sparkline + build script

**Files:**
- Create: `data/fixtures/sample-sparkline.json`
- Modify: `package.json`

E2E tests need sparkline data for the two fixture cards. We ship a static JSON alongside the existing card fixtures, and add a `cp` step to the fixture build script so it lands at the path Astro reads.

- [ ] **Step 3.1: Create `data/fixtures/sample-sparkline.json`**

The file is ~40 lines. Both cards have 30 days of data. Charizard (base1-4) trends up; Blastoise (base1-2) trends down. Dates cover 2026-03-22 through 2026-04-21.

```json
{
  "days": 30,
  "cutoff": "2026-03-22",
  "records": {
    "base1-4": [
      { "cardId": "base1-4", "date": "2026-03-22", "trend": 300, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-03-25", "trend": 305, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-03-28", "trend": 310, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-03-31", "trend": 315, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-04-03", "trend": 318, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-04-06", "trend": 322, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-04-09", "trend": 325, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-04-12", "trend": 330, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-04-14", "trend": 335, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-04-16", "trend": 340, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-04-18", "trend": 345, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-04-20", "trend": 355, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-4", "date": "2026-04-21", "trend": 360, "low": null, "avg30": null, "avg7": null, "avg1": null }
    ],
    "base1-2": [
      { "cardId": "base1-2", "date": "2026-03-22", "trend": 80, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-2", "date": "2026-03-28", "trend": 78, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-2", "date": "2026-04-03", "trend": 75, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-2", "date": "2026-04-09", "trend": 70, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-2", "date": "2026-04-14", "trend": 65, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-2", "date": "2026-04-18", "trend": 62, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-2", "date": "2026-04-20", "trend": 60, "low": null, "avg30": null, "avg7": null, "avg1": null },
      { "cardId": "base1-2", "date": "2026-04-21", "trend": 58, "low": null, "avg30": null, "avg7": null, "avg1": null }
    ]
  }
}
```

This puts base1-4 into `pctRisers`/`eurGainers` and base1-2 into `pctFallers`/`eurLosers` for all three windows.

- [ ] **Step 3.2: Modify `package.json` to stage the fixture during fixture builds**

Change the `build:fixtures-empty-prices` script so it copies the fixture sparkline into place before the Astro build. Current value:

```json
"build:fixtures-empty-prices": "echo '{\"generatedAt\":\"2026-01-01T00:00:00.000Z\",\"records\":{}}' > data/prices-fresh.json && npm run build:fixtures",
```

Replace with:

```json
"build:fixtures-empty-prices": "echo '{\"generatedAt\":\"2026-01-01T00:00:00.000Z\",\"records\":{}}' > data/prices-fresh.json && cp data/fixtures/sample-sparkline.json data/sparkline-snapshot.json && npm run build:fixtures",
```

- [ ] **Step 3.3: Run a fixture build to confirm both files land correctly**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run build:fixtures-empty-prices
```

Expected: exit 0. Check that `data/sparkline-snapshot.json` now contains the fixture data:

```bash
node -e "const d = require('./data/sparkline-snapshot.json'); console.log(Object.keys(d.records).length, 'cards,', d.records['base1-4'].length, 'base1-4 snapshots');"
```

Expected output: `2 cards, 13 base1-4 snapshots`.

- [ ] **Step 3.4: Commit**

```bash
git add data/fixtures/sample-sparkline.json package.json
git commit -m "feat(hot-cards): add fixture sparkline data for e2e tests"
```

---

## Task 4: Per-window page `/hot/[window]/`

**Files:**
- Create: `src/pages/hot/[window].astro`

The central page. Renders window tabs, four HotSections, and mounts the hover popup island (added in Task 7 — for now the mount is a placeholder comment).

- [ ] **Step 4.1: Create `src/pages/hot/[window].astro`**

```astro
---
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Base from '@/layouts/Base.astro';
import HotSection from '@/components/HotSection.astro';
import type { CardIdentity } from '@/data/schema';
import { SparklineDumpSchema, type SparklineDump } from '@/data/history-schema';
import {
  computeHotLists,
  HOT_WINDOWS,
  WINDOW_LABEL,
  type HotWindow,
  type HotLists,
} from '@/data/hot-cards';

export async function getStaticPaths() {
  const cards: CardIdentity[] = JSON.parse(
    readFileSync(resolve(process.cwd(), 'data/cards.json'), 'utf8'),
  );
  const sparkPath = resolve(process.cwd(), 'data/sparkline-snapshot.json');
  const emptySparkline: SparklineDump = { days: 30, cutoff: '1970-01-01', records: {} };
  const spark: SparklineDump = existsSync(sparkPath)
    ? SparklineDumpSchema.parse(JSON.parse(readFileSync(sparkPath, 'utf8')))
    : emptySparkline;

  return HOT_WINDOWS.map((w) => ({
    params: { window: w },
    props: { lists: computeHotLists(cards, spark, w), window: w },
  }));
}

interface Props { lists: HotLists; window: HotWindow }
const { lists, window } = Astro.props;

const label = WINDOW_LABEL[window];
const title = `Hot cards — last ${label} — Pokémon TCG Catalog`;
const description = `Top 10 risers, fallers, gainers and losers over the last ${label} in the Pokémon TCG catalog, updated daily.`;
---
<Base title={title} description={description}>
  <header class="hot-header">
    <h1>Hot cards</h1>
    <p class="sub">Biggest movers over the last {label}. Updated with each deploy.</p>
    <nav class="hot-tabs" aria-label="Time window">
      {HOT_WINDOWS.map((w) => (
        <a
          href={`/pokemon-tcg/hot/${w}/`}
          class={w === window ? 'on' : ''}
          aria-current={w === window ? 'page' : undefined}
        >
          {WINDOW_LABEL[w]}
        </a>
      ))}
    </nav>
  </header>

  <div class="hot-grid">
    <HotSection title="Top % risers"  direction="up"   metric="pct" rows={lists.pctRisers}   />
    <HotSection title="Top € gainers" direction="up"   metric="eur" rows={lists.eurGainers}  />
    <HotSection title="Top % fallers" direction="down" metric="pct" rows={lists.pctFallers}  />
    <HotSection title="Top € losers"  direction="down" metric="eur" rows={lists.eurLosers}   />
  </div>

  <!-- HotHoverPopup island mount goes here in Task 7 -->
</Base>

<style>
  .hot-header { margin-bottom: 2rem; }
  .hot-header h1 { margin: 0 0 0.25rem; }
  .hot-header .sub { color: var(--muted); margin: 0 0 1rem; }

  .hot-tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .hot-tabs a {
    padding: 0.4rem 1rem;
    border-radius: 999px;
    border: 1px solid #d9c9a3;
    background: var(--paper);
    color: var(--muted);
    text-decoration: none;
    font-size: 0.9rem;
  }
  .hot-tabs a:hover { border-color: var(--accent); color: var(--ink); }
  .hot-tabs a.on {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
    font-weight: 600;
  }

  .hot-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 1.25rem;
  }
</style>
```

- [ ] **Step 4.2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4.3: Sanity-check the new routes build**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run build:fixtures-empty-prices
ls dist/hot/
```

Expected output:

```
24h
30d
7d
```

(Each is a directory containing `index.html`.)

- [ ] **Step 4.4: Commit**

```bash
git add src/pages/hot/[window].astro
git commit -m "feat(hot-cards): add /hot/[window]/ page with four ranked sections"
```

---

## Task 5: `/hot/` root redirect

**Files:**
- Create: `src/pages/hot/index.astro`

Bare page with a meta-refresh to `/hot/7d/`. GitHub Pages doesn't do server-side redirects, so meta-refresh is the static-host idiom.

- [ ] **Step 5.1: Create `src/pages/hot/index.astro`**

```astro
---
// Static-host redirect to /hot/7d/ — meta-refresh works on GitHub Pages
// where server-side redirects aren't possible. robots=noindex keeps search
// engines from treating this shell as a duplicate.
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0; url=/pokemon-tcg/hot/7d/" />
    <meta name="robots" content="noindex" />
    <title>Hot cards — Pokémon TCG Catalog</title>
    <link rel="canonical" href="https://davstaylor.github.io/pokemon-tcg/hot/7d/" />
  </head>
  <body>
    <p>Redirecting to <a href="/pokemon-tcg/hot/7d/">hot cards (last 7 days)</a>…</p>
  </body>
</html>
```

- [ ] **Step 5.2: Verify the build emits it**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run build:fixtures-empty-prices
grep -c 'http-equiv="refresh"' dist/hot/index.html
```

Expected: `1`.

- [ ] **Step 5.3: Commit**

```bash
git add src/pages/hot/index.astro
git commit -m "feat(hot-cards): add /hot/ meta-refresh redirect to /hot/7d/"
```

---

## Task 6: E2E — page structure + redirect

**Files:**
- Create: `tests/e2e/hot-pages.spec.ts`

Two tests up front: the `/hot/7d/` page renders its structure; the `/hot/` root redirects to `/hot/7d/`. The hover-popup test lands in Task 8 after the island is built.

- [ ] **Step 6.1: Write the failing e2e tests**

Create `tests/e2e/hot-pages.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('/hot/7d/ renders header, tabs, and four sections', async ({ page }) => {
  await page.goto('hot/7d/');
  await expect(page.locator('h1')).toHaveText('Hot cards');

  // Tabs: 3 anchors; the 7d one is aria-current="page".
  const tabs = page.locator('.hot-tabs a');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.filter({ hasText: '7 days' })).toHaveAttribute('aria-current', 'page');

  // Four sections, correct headings.
  const sectionHeadings = page.locator('.hot-section h2');
  await expect(sectionHeadings).toHaveCount(4);
  await expect(sectionHeadings).toContainText([
    'Top % risers',
    'Top € gainers',
    'Top % fallers',
    'Top € losers',
  ]);

  // Fixture data puts base1-4 in the risers sections and base1-2 in the fallers.
  await expect(page.locator('.hot-section[data-direction="up"] .hot-row')).toHaveCount(2);
  await expect(page.locator('.hot-section[data-direction="down"] .hot-row')).toHaveCount(2);
  await expect(page.locator('.hot-section[data-direction="up"]').first()).toContainText('Charizard');
  await expect(page.locator('.hot-section[data-direction="down"]').first()).toContainText('Blastoise');
});

test('/hot/ root redirects via meta-refresh to /hot/7d/', async ({ page }) => {
  const resp = await page.goto('hot/');
  // The static HTML includes the meta-refresh; the browser auto-follows it.
  // Either assert the refresh tag is present, or assert the final URL.
  await page.waitForURL(/\/hot\/7d\/$/);
  expect(page.url()).toMatch(/\/pokemon-tcg\/hot\/7d\/$/);
  expect(resp?.ok()).toBe(true);
});

test('other windows are reachable: /hot/24h/ and /hot/30d/', async ({ page }) => {
  const r1 = await page.goto('hot/24h/');
  expect(r1?.ok()).toBe(true);
  await expect(page.locator('.hot-tabs a.on')).toHaveText('24 hours');

  const r2 = await page.goto('hot/30d/');
  expect(r2?.ok()).toBe(true);
  await expect(page.locator('.hot-tabs a.on')).toHaveText('30 days');
});
```

- [ ] **Step 6.2: Run the tests**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- hot-pages
```

Expected: 3 PASS — the page + redirect + other-windows tests pass because Tasks 4-5 already ship the pages.

- [ ] **Step 6.3: Commit**

```bash
git add tests/e2e/hot-pages.spec.ts
git commit -m "test(hot-cards): e2e for page structure, tabs, and redirect"
```

---

## Task 7: `HotHoverPopup` Preact island

**Files:**
- Create: `src/components/HotHoverPopup.tsx`
- Modify: `src/pages/hot/[window].astro`

Single island mounted once. Listens at the document level for `mouseover` / `mouseout` / `focusin` / `focusout` on `.hot-row`. Maintains one shared DOM fragment for the popup. Inline SVG sparkline built from `data-history`.

- [ ] **Step 7.1: Create `src/components/HotHoverPopup.tsx`**

```tsx
import { useEffect, useRef } from 'preact/hooks';

// Dimensions kept in sync with the CSS below. POPUP_WIDTH is used to decide
// which side of the row to pin the popup to.
const POPUP_WIDTH = 290;
const POPUP_GAP = 12;
const VIEWPORT_MARGIN = 12;

type HoverData = {
  name: string;
  set: string;
  current: number;
  deltaEur: number;
  deltaPct: number;
  image: string;
  history: number[];
};

function parseRow(row: HTMLElement): HoverData | null {
  const raw = row.dataset.history;
  if (!raw) return null;
  let history: number[];
  try {
    history = JSON.parse(raw);
  } catch {
    return null;
  }
  return {
    name: row.dataset.cardName ?? '',
    set: row.dataset.setName ?? '',
    current: Number(row.dataset.current ?? 0),
    deltaEur: Number(row.dataset.deltaEur ?? 0),
    deltaPct: Number(row.dataset.deltaPct ?? 0),
    image: row.dataset.image ?? '',
    history,
  };
}

function buildSparklinePoints(history: number[]): string {
  if (history.length < 2) return '';
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  return history
    .map((v, i) => {
      const x = (i / (history.length - 1)) * 100;
      const y = 48 - ((v - min) / range) * 48;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const eurFmt = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
function fmtEur(v: number): string { return eurFmt.format(v); }
function fmtEurSigned(v: number): string {
  const sign = v >= 0 ? '+' : '−';
  return `${sign}${eurFmt.format(Math.abs(v))}`;
}
function fmtPct(v: number): string {
  const pct = (v * 100).toFixed(0);
  const sign = v >= 0 ? '+' : '−';
  return `${sign}${pct.replace('-', '')}%`;
}

export default function HotHoverPopup() {
  const popupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;

    // Shared element references inside the popup — cached on first render
    // so hover handlers don't re-query.
    const img = popup.querySelector('img') as HTMLImageElement;
    const placeholder = popup.querySelector('.pop-img-placeholder') as HTMLDivElement;
    const nameEl = popup.querySelector('.pop-name') as HTMLElement;
    const setEl = popup.querySelector('.pop-set') as HTMLElement;
    const priceEl = popup.querySelector('.pop-price') as HTMLElement;
    const deltaEl = popup.querySelector('.pop-delta') as HTMLElement;
    const rangeEl = popup.querySelector('.pop-range') as HTMLElement;
    const polyline = popup.querySelector('polyline') as SVGPolylineElement;

    let currentRow: HTMLElement | null = null;

    function show(row: HTMLElement) {
      const data = parseRow(row);
      if (!data) return;

      // Image handling — clear-on-error reveals the placeholder.
      if (data.image) {
        img.src = data.image;
        img.style.display = '';
        placeholder.style.display = 'none';
        img.onerror = () => {
          img.style.display = 'none';
          placeholder.style.display = '';
        };
      } else {
        img.removeAttribute('src');
        img.style.display = 'none';
        placeholder.style.display = '';
      }

      nameEl.textContent = data.name;
      setEl.textContent = data.set;
      priceEl.textContent = fmtEur(data.current);
      const deltaStr = `${fmtEurSigned(data.deltaEur)} (${fmtPct(data.deltaPct)})`;
      deltaEl.textContent = deltaStr;
      deltaEl.classList.toggle('up', data.deltaEur >= 0);
      deltaEl.classList.toggle('dn', data.deltaEur < 0);
      polyline.setAttribute('points', buildSparklinePoints(data.history));
      polyline.setAttribute('stroke', data.deltaEur >= 0 ? '#2d7d47' : '#b23a3a');

      const min = Math.min(...data.history);
      const max = Math.max(...data.history);
      rangeEl.textContent = `Min ${fmtEur(min)}  ·  30 days  ·  Max ${fmtEur(max)}`;

      // Position: prefer right of the row; flip to left if not enough room.
      const rowRect = row.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const spaceRight = viewportW - rowRect.right - VIEWPORT_MARGIN;
      const flipLeft = spaceRight < POPUP_WIDTH + POPUP_GAP;
      const left = flipLeft
        ? rowRect.left - POPUP_WIDTH - POPUP_GAP
        : rowRect.right + POPUP_GAP;
      const top = rowRect.top + window.scrollY;
      popup.style.left = `${Math.max(VIEWPORT_MARGIN, left)}px`;
      popup.style.top = `${top}px`;
      popup.classList.toggle('tail-right', flipLeft);
      popup.classList.toggle('tail-left', !flipLeft);
      popup.classList.add('visible');
      popup.setAttribute('aria-hidden', 'false');

      currentRow = row;
    }

    function hide() {
      popup.classList.remove('visible');
      popup.setAttribute('aria-hidden', 'true');
      currentRow = null;
    }

    function onMouseOver(e: MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest('.hot-row') as HTMLElement | null;
      if (!target) return;
      if (target !== currentRow) show(target);
    }
    function onMouseOut(e: MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest('.hot-row') as HTMLElement | null;
      if (!target) return;
      // Only hide when moving OUT of the row AND not into another .hot-row.
      const related = (e.relatedTarget as HTMLElement | null)?.closest('.hot-row');
      if (!related) hide();
    }
    function onFocusIn(e: FocusEvent) {
      const target = (e.target as HTMLElement | null)?.closest('.hot-row') as HTMLElement | null;
      if (!target) return;
      show(target);
    }
    function onFocusOut() { hide(); }

    // Tap-to-toggle on touch devices: a tap that's also a click navigates,
    // so we only preview the popup on touchstart before the click fires.
    function onTouchStart(e: TouchEvent) {
      const target = (e.target as HTMLElement | null)?.closest('.hot-row') as HTMLElement | null;
      if (!target) return;
      show(target);
    }

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('touchstart', onTouchStart, { passive: true });

    return () => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('touchstart', onTouchStart);
    };
  }, []);

  return (
    <div class="hot-popup" ref={popupRef} role="tooltip" aria-hidden="true">
      <div class="pop-left">
        <img alt="" loading="lazy" />
        <div class="pop-img-placeholder" />
      </div>
      <div class="pop-right">
        <p class="pop-name" />
        <p class="pop-set" />
        <div class="pop-prices">
          <span class="pop-price" />
          <span class="pop-delta" />
        </div>
        <div class="pop-spark">
          <svg viewBox="0 0 100 48" preserveAspectRatio="none">
            <polyline points="" fill="none" stroke="#2d7d47" stroke-width="1.5" />
          </svg>
        </div>
        <p class="pop-range" />
        <p class="pop-foot">Click row to open card →</p>
      </div>
      <style>{`
        .hot-popup {
          position: absolute;
          display: flex;
          gap: 12px;
          width: ${POPUP_WIDTH}px;
          padding: 12px;
          background: #fffdf6;
          border: 1px solid #d9c9a3;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(59, 42, 26, 0.18);
          pointer-events: none;
          opacity: 0;
          transition: opacity 80ms ease;
          z-index: 1000;
        }
        .hot-popup.visible { opacity: 1; }
        .hot-popup .pop-left { width: 96px; flex-shrink: 0; position: relative; }
        .hot-popup img {
          width: 96px; aspect-ratio: 2/3;
          object-fit: cover; border-radius: 6px; display: block;
        }
        .hot-popup .pop-img-placeholder {
          width: 96px; aspect-ratio: 2/3; border-radius: 6px;
          background: linear-gradient(135deg, #fffdf6, #e8ddc6);
          border: 1px dashed #c8b78f;
          display: none;
        }
        .hot-popup .pop-right { flex: 1; min-width: 0; display: flex; flex-direction: column; }
        .hot-popup .pop-name { font-weight: 600; font-size: 0.95rem; margin: 0 0 2px; }
        .hot-popup .pop-set { color: #7a5e3a; font-size: 0.75rem; margin: 0 0 8px; }
        .hot-popup .pop-prices { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
        .hot-popup .pop-price { font-size: 1.2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
        .hot-popup .pop-delta { font-size: 0.85rem; font-weight: 600; font-variant-numeric: tabular-nums; }
        .hot-popup .pop-delta.up { color: #2d7d47; }
        .hot-popup .pop-delta.dn { color: #b23a3a; }
        .hot-popup .pop-spark {
          height: 48px;
          background: linear-gradient(180deg, #fffdf6, #f5efe2);
          border-radius: 4px;
          overflow: hidden;
          border: 1px solid #ebdfc2;
        }
        .hot-popup .pop-spark svg { display: block; width: 100%; height: 100%; }
        .hot-popup .pop-range {
          display: flex; justify-content: space-between;
          font-size: 0.7rem; color: #7a5e3a; margin: 4px 0 0;
        }
        .hot-popup .pop-foot {
          text-align: center; font-size: 0.7rem; color: #c86f3d;
          margin: 6px 0 0; padding-top: 6px; border-top: 1px solid #ebdfc2;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 7.2: Mount the island in the page**

Edit `src/pages/hot/[window].astro`. Replace the placeholder comment:

```astro
  <!-- HotHoverPopup island mount goes here in Task 7 -->
```

with:

```astro
  <HotHoverPopup client:load />
```

And add the import to the frontmatter imports block (alongside `HotSection`):

```astro
import HotHoverPopup from '@/components/HotHoverPopup';
```

- [ ] **Step 7.3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7.4: Rebuild and sanity check**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run build:fixtures-empty-prices
grep -c 'hot-popup' dist/hot/7d/index.html
```

Expected: `≥ 1` (the island's DOM is server-rendered).

- [ ] **Step 7.5: Commit**

```bash
git add src/components/HotHoverPopup.tsx src/pages/hot/[window].astro
git commit -m "feat(hot-cards): add HotHoverPopup island with shared SVG sparkline"
```

---

## Task 8: E2E — popup behaviour

**Files:**
- Modify: `tests/e2e/hot-pages.spec.ts`

Hover over the first `.hot-row`, assert the popup becomes visible and shows the right card.

- [ ] **Step 8.1: Append the popup test**

Append to `tests/e2e/hot-pages.spec.ts`:

```ts
test('hovering a hot-row shows the popup with card name + sparkline', async ({ page }) => {
  await page.goto('hot/7d/');
  const firstRow = page.locator('.hot-section[data-direction="up"] .hot-row').first();
  await firstRow.hover();

  const popup = page.locator('.hot-popup');
  await expect(popup).toHaveClass(/visible/);
  await expect(popup.locator('.pop-name')).toHaveText(/Charizard/);
  // The sparkline polyline should have a non-empty points attribute.
  const points = await popup.locator('polyline').getAttribute('points');
  expect(points).toBeTruthy();
  expect(points!.split(' ').length).toBeGreaterThanOrEqual(2);

  // Move elsewhere — popup hides.
  await page.locator('h1').hover();
  await expect(popup).not.toHaveClass(/visible/);
});
```

- [ ] **Step 8.2: Run the test**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- hot-pages
```

Expected: 4 PASS (3 existing + 1 new).

- [ ] **Step 8.3: Commit**

```bash
git add tests/e2e/hot-pages.spec.ts
git commit -m "test(hot-cards): e2e for hover popup visibility and content"
```

---

## Task 9: Home page discovery link

**Files:**
- Modify: `src/pages/index.astro`
- Modify: `tests/e2e/home.spec.ts`

Add "See hot cards →" next to the existing "Browse all sets →" link.

- [ ] **Step 9.1: Append the failing e2e test to `tests/e2e/home.spec.ts`**

Append to `tests/e2e/home.spec.ts`:

```ts
test('home page has a See hot cards link', async ({ page }) => {
  await page.goto('./');
  const link = page.locator('a', { hasText: /See hot cards/i });
  await expect(link).toHaveAttribute('href', /\/pokemon-tcg\/hot\/$/);
});
```

- [ ] **Step 9.2: Run the test to confirm it fails**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- home
```

Expected: new test FAILS (existing 3 pass).

- [ ] **Step 9.3: Modify `src/pages/index.astro`**

Find the existing `.browse-all` block:

```astro
    <div class="browse-all">
      <a href="/pokemon-tcg/sets/">Browse all sets →</a>
    </div>
```

Replace with a container that holds both links:

```astro
    <div class="browse-links">
      <a href="/pokemon-tcg/sets/">Browse all sets →</a>
      <a href="/pokemon-tcg/hot/">See hot cards →</a>
    </div>
```

And replace the `.browse-all` CSS rule (near the bottom of `<style>`):

```css
  .browse-all { margin-top: 2rem; text-align: center; }
```

with:

```css
  .browse-links { margin-top: 2rem; display: flex; justify-content: center; gap: 1.5rem; flex-wrap: wrap; }
```

- [ ] **Step 9.4: Run all home tests**

Run:

```bash
pkill -f "astro preview" 2>/dev/null; npm run test:e2e -- home
```

Expected: 4 PASS.

- [ ] **Step 9.5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 9.6: Commit**

```bash
git add src/pages/index.astro tests/e2e/home.spec.ts
git commit -m "feat(hot-cards): add See hot cards link on home"
```

---

## Verification — full suite + smoke check

After all tasks are committed, run the final sweep.

- [ ] **Step V.1: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step V.2: Full unit + e2e**

Run: `npm run test:unit && npm run test:e2e`
Expected: every test PASS. Counts include 6 new `hot-cards` unit tests, 4 new `hot-pages` e2e tests, and 1 new `home` e2e test.

- [ ] **Step V.3: Manual preview**

Run: `pkill -f "astro preview" 2>/dev/null; npm run build:fixtures-empty-prices && npm run preview`

Open in a browser:
- `http://localhost:4321/pokemon-tcg/` — "See hot cards →" link visible next to "Browse all sets →".
- `http://localhost:4321/pokemon-tcg/hot/` — redirects to `/hot/7d/` immediately.
- `http://localhost:4321/pokemon-tcg/hot/7d/` — four sections render; `7 days` tab is highlighted.
- Hover a row in any section — popup appears to the right (or left near the page edge) showing card name, current price, delta, 30-day sparkline, min/max range.
- Click a row — navigates to the card page.
- Click the other tabs — each window loads, correct tab highlighted.

Stop preview with Ctrl-C when done.
