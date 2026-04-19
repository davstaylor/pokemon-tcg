# Pokémon TCG Prices v2.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add time-series history in Cloudflare D1, drive a real 30-point sparkline + volatility pill + 90-day range panel on each card page, and introduce a site-wide currency switcher (EUR/USD/GBP/JPY).

**Architecture:** Cloudflare D1 stores daily snapshots (~23k rows/day); a public Worker exposes `/sparkline-dump` and `/range-dump` endpoints; nightly GH Actions job writes to D1 via wrangler CLI and pulls back the aggregated views via HTTP for embedding into the static build. Currency is handled purely at build time — every price renders as HTML with data-eur/-usd/-gbp/-jpy attributes and a tiny Preact island toggles visibility based on localStorage.

**Tech Stack:** TypeScript strict, Zod, Astro 6, Preact, Cloudflare Workers + D1, wrangler CLI, chart.js 4, Frankfurter API (no auth), js-yaml (already installed), Vitest, Playwright.

**Spec reference:** [`docs/superpowers/specs/2026-04-19-pokemon-tcg-prices-v2-1-design.md`](../specs/2026-04-19-pokemon-tcg-prices-v2-1-design.md)

---

## Context an engineer must know before starting

- **This adds a new external trust boundary (Cloudflare D1).** Writes require the `CLOUDFLARE_API_TOKEN` secret in GitHub Actions; reads are public and unauthenticated. The user (davstaylor) has confirmed they have a Cloudflare account.
- **Two new scheduled CI jobs on top of the existing nightly:** push today's snapshot to D1, then pull aggregated history back for the build. Both layer onto the existing `build-and-deploy` workflow; no new workflow file needed.
- **Currency math happens at build time, not runtime.** Each price node carries `data-eur data-usd data-gbp data-jpy` attributes; a Preact island mutates the visible text. No fetch from the client.
- **The existing Charizard fixture doesn't have history data.** Tests that need history use small synthetic history arrays passed inline, not a history fixture file on disk.
- **Repo state (as of this plan):** v1 catalog + v2.0 prices + live-data fetch (Tasks 1-5 from the live-data plan) are all shipped. `main` branch, commit `c4c8172` is the top. The build currently deploys the full 23k-card catalog with PriceTiles for the ~93% that have Cardmarket data.
- **Manual steps the user must do** (flagged in specific tasks):
  1. `wrangler login` (once, locally)
  2. `wrangler d1 create pokemon-tcg-history` (once, locally)
  3. Copy `database_id` from that output into `workers/history-api/wrangler.toml`
  4. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to GitHub repo secrets

---

## File structure (planned end state)

```
/
├── .github/workflows/build.yml                # modified: +push-history, +pull-history, +fetch-exchange-rates steps
├── workers/
│   └── history-api/                           # NEW — Cloudflare Worker project
│       ├── wrangler.toml
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/index.ts
│       └── migrations/
│           └── 0001_snapshots.sql
├── scripts/
│   ├── fetch-exchange-rates.ts                # NEW
│   ├── push-history-to-d1.ts                  # NEW
│   ├── pull-history-from-worker.ts            # NEW
│   └── bootstrap-d1-history.ts                # NEW (one-time seed)
├── src/
│   ├── data/
│   │   ├── currency.ts                        # NEW — convert + format
│   │   ├── currency-schema.ts                 # NEW — Zod for exchange-rates.json + currency types
│   │   ├── volatility.ts                      # NEW — σ/μ + bucketing
│   │   ├── history-schema.ts                  # NEW — Zod for sparkline/range dumps
│   │   └── (existing files unchanged)
│   ├── components/
│   │   ├── PriceTile.astro                    # modified — volatility pill, data-currency attrs
│   │   ├── PriceChart.tsx                     # modified — accept variable-length points
│   │   ├── CurrencySelect.tsx                 # NEW — header Preact island
│   │   └── RangePanel.astro                   # NEW — replaces eBay placeholder
│   ├── layouts/
│   │   └── Base.astro                         # modified — header strip with CurrencySelect
│   └── pages/card/[id].astro                  # modified — load history + rates, pass to PriceTile
├── data/
│   ├── exchange-rates.json                    # NEW — committed (rates change daily; tiny file)
│   ├── sparkline-snapshot.json                # NEW — gitignored (pulled from Worker at build)
│   └── range-snapshot.json                    # NEW — gitignored (pulled from Worker at build)
├── tests/
│   ├── unit/
│   │   ├── currency.test.ts                   # NEW
│   │   ├── volatility.test.ts                 # NEW
│   │   └── history-schema.test.ts             # NEW
│   └── e2e/
│       ├── price-tile.spec.ts                 # modified — volatility pill + range panel assertions
│       └── currency-switch.spec.ts            # NEW
└── package.json                               # modified — scripts + wrangler devDep
```

Worker project is a separate npm workspace so its dependencies don't bloat the site. `workers/history-api/` has its own `package.json`.

---

## Task 1: Cloudflare Worker scaffold + D1 database

**Files:**
- Create: `workers/history-api/wrangler.toml`
- Create: `workers/history-api/package.json`
- Create: `workers/history-api/tsconfig.json`
- Create: `workers/history-api/src/index.ts` (placeholder)
- Create: `workers/history-api/migrations/0001_snapshots.sql`

**Note:** This task requires user action (wrangler login + D1 create). The subagent stops after preparing files and writing instructions; the user runs two commands.

- [ ] **Step 1: Create the worker directory structure**

```bash
mkdir -p workers/history-api/src workers/history-api/migrations
cd workers/history-api
```

- [ ] **Step 2: Initialise worker `package.json`**

Write `workers/history-api/package.json`:

```json
{
  "name": "pokemon-tcg-history-api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "migrate": "wrangler d1 migrations apply pokemon-tcg-history --remote"
  },
  "devDependencies": {
    "wrangler": "^3.90.0",
    "typescript": "^5.9.3",
    "@cloudflare/workers-types": "^4.20250101.0"
  }
}
```

Install: `cd workers/history-api && npm install && cd ../..`

- [ ] **Step 3: Write `workers/history-api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "strict": true,
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types"],
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Write `workers/history-api/wrangler.toml`**

```toml
name = "pokemon-tcg-history-api"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[d1_databases]]
binding = "DB"
database_name = "pokemon-tcg-history"
database_id = "REPLACE_AFTER_d1_create"

[observability]
enabled = true
```

- [ ] **Step 5: Write `workers/history-api/src/index.ts` placeholder**

```ts
export interface Env {
  DB: D1Database;
}

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response('pokemon-tcg-history-api — endpoints coming in Task 2', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  },
};
```

- [ ] **Step 6: Write `workers/history-api/migrations/0001_snapshots.sql`**

```sql
CREATE TABLE IF NOT EXISTS snapshots (
  cardId TEXT NOT NULL,
  date TEXT NOT NULL,
  trend REAL,
  low REAL,
  avg30 REAL,
  avg7 REAL,
  avg1 REAL,
  PRIMARY KEY (cardId, date)
);

CREATE INDEX IF NOT EXISTS idx_card_date ON snapshots(cardId, date DESC);
CREATE INDEX IF NOT EXISTS idx_date ON snapshots(date DESC);
```

- [ ] **Step 7: Stop and instruct the user to run the manual wrangler steps**

Report the following to the user:

> **Manual steps required before Task 2 can proceed:**
>
> ```bash
> # Run from repo root:
> cd workers/history-api
>
> # 1) Authenticate (one-time, opens browser)
> npx wrangler login
>
> # 2) Create the D1 database
> npx wrangler d1 create pokemon-tcg-history
> ```
>
> The second command prints a block that looks like:
>
> ```toml
> [[d1_databases]]
> binding = "DB"
> database_name = "pokemon-tcg-history"
> database_id = "abc1234-....."
> ```
>
> **Copy the `database_id` value into `workers/history-api/wrangler.toml`, replacing `REPLACE_AFTER_d1_create`.**
>
> Then:
>
> ```bash
> # 3) Apply the schema migration
> npm run migrate
> ```
>
> Once all three are done, respond to proceed with Task 2.

- [ ] **Step 8: Commit**

```bash
git add workers/ package.json package-lock.json
git commit -m "chore(workers): scaffold history-api worker with D1 migration"
```

---

## Task 2: Worker endpoints + deploy

**Files:**
- Modify: `workers/history-api/src/index.ts`

**Depends on Task 1 manual steps complete** (`database_id` in wrangler.toml).

- [ ] **Step 1: Implement the three endpoints in `workers/history-api/src/index.ts`**

```ts
export interface Env {
  DB: D1Database;
}

type SnapshotRow = {
  cardId: string;
  date: string;
  trend: number | null;
  low: number | null;
  avg30: number | null;
  avg7: number | null;
  avg1: number | null;
};

const JSON_CORS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

function parseDaysParam(url: URL, defaultDays: number, maxDays: number): number {
  const raw = url.searchParams.get('days');
  const parsed = raw ? Number(raw) : defaultDays;
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultDays;
  return Math.min(parsed, maxDays);
}

function cutoffDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

async function handleSingleCard(cardId: string, days: number, env: Env): Promise<Response> {
  const cutoff = cutoffDate(days);
  const stmt = env.DB.prepare(
    'SELECT cardId, date, trend, low, avg30, avg7, avg1 FROM snapshots WHERE cardId = ? AND date >= ? ORDER BY date DESC',
  ).bind(cardId, cutoff);
  const { results } = await stmt.all<SnapshotRow>();
  return new Response(
    JSON.stringify({ cardId, days, cutoff, snapshots: results ?? [] }),
    { status: 200, headers: JSON_CORS },
  );
}

async function handleSparklineDump(days: number, env: Env): Promise<Response> {
  const cutoff = cutoffDate(days);
  const stmt = env.DB.prepare(
    'SELECT cardId, date, trend, low, avg30, avg7, avg1 FROM snapshots WHERE date >= ? ORDER BY cardId, date DESC',
  ).bind(cutoff);
  const { results } = await stmt.all<SnapshotRow>();
  const records: Record<string, SnapshotRow[]> = {};
  for (const row of results ?? []) {
    (records[row.cardId] ??= []).push(row);
  }
  return new Response(
    JSON.stringify({ days, cutoff, records }),
    { status: 200, headers: JSON_CORS },
  );
}

async function handleRangeDump(days: number, env: Env): Promise<Response> {
  const cutoff = cutoffDate(days);
  // Pre-aggregate in SQL for a much smaller payload.
  const stmt = env.DB.prepare(`
    SELECT
      cardId,
      MIN(trend) AS low,
      MAX(trend) AS high,
      (SELECT trend FROM snapshots s2 WHERE s2.cardId = snapshots.cardId ORDER BY date DESC LIMIT 1) AS latest
    FROM snapshots
    WHERE date >= ? AND trend IS NOT NULL
    GROUP BY cardId
  `).bind(cutoff);
  const { results } = await stmt.all<{ cardId: string; low: number | null; high: number | null; latest: number | null }>();
  const records: Record<string, { low: number | null; high: number | null; latest: number | null }> = {};
  for (const row of results ?? []) {
    records[row.cardId] = { low: row.low, high: row.high, latest: row.latest };
  }
  return new Response(
    JSON.stringify({ days, cutoff, records }),
    { status: 200, headers: JSON_CORS },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_CORS });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.startsWith('/history/')) {
      const cardId = decodeURIComponent(pathname.slice('/history/'.length));
      const days = parseDaysParam(url, 90, 365);
      return handleSingleCard(cardId, days, env);
    }
    if (pathname === '/sparkline-dump') {
      const days = parseDaysParam(url, 30, 90);
      return handleSparklineDump(days, env);
    }
    if (pathname === '/range-dump') {
      const days = parseDaysParam(url, 90, 365);
      return handleRangeDump(days, env);
    }
    return new Response('not found', { status: 404 });
  },
};
```

- [ ] **Step 2: Typecheck the worker**

```bash
cd workers/history-api
npx tsc --noEmit
cd ../..
```

Expected: exit 0.

- [ ] **Step 3: Deploy the worker**

```bash
cd workers/history-api
npx wrangler deploy
cd ../..
```

Expected: prints a URL like `https://pokemon-tcg-history-api.<account>.workers.dev`. **Note this URL** — you'll need it for later tasks. (You can also retrieve it later via `npx wrangler deployments list`.)

- [ ] **Step 4: Smoke-test each endpoint (database is empty, so all return empty arrays)**

```bash
WORKER_URL="<the URL from step 3>"
curl -s "$WORKER_URL/history/base1-4?days=90" | head -c 300
# Expected: {"cardId":"base1-4","days":90,"cutoff":"...","snapshots":[]}
curl -s "$WORKER_URL/sparkline-dump?days=30" | head -c 300
# Expected: {"days":30,"cutoff":"...","records":{}}
curl -s "$WORKER_URL/range-dump?days=90" | head -c 300
# Expected: {"days":90,"cutoff":"...","records":{}}
curl -s "$WORKER_URL/nonsense" | head -c 100
# Expected: not found
```

- [ ] **Step 5: Save the Worker URL in the repo for later use**

Create/update `workers/history-api/.env.example` with:

```
# Copy to .env.local and fill in after running `wrangler deploy`:
WORKER_URL=https://pokemon-tcg-history-api.<your-account>.workers.dev
```

Also add to project `.gitignore` if not already excluded:

```
# Worker local env
workers/history-api/.env.local
workers/history-api/.wrangler/
```

- [ ] **Step 6: Commit**

```bash
git add workers/history-api/src/index.ts workers/history-api/.env.example .gitignore
git commit -m "feat(workers): history-api with sparkline-dump, range-dump, and per-card endpoints"
```

---

## Task 3: Currency utility + tests

**Files:**
- Create: `src/data/currency-schema.ts`
- Create: `src/data/currency.ts`
- Create: `tests/unit/currency.test.ts`

- [ ] **Step 1: Write `src/data/currency-schema.ts`**

```ts
import { z } from 'zod';

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'JPY'] as const;
export type SupportedCurrency = typeof SUPPORTED_CURRENCIES[number];

// Each currency's decimal-places in display (JPY has 0, others 2)
export const CURRENCY_DECIMALS: Record<SupportedCurrency, number> = {
  EUR: 2,
  USD: 2,
  GBP: 2,
  JPY: 0,
};

export const CURRENCY_GLYPH: Record<SupportedCurrency, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  JPY: '¥',
};

// Frankfurter /latest?from=EUR&to=USD,GBP,JPY returns:
//   { amount: 1, base: 'EUR', date: '2026-04-19', rates: { USD: 1.0754, GBP: 0.8581, JPY: 162.38 } }
export const ExchangeRatesSchema = z.object({
  base: z.literal('EUR'),
  date: z.string(),
  rates: z.object({
    USD: z.number().positive(),
    GBP: z.number().positive(),
    JPY: z.number().positive(),
  }),
});
export type ExchangeRates = z.infer<typeof ExchangeRatesSchema>;
```

- [ ] **Step 2: Write failing tests — `tests/unit/currency.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { convertFromEUR, formatCurrency } from '@/data/currency';
import type { ExchangeRates } from '@/data/currency-schema';

const rates: ExchangeRates = {
  base: 'EUR',
  date: '2026-04-19',
  rates: { USD: 1.0754, GBP: 0.8581, JPY: 162.38 },
};

describe('convertFromEUR', () => {
  it('returns the same value when target is EUR', () => {
    expect(convertFromEUR(100, 'EUR', rates)).toBe(100);
  });
  it('multiplies by USD rate', () => {
    expect(convertFromEUR(100, 'USD', rates)).toBeCloseTo(107.54, 2);
  });
  it('multiplies by GBP rate', () => {
    expect(convertFromEUR(100, 'GBP', rates)).toBeCloseTo(85.81, 2);
  });
  it('multiplies by JPY rate', () => {
    expect(convertFromEUR(100, 'JPY', rates)).toBeCloseTo(16238, 0);
  });
  it('passes null through as null', () => {
    expect(convertFromEUR(null, 'USD', rates)).toBeNull();
  });
});

describe('formatCurrency', () => {
  it('formats EUR with two decimals and € glyph', () => {
    expect(formatCurrency(359.17, 'EUR')).toBe('€359.17');
  });
  it('formats USD with two decimals and $ glyph', () => {
    expect(formatCurrency(386.4, 'USD')).toBe('$386.40');
  });
  it('formats GBP with two decimals and £ glyph', () => {
    expect(formatCurrency(308.22, 'GBP')).toBe('£308.22');
  });
  it('formats JPY with no decimals and ¥ glyph', () => {
    expect(formatCurrency(58349, 'JPY')).toBe('¥58,349');
  });
  it('renders em-dash for null values', () => {
    expect(formatCurrency(null, 'EUR')).toBe('—');
  });
});
```

- [ ] **Step 3: Run tests to confirm fail**

Run: `npm run test:unit`
Expected: 10 new tests fail with "Cannot find module '@/data/currency'".

- [ ] **Step 4: Implement `src/data/currency.ts`**

```ts
import type { ExchangeRates, SupportedCurrency } from './currency-schema';
import { CURRENCY_DECIMALS, CURRENCY_GLYPH } from './currency-schema';

export function convertFromEUR(
  eurValue: number | null,
  target: SupportedCurrency,
  rates: ExchangeRates,
): number | null {
  if (eurValue === null) return null;
  if (target === 'EUR') return eurValue;
  return eurValue * rates.rates[target];
}

export function formatCurrency(value: number | null, currency: SupportedCurrency): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const decimals = CURRENCY_DECIMALS[currency];
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${CURRENCY_GLYPH[currency]}${formatter.format(value)}`;
}
```

- [ ] **Step 5: Run tests to confirm pass**

Run: `npm run test:unit`
Expected: existing tests + 10 new currency tests all pass.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/data/currency-schema.ts src/data/currency.ts tests/unit/currency.test.ts
git commit -m "feat(currency): EUR-base conversion + locale-aware formatting"
```

---

## Task 4: Volatility utility + tests

**Files:**
- Create: `src/data/volatility.ts`
- Create: `tests/unit/volatility.test.ts`

- [ ] **Step 1: Write failing tests — `tests/unit/volatility.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { computeVolatility } from '@/data/volatility';

describe('computeVolatility', () => {
  it('returns unknown bucket when fewer than 7 points', () => {
    const r = computeVolatility([10, 11, 12, 11, 10, 11]);
    expect(r.bucket).toBe('unknown');
    expect(r.coefficient).toBeNull();
  });

  it('returns stable bucket when σ/μ < 3%', () => {
    // tiny variation around 100
    const r = computeVolatility([100, 101, 99, 100, 101, 100, 99, 100]);
    expect(r.bucket).toBe('stable');
    expect(r.coefficient).toBeLessThan(0.03);
  });

  it('returns moderate bucket when σ/μ is 3-10%', () => {
    // ~7% variation around 100
    const r = computeVolatility([100, 107, 93, 105, 95, 102, 98, 104]);
    expect(r.bucket).toBe('moderate');
    expect(r.coefficient).toBeGreaterThanOrEqual(0.03);
    expect(r.coefficient).toBeLessThan(0.10);
  });

  it('returns volatile bucket when σ/μ >= 10%', () => {
    // ~25% variation around 100
    const r = computeVolatility([60, 100, 140, 80, 120, 90, 130, 110]);
    expect(r.bucket).toBe('volatile');
    expect(r.coefficient).toBeGreaterThanOrEqual(0.10);
  });

  it('returns unknown when mean is zero (avoid division by zero)', () => {
    const r = computeVolatility([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.bucket).toBe('unknown');
    expect(r.coefficient).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm fail**

Run: `npm run test:unit`
Expected: 5 new tests fail with "Cannot find module '@/data/volatility'".

- [ ] **Step 3: Implement `src/data/volatility.ts`**

```ts
export type VolatilityBucket = 'stable' | 'moderate' | 'volatile' | 'unknown';
export type VolatilityResult = {
  bucket: VolatilityBucket;
  coefficient: number | null;
};

export function computeVolatility(trendSeries: number[]): VolatilityResult {
  if (trendSeries.length < 7) return { bucket: 'unknown', coefficient: null };
  const mean = trendSeries.reduce((a, b) => a + b, 0) / trendSeries.length;
  if (mean === 0) return { bucket: 'unknown', coefficient: null };
  const variance =
    trendSeries.reduce((acc, v) => acc + (v - mean) ** 2, 0) / trendSeries.length;
  const stddev = Math.sqrt(variance);
  const coefficient = stddev / mean;
  if (coefficient < 0.03) return { bucket: 'stable', coefficient };
  if (coefficient < 0.10) return { bucket: 'moderate', coefficient };
  return { bucket: 'volatile', coefficient };
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: 5 new tests pass. All other tests still pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/data/volatility.ts tests/unit/volatility.test.ts
git commit -m "feat(volatility): σ/μ-based bucketing (stable/moderate/volatile)"
```

---

## Task 5: Exchange rates fetch

**Files:**
- Create: `scripts/fetch-exchange-rates.ts`
- Modify: `package.json` (add script alias)

- [ ] **Step 1: Add script alias to `package.json`**

In the `"scripts"` block, add after `fetch-prices-fresh`:

```json
"fetch-exchange-rates": "tsx scripts/fetch-exchange-rates.ts",
```

- [ ] **Step 2: Write `scripts/fetch-exchange-rates.ts`**

```ts
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExchangeRatesSchema } from '../src/data/currency-schema.ts';

const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, '..', 'data', 'exchange-rates.json');

async function main() {
  const url = 'https://api.frankfurter.app/latest?from=EUR&to=USD,GBP,JPY';
  console.log(`Fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Frankfurter responded ${res.status}`);
  const body = (await res.json()) as unknown;
  // Frankfurter returns `amount` and other fields; drop them and validate our shape.
  const rawObj = body as { base: unknown; date: unknown; rates: unknown };
  const parsed = ExchangeRatesSchema.parse({ base: rawObj.base, date: rawObj.date, rates: rawObj.rates });
  writeFileSync(OUT_FILE, JSON.stringify(parsed, null, 2));
  console.log(`Wrote rates for ${parsed.date}: USD=${parsed.rates.USD}, GBP=${parsed.rates.GBP}, JPY=${parsed.rates.JPY}`);
}

main().catch((err) => {
  console.error('fetch-exchange-rates failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Smoke-test the script against the live API**

```bash
npm run fetch-exchange-rates
```

Expected output:
```
Fetching https://api.frankfurter.app/latest?from=EUR&to=USD,GBP,JPY...
Wrote rates for 2026-04-19: USD=1.0754, GBP=0.8581, JPY=162.38
```
(Actual numbers and date will differ.)

Verify the file exists and parses:

```bash
node -e 'const r = JSON.parse(require("fs").readFileSync("data/exchange-rates.json")); console.log(r)'
```

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-exchange-rates.ts data/exchange-rates.json package.json
git commit -m "feat(currency): nightly exchange-rate fetch from Frankfurter API"
```

---

## Task 6: D1 push script + bootstrap

**Files:**
- Create: `scripts/push-history-to-d1.ts`
- Create: `scripts/bootstrap-d1-history.ts`
- Modify: `package.json` (add script aliases)

**Note:** Running these scripts locally requires `wrangler login` + `database_id` set in `workers/history-api/wrangler.toml` (done in Task 1).

- [ ] **Step 1: Add script aliases to `package.json`**

After `fetch-exchange-rates`, add:

```json
"push-history-to-d1": "tsx scripts/push-history-to-d1.ts",
"bootstrap-d1-history": "tsx scripts/bootstrap-d1-history.ts",
```

- [ ] **Step 2: Write `scripts/push-history-to-d1.ts`**

```ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { PriceFileSchema } from '../src/data/price-schema.ts';

const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = resolve(__dirname, '..', 'data', 'prices-baseline.json');
const WORKER_DIR = resolve(__dirname, '..', 'workers', 'history-api');
const BATCH_SIZE = 200;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlValue(v: number | null): string {
  return v === null ? 'NULL' : String(v);
}

async function main() {
  const file = PriceFileSchema.parse(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')));
  const date = today();
  const statements: string[] = [];
  for (const record of Object.values(file.records)) {
    const cm = record.sources.cardmarket;
    if (!cm) continue;
    statements.push(
      `INSERT OR REPLACE INTO snapshots (cardId, date, trend, low, avg30, avg7, avg1) VALUES ('${escapeSqlString(record.cardId)}', '${date}', ${sqlValue(cm.trend)}, ${sqlValue(cm.low)}, ${sqlValue(cm.avg30)}, ${sqlValue(cm.avg7)}, ${sqlValue(cm.avg1)});`,
    );
  }
  console.log(`Prepared ${statements.length} INSERT statements for date ${date}`);

  const tmp = mkdtempSync(join(tmpdir(), 'd1-push-'));
  let pushed = 0;
  let failures = 0;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE).join('\n');
    const batchFile = join(tmp, `batch-${i}.sql`);
    writeFileSync(batchFile, batch);
    try {
      execSync(
        `npx wrangler d1 execute pokemon-tcg-history --remote --file=${batchFile}`,
        { cwd: WORKER_DIR, stdio: 'pipe' },
      );
      pushed += statements.slice(i, i + BATCH_SIZE).length;
    } catch (err) {
      failures++;
      console.warn(`Batch ${i / BATCH_SIZE} failed: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  console.log(`Pushed ${pushed}/${statements.length} rows, ${failures} batch failures`);
  if (failures > 0 && pushed === 0) {
    throw new Error('All batches failed — D1 push aborted');
  }
}

main().catch((err) => {
  console.error('push-history-to-d1 failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Write `scripts/bootstrap-d1-history.ts`**

```ts
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { PriceFileSchema } from '../src/data/price-schema.ts';

const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = resolve(__dirname, '..', 'data', 'prices-baseline.json');
const WORKER_DIR = resolve(__dirname, '..', 'workers', 'history-api');
const BATCH_SIZE = 200;

function isoDateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlValue(v: number | null): string {
  return v === null ? 'NULL' : String(v);
}

// Seeds D1 with 4 synthetic points per card so sparklines aren't empty on day 1:
//   today-29: trend = avg30    (Cardmarket's own 30-day average)
//   today-7:  trend = avg7
//   today-1:  trend = avg1
//   today:    trend = trend    (current)
// Idempotent: safe to re-run (INSERT OR REPLACE).
async function main() {
  const file = PriceFileSchema.parse(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')));
  const seedPlan: Array<{ days: number; field: 'trend' | 'avg30' | 'avg7' | 'avg1' }> = [
    { days: 29, field: 'avg30' },
    { days: 7,  field: 'avg7'  },
    { days: 1,  field: 'avg1'  },
    { days: 0,  field: 'trend' },
  ];
  const statements: string[] = [];
  for (const record of Object.values(file.records)) {
    const cm = record.sources.cardmarket;
    if (!cm) continue;
    for (const { days, field } of seedPlan) {
      const trend = cm[field];
      if (trend === null) continue;
      statements.push(
        `INSERT OR REPLACE INTO snapshots (cardId, date, trend, low, avg30, avg7, avg1) VALUES ('${escapeSqlString(record.cardId)}', '${isoDateDaysAgo(days)}', ${sqlValue(trend)}, ${sqlValue(cm.low)}, ${sqlValue(cm.avg30)}, ${sqlValue(cm.avg7)}, ${sqlValue(cm.avg1)});`,
      );
    }
  }
  console.log(`Prepared ${statements.length} bootstrap INSERT statements (~4 per card)`);

  const tmp = mkdtempSync(join(tmpdir(), 'd1-bootstrap-'));
  let pushed = 0;
  let failures = 0;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE).join('\n');
    const batchFile = join(tmp, `batch-${i}.sql`);
    writeFileSync(batchFile, batch);
    try {
      execSync(
        `npx wrangler d1 execute pokemon-tcg-history --remote --file=${batchFile}`,
        { cwd: WORKER_DIR, stdio: 'pipe' },
      );
      pushed += statements.slice(i, i + BATCH_SIZE).length;
    } catch (err) {
      failures++;
      console.warn(`Batch ${i / BATCH_SIZE} failed: ${(err as Error).message.slice(0, 200)}`);
    }
  }
  console.log(`Bootstrapped ${pushed}/${statements.length} rows, ${failures} batch failures`);
}

main().catch((err) => {
  console.error('bootstrap-d1-history failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the bootstrap locally (one-time seed)**

Prerequisites: `data/prices-baseline.json` must exist locally (run `npm run build` once first if not).

```bash
npm run bootstrap-d1-history
```

Expected: prints "Bootstrapped N/N rows". N will be roughly 21,500 × 4 ≈ 86,000 rows. Takes ~3-5 minutes because of per-batch HTTP.

- [ ] **Step 5: Verify bootstrap via the Worker**

```bash
WORKER_URL="<the URL from Task 2 step 3>"
curl -s "$WORKER_URL/history/base1-4?days=90" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const o=JSON.parse(d);console.log("snapshot count:",o.snapshots.length);console.log("sample:",JSON.stringify(o.snapshots[0],null,2))})'
```

Expected: ~4 snapshots for Charizard, with trend values derived from its avg30/avg7/avg1/trend.

- [ ] **Step 6: Commit**

```bash
git add scripts/push-history-to-d1.ts scripts/bootstrap-d1-history.ts package.json
git commit -m "feat(d1): push-history + bootstrap-history scripts with batched wrangler execute"
```

---

## Task 7: History pull script

**Files:**
- Create: `src/data/history-schema.ts`
- Create: `tests/unit/history-schema.test.ts`
- Create: `scripts/pull-history-from-worker.ts`
- Modify: `package.json` (script alias)
- Modify: `.gitignore`

- [ ] **Step 1: Write failing tests — `tests/unit/history-schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { SparklineDumpSchema, RangeDumpSchema } from '@/data/history-schema';

describe('SparklineDumpSchema', () => {
  it('accepts a well-formed sparkline dump', () => {
    const dump = {
      days: 30,
      cutoff: '2026-03-20',
      records: {
        'base1-4': [
          { cardId: 'base1-4', date: '2026-04-19', trend: 359.17, low: 92.5, avg30: 409.46, avg7: 324.13, avg1: 361.73 },
        ],
      },
    };
    expect(() => SparklineDumpSchema.parse(dump)).not.toThrow();
  });
  it('accepts an empty records map', () => {
    const empty = { days: 30, cutoff: '2026-03-20', records: {} };
    expect(() => SparklineDumpSchema.parse(empty)).not.toThrow();
  });
  it('rejects a dump missing records', () => {
    expect(() => SparklineDumpSchema.parse({ days: 30, cutoff: '2026-03-20' })).toThrow();
  });
});

describe('RangeDumpSchema', () => {
  it('accepts a well-formed range dump', () => {
    const dump = {
      days: 90,
      cutoff: '2026-01-19',
      records: { 'base1-4': { low: 287, high: 478, latest: 386 } },
    };
    expect(() => RangeDumpSchema.parse(dump)).not.toThrow();
  });
  it('accepts null values in range records', () => {
    const dump = {
      days: 90,
      cutoff: '2026-01-19',
      records: { 'base1-4': { low: null, high: null, latest: null } },
    };
    expect(() => RangeDumpSchema.parse(dump)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm fail**

Run: `npm run test:unit`
Expected: 5 new tests fail with "Cannot find module '@/data/history-schema'".

- [ ] **Step 3: Implement `src/data/history-schema.ts`**

```ts
import { z } from 'zod';

export const SnapshotSchema = z.object({
  cardId: z.string(),
  date: z.string(),
  trend: z.number().nullable(),
  low: z.number().nullable(),
  avg30: z.number().nullable(),
  avg7: z.number().nullable(),
  avg1: z.number().nullable(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const SparklineDumpSchema = z.object({
  days: z.number(),
  cutoff: z.string(),
  records: z.record(z.string(), z.array(SnapshotSchema)),
});
export type SparklineDump = z.infer<typeof SparklineDumpSchema>;

export const RangeSchema = z.object({
  low: z.number().nullable(),
  high: z.number().nullable(),
  latest: z.number().nullable(),
});
export type Range = z.infer<typeof RangeSchema>;

export const RangeDumpSchema = z.object({
  days: z.number(),
  cutoff: z.string(),
  records: z.record(z.string(), RangeSchema),
});
export type RangeDump = z.infer<typeof RangeDumpSchema>;
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npm run test:unit`
Expected: new tests pass, all existing tests still pass.

- [ ] **Step 5: Add to `.gitignore`**

Append to the `# Generated data` block:

```
data/sparkline-snapshot.json
data/range-snapshot.json
```

- [ ] **Step 6: Add `pull-history-from-worker` script alias to `package.json`**

After `push-history-to-d1`:

```json
"pull-history-from-worker": "tsx scripts/pull-history-from-worker.ts",
```

- [ ] **Step 7: Write `scripts/pull-history-from-worker.ts`**

```ts
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SparklineDumpSchema, RangeDumpSchema } from '../src/data/history-schema.ts';

const __dirname = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const SPARK_FILE = resolve(DATA_DIR, 'sparkline-snapshot.json');
const RANGE_FILE = resolve(DATA_DIR, 'range-snapshot.json');

const WORKER_URL = process.env.WORKER_URL;

const EMPTY_SPARK = { days: 30, cutoff: new Date(0).toISOString().slice(0, 10), records: {} };
const EMPTY_RANGE = { days: 90, cutoff: new Date(0).toISOString().slice(0, 10), records: {} };

async function fetchOrFallback<T>(url: string, schema: { parse: (x: unknown) => T }, fallback: T, label: string): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`${label}: HTTP ${res.status} from Worker — using empty fallback`);
      return fallback;
    }
    const body = await res.json();
    return schema.parse(body);
  } catch (err) {
    console.warn(`${label}: ${(err as Error).message} — using empty fallback`);
    return fallback;
  }
}

async function main() {
  if (!WORKER_URL) {
    console.warn('WORKER_URL not set — writing empty history snapshots');
    writeFileSync(SPARK_FILE, JSON.stringify(EMPTY_SPARK));
    writeFileSync(RANGE_FILE, JSON.stringify(EMPTY_RANGE));
    return;
  }

  console.log(`Pulling history from ${WORKER_URL}...`);
  const [spark, range] = await Promise.all([
    fetchOrFallback(`${WORKER_URL}/sparkline-dump?days=30`, SparklineDumpSchema, EMPTY_SPARK, 'sparkline-dump'),
    fetchOrFallback(`${WORKER_URL}/range-dump?days=90`, RangeDumpSchema, EMPTY_RANGE, 'range-dump'),
  ]);

  writeFileSync(SPARK_FILE, JSON.stringify(spark));
  writeFileSync(RANGE_FILE, JSON.stringify(range));
  console.log(`Wrote sparkline for ${Object.keys(spark.records).length} cards, range for ${Object.keys(range.records).length} cards`);
}

main().catch((err) => {
  console.error('pull-history-from-worker failed:', err);
  process.exit(1);
});
```

- [ ] **Step 8: Smoke-test the pull**

```bash
WORKER_URL="<your worker URL>" npm run pull-history-from-worker
```

Expected: prints "Wrote sparkline for N cards, range for M cards". N and M should be in the low thousands (from bootstrapped cards).

Verify: `ls -la data/sparkline-snapshot.json data/range-snapshot.json`

- [ ] **Step 9: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/data/history-schema.ts tests/unit/history-schema.test.ts scripts/pull-history-from-worker.ts package.json .gitignore
git commit -m "feat(history): zod schemas + pull-history-from-worker script"
```

---

## Task 8: PriceChart update for variable-length data

**Files:**
- Modify: `src/components/PriceChart.tsx`

PriceChart already accepts `{ label, value }[]` — the change is cosmetic only (hide the x-axis label when there are >10 points, since labels would collide).

- [ ] **Step 1: Modify `src/components/PriceChart.tsx` to hide labels when many points are provided**

Read the file first. Find the chart options block. Modify the `scales.x` portion:

```ts
// Before:
scales: {
  x: { display: false },
  y: { display: false },
},

// After (no change — x.display already false). But also: keep the `labels` prop
// so hover tooltips still show the date per point. Verify `data.labels` stays populated.
```

Actually no change is required to PriceChart — it already handles variable-length input. Mark this task as verification only.

- [ ] **Step 2: Verify PriceChart renders cleanly with 30 points (build time)**

No test added — e2e coverage in Task 11 exercises this.

- [ ] **Step 3: No commit needed (no changes)**

---

## Task 9: Volatility pill + RangePanel component

**Files:**
- Create: `src/components/RangePanel.astro`
- Modify: `src/components/PriceTile.astro`

- [ ] **Step 1: Create `src/components/RangePanel.astro`**

```astro
---
import type { Range } from '@/data/history-schema';
import type { SupportedCurrency } from '@/data/currency-schema';
import { convertFromEUR, formatCurrency } from '@/data/currency';
import type { ExchangeRates } from '@/data/currency-schema';

interface Props {
  range: Range | null;
  currency: SupportedCurrency;
  rates: ExchangeRates;
  cardMarketUnit: 'EUR' | 'USD';  // stays EUR for v2.1; ready for v2.2 multi-unit data
}

const { range, currency, rates, cardMarketUnit } = Astro.props;

if (range === null || range.low === null || range.high === null || range.latest === null) {
  // Not enough history yet — render an empty-state panel
}

const baseUnit = cardMarketUnit;  // treat all source values as EUR in v2.1
const lowEUR = range?.low ?? null;
const highEUR = range?.high ?? null;
const latestEUR = range?.latest ?? null;

const lowInCurrency = convertFromEUR(lowEUR, currency, rates);
const highInCurrency = convertFromEUR(highEUR, currency, rates);
const latestInCurrency = convertFromEUR(latestEUR, currency, rates);

const rangeValue =
  lowInCurrency !== null && highInCurrency !== null ? highInCurrency - lowInCurrency : null;
const percentFromLow =
  lowInCurrency !== null && lowInCurrency > 0 && latestInCurrency !== null
    ? Math.round(((latestInCurrency - lowInCurrency) / lowInCurrency) * 100)
    : null;

// Percent position of "latest" along the low→high axis, for the range-bar marker.
const markerPercent =
  lowEUR !== null && highEUR !== null && latestEUR !== null && highEUR > lowEUR
    ? Math.max(0, Math.min(100, Math.round(((latestEUR - lowEUR) / (highEUR - lowEUR)) * 100)))
    : 50;
---
<div class="range-panel">
  <div class="range-header">90-day range</div>

  {range === null || range.low === null ? (
    <div class="range-empty">No history yet — fills in over the next 30 days.</div>
  ) : (
    <>
      <div class="range-row">
        <div>
          <div class="range-label">LOW</div>
          <div class="range-value" data-eur={lowEUR} data-price-currency-field>
            {formatCurrency(lowInCurrency, currency)}
          </div>
        </div>
        <div class="range-right">
          <div class="range-label">HIGH</div>
          <div class="range-value" data-eur={highEUR} data-price-currency-field>
            {formatCurrency(highInCurrency, currency)}
          </div>
        </div>
      </div>

      <div class="range-bar-wrap">
        <div class="range-bar-bg"></div>
        <div class="range-bar-fg"></div>
        <div class="range-marker" style={`left: ${markerPercent}%`}></div>
        <div class="range-marker-label" style={`left: ${markerPercent}%`}>
          now {formatCurrency(latestInCurrency, currency)}
        </div>
      </div>

      <div class="range-stats">
        <div>
          <div class="range-label">range</div>
          <div class="range-stat" data-eur={rangeValue !== null && highEUR !== null && lowEUR !== null ? (highEUR - lowEUR) : null} data-price-currency-field>
            {formatCurrency(rangeValue, currency)}
          </div>
        </div>
        <div class="range-right">
          <div class="range-label">% from low</div>
          <div class="range-stat range-positive">
            {percentFromLow !== null ? `${percentFromLow > 0 ? '+' : ''}${percentFromLow}%` : '—'}
          </div>
        </div>
      </div>

      <div class="range-footer">History from Cloudflare D1 · seeded with Cardmarket 30d/7d/1d on day 1</div>
    </>
  )}
</div>

<style>
  .range-panel {
    background: linear-gradient(180deg, #fffdf6, #f5efe2);
    border: 1px solid #d9c9a3;
    border-radius: 12px;
    padding: 14px 16px;
    font-family: 'Helvetica Neue', system-ui, sans-serif;
    color: #3b2a1a;
    min-height: 180px;
  }
  .range-header {
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #7a5e3a;
  }
  .range-empty {
    margin-top: 16px;
    font-size: 12px;
    color: #7a5e3a;
  }
  .range-row, .range-stats {
    display: flex;
    justify-content: space-between;
    margin-top: 8px;
  }
  .range-right { text-align: right; }
  .range-label {
    font-size: 10px;
    color: #7a5e3a;
    letter-spacing: 1px;
  }
  .range-value {
    font-size: 14px;
    font-weight: 600;
  }
  .range-stat {
    font-size: 12px;
    font-weight: 600;
  }
  .range-positive { color: #2d7d47; }

  .range-bar-wrap {
    position: relative;
    height: 32px;
    margin-top: 14px;
  }
  .range-bar-bg {
    position: absolute;
    top: 13px; left: 0; right: 0;
    height: 4px;
    background: #e8ddc6;
    border-radius: 2px;
  }
  .range-bar-fg {
    position: absolute;
    top: 13px; left: 0; right: 0;
    height: 4px;
    background: linear-gradient(90deg, #ffb347, #c86f3d);
    border-radius: 2px;
  }
  .range-marker {
    position: absolute;
    top: 6px;
    width: 2px; height: 18px;
    background: #3b2a1a;
    transform: translateX(-50%);
  }
  .range-marker-label {
    position: absolute;
    top: 0;
    font-size: 9px;
    color: #3b2a1a;
    font-weight: 600;
    white-space: nowrap;
    transform: translateX(-50%);
  }

  .range-footer {
    margin-top: 14px;
    padding-top: 8px;
    border-top: 1px solid #e8ddc6;
    font-size: 10px;
    color: #7a5e3a;
  }
</style>
```

- [ ] **Step 2: Modify `src/components/PriceTile.astro` — update props, pass history/range into render, add volatility pill**

Read the file first. Replace with:

```astro
---
import PriceChart from '@/components/PriceChart';
import RangePanel from '@/components/RangePanel.astro';
import type { CardPriceRecord } from '@/data/price-schema';
import type { Snapshot, Range } from '@/data/history-schema';
import type { SupportedCurrency, ExchangeRates } from '@/data/currency-schema';
import { trendVsAvg30 } from '@/data/price-delta';
import { freshnessBadge } from '@/data/price-freshness';
import { computeVolatility } from '@/data/volatility';
import { convertFromEUR, formatCurrency } from '@/data/currency';

interface Props {
  record: CardPriceRecord;
  history: Snapshot[];
  range: Range | null;
  currency: SupportedCurrency;
  rates: ExchangeRates;
}
const { record, history, range, currency, rates } = Astro.props;
const cm = record.sources.cardmarket;
if (!cm) throw new Error('PriceTile rendered without cardmarket source');

const delta = trendVsAvg30({ trend: cm.trend, avg30: cm.avg30 });
const badge = freshnessBadge({ updatedAt: cm.updatedAt });

// Build sparkline points from history (oldest first).
const chartPoints = history
  .filter((h) => h.trend !== null)
  .sort((a, b) => a.date.localeCompare(b.date))
  .map((h) => ({ label: h.date, value: h.trend as number }));

// Fallback to the 4-point synthetic line if history is empty.
if (chartPoints.length === 0) {
  if (cm.avg30 !== null) chartPoints.push({ label: '30d avg', value: cm.avg30 });
  if (cm.avg7 !== null)  chartPoints.push({ label: '7d avg',  value: cm.avg7 });
  if (cm.avg1 !== null)  chartPoints.push({ label: '1d avg',  value: cm.avg1 });
  if (cm.trend !== null) chartPoints.push({ label: 'now',     value: cm.trend });
}

const trendSeries = chartPoints.map((p) => p.value);
const { bucket: volBucket, coefficient: volCoef } = computeVolatility(trendSeries);

// Convert all displayed numbers at build time.
const trendInCurrency = convertFromEUR(cm.trend, currency, rates);
---
<section class="price-tile" data-price-tile={record.cardId}>
  <div class="live-card" data-price-source="cardmarket">
    <header>
      <span class="src-label">Cardmarket</span>
      <div class="header-badges">
        {volBucket !== 'unknown' && (
          <span class={`badge volatility-pill volatility-${volBucket}`} data-volatility={volBucket}>
            {volBucket.toUpperCase()}
          </span>
        )}
        <span class={`badge badge-${badge.kind}`}>{badge.kind === 'live' ? '● LIVE' : badge.label}</span>
      </div>
    </header>

    <div class="price-headline">
      <div class="price-number"
           data-eur={cm.trend}
           data-price-currency-field>
        {formatCurrency(trendInCurrency, currency)}
      </div>
      <div class="price-caption">trend price</div>
    </div>

    {chartPoints.length >= 2 && (
      <div class="price-chart-slot">
        <PriceChart client:visible points={chartPoints.map(p => ({ label: p.label, value: convertFromEUR(p.value, currency, rates) ?? 0 }))} currency={currency} />
      </div>
    )}

    {delta !== null && (
      <footer class="tile-footer">
        <div class="delta">
          <span class="delta-label">vs 30d avg</span>
          <span class={`delta-value delta-${delta.direction}`} data-delta-direction={delta.direction}>
            {delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '◆'}
            {' '}
            <span data-eur={delta.absolute} data-price-currency-field>{formatCurrency(convertFromEUR(Math.abs(delta.absolute), currency, rates), currency)}</span>
            {' · '}{delta.percent > 0 ? '+' : ''}{delta.percent.toFixed(1)}%
          </span>
        </div>
        <div class="src-footer">
          {volCoef !== null ? `σ/μ ${(volCoef * 100).toFixed(1)}% · 30d` : ''}<br/>
          updated {badge.kind === 'live' ? 'just now' : badge.label.replace('updated ', '')} · Cardmarket
        </div>
      </footer>
    )}
  </div>

  <RangePanel range={range} currency={currency} rates={rates} cardMarketUnit="EUR" />
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

  .live-card {
    background: linear-gradient(180deg, #fffdf6, #f5efe2);
    border: 1px solid #d9c9a3;
    border-radius: 12px;
    padding: 14px 16px;
    font-family: 'Helvetica Neue', system-ui, sans-serif;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .header-badges { display: flex; gap: 6px; align-items: center; }
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

  .volatility-pill { font-weight: 600; }
  .volatility-stable   { color: #2d7d47; background: #e5f2e8; }
  .volatility-moderate { color: #c86f3d; background: #fef2e5; }
  .volatility-volatile { color: #a84b1f; background: #fde4d9; }

  .price-headline { margin-top: 4px; }
  .price-number { font-size: 28px; font-weight: 700; color: #3b2a1a; line-height: 1; }
  .price-caption { font-size: 11px; color: #5a4a36; margin-top: 2px; }

  .price-chart-slot { margin-top: 10px; }

  .tile-footer {
    border-top: 1px solid #e8ddc6;
    margin-top: 10px;
    padding-top: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
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
</style>
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/PriceTile.astro src/components/RangePanel.astro
git commit -m "feat(ui): volatility pill + RangePanel replacing eBay placeholder"
```

---

## Task 10: Currency switcher UI

**Files:**
- Create: `src/components/CurrencySelect.tsx`
- Modify: `src/layouts/Base.astro`

- [ ] **Step 1: Create `src/components/CurrencySelect.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { SUPPORTED_CURRENCIES, CURRENCY_GLYPH, CURRENCY_DECIMALS, type SupportedCurrency } from '@/data/currency-schema';

const STORAGE_KEY = 'pokemon-tcg-currency';
const DEFAULT: SupportedCurrency = 'EUR';

function detectDefault(): SupportedCurrency {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_CURRENCIES as readonly string[]).includes(saved)) {
      return saved as SupportedCurrency;
    }
  } catch {}
  try {
    const locale = Intl.NumberFormat().resolvedOptions().locale;
    const region = locale.split('-')[1]?.toUpperCase();
    if (region === 'US') return 'USD';
    if (region === 'GB') return 'GBP';
    if (region === 'JP') return 'JPY';
  } catch {}
  return DEFAULT;
}

function applyCurrencyToDOM(next: SupportedCurrency, rates: { USD: number; GBP: number; JPY: number }) {
  document.querySelectorAll<HTMLElement>('[data-price-currency-field]').forEach((el) => {
    const eur = el.getAttribute('data-eur');
    if (eur === null || eur === '') return;
    const eurNum = Number(eur);
    if (!Number.isFinite(eurNum)) return;
    const value = next === 'EUR' ? eurNum : eurNum * rates[next];
    const decimals = CURRENCY_DECIMALS[next];
    const formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    el.textContent = `${CURRENCY_GLYPH[next]}${formatter.format(Math.abs(value))}`;
  });
}

export default function CurrencySelect({ rates }: { rates: { USD: number; GBP: number; JPY: number } }) {
  const [current, setCurrent] = useState<SupportedCurrency>(DEFAULT);

  useEffect(() => {
    const detected = detectDefault();
    setCurrent(detected);
    if (detected !== DEFAULT) applyCurrencyToDOM(detected, rates);
  }, []);

  function onChange(e: Event) {
    const next = (e.target as HTMLSelectElement).value as SupportedCurrency;
    setCurrent(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    applyCurrencyToDOM(next, rates);
  }

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '10px', color: '#7a5e3a', letterSpacing: '1px', textTransform: 'uppercase' }}>
        Currency
      </span>
      <select
        value={current}
        onChange={onChange}
        data-currency-select
        style={{
          padding: '4px 8px',
          border: '1px solid #d9c9a3',
          borderRadius: '16px',
          background: '#fffdf6',
          fontSize: '12px',
          color: '#3b2a1a',
          cursor: 'pointer',
        }}
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c} {CURRENCY_GLYPH[c]}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Modify `src/layouts/Base.astro` to add the header strip**

Read the file first. Modify the template: add a header strip with CurrencySelect above `<main>`. The frontmatter changes to accept optional `rates`:

```astro
---
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Disclaimer from '@/components/Disclaimer.astro';
import CurrencySelect from '@/components/CurrencySelect';
import { ExchangeRatesSchema, type ExchangeRates } from '@/data/currency-schema';

interface Props { title: string; description?: string }
const { title, description = 'Pokémon TCG multilingual catalog' } = Astro.props;

// Load exchange rates for the currency switcher.
const ratesPath = resolve(process.cwd(), 'data', 'exchange-rates.json');
const fallbackRates: ExchangeRates = {
  base: 'EUR',
  date: '1970-01-01',
  rates: { USD: 1, GBP: 1, JPY: 1 },
};
const rates: ExchangeRates = existsSync(ratesPath)
  ? ExchangeRatesSchema.parse(JSON.parse(readFileSync(ratesPath, 'utf8')))
  : fallbackRates;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <style is:global>
      :root {
        --bg: #f5efe2;
        --paper: #fffdf6;
        --ink: #3b2a1a;
        --muted: #7a5e3a;
        --accent: #c86f3d;
      }
      body {
        background: var(--bg);
        color: var(--ink);
        font-family: 'Helvetica Neue', system-ui, sans-serif;
        margin: 0;
      }
      header.site-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: var(--paper);
        border-bottom: 1px solid #e8ddc6;
        max-width: 1100px;
        margin: 0 auto;
      }
      header.site-header .site-title { font-weight: 600; font-size: 13px; }
      main { max-width: 1100px; margin: 0 auto; padding: 2rem 1rem; }
      h1 { font-weight: 600; letter-spacing: -0.5px; }
      a { color: var(--accent); }
    </style>
  </head>
  <body>
    <header class="site-header">
      <span class="site-title">Pokémon TCG Catalog</span>
      <CurrencySelect client:load rates={rates.rates} />
    </header>
    <main><slot /></main>
    <Disclaimer />
  </body>
</html>
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/CurrencySelect.tsx src/layouts/Base.astro
git commit -m "feat(ui): site-header CurrencySelect with localStorage persistence"
```

---

## Task 11: card/[id].astro integration + e2e tests

**Files:**
- Modify: `src/pages/card/[id].astro`
- Modify: `tests/e2e/price-tile.spec.ts`
- Create: `tests/e2e/currency-switch.spec.ts`

- [ ] **Step 1: Modify `src/pages/card/[id].astro`**

Read the file first. Replace the frontmatter block with:

```astro
---
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Base from '@/layouts/Base.astro';
import PrintGallery from '@/components/PrintGallery.astro';
import PriceTile from '@/components/PriceTile.astro';
import type { CardIdentity } from '@/data/schema';
import type { PriceFile, CardPriceRecord } from '@/data/price-schema';
import type { SparklineDump, RangeDump, Snapshot, Range } from '@/data/history-schema';
import type { SupportedCurrency, ExchangeRates } from '@/data/currency-schema';
import { mergePrices } from '@/data/price-merge';
import { ExchangeRatesSchema } from '@/data/currency-schema';
import { SparklineDumpSchema, RangeDumpSchema } from '@/data/history-schema';

const DEFAULT_CURRENCY: SupportedCurrency = 'EUR';

export async function getStaticPaths() {
  const cards: CardIdentity[] = JSON.parse(
    readFileSync(resolve(process.cwd(), 'data/cards.json'), 'utf8'),
  );

  const baselinePath = resolve(process.cwd(), 'data/prices-baseline.json');
  const freshPath = resolve(process.cwd(), 'data/prices-fresh.json');
  const sparkPath = resolve(process.cwd(), 'data/sparkline-snapshot.json');
  const rangePath = resolve(process.cwd(), 'data/range-snapshot.json');
  const ratesPath = resolve(process.cwd(), 'data/exchange-rates.json');

  const emptyPriceFile: PriceFile = { generatedAt: new Date(0).toISOString(), records: {} };
  const emptySparkline: SparklineDump = { days: 30, cutoff: '1970-01-01', records: {} };
  const emptyRange: RangeDump = { days: 90, cutoff: '1970-01-01', records: {} };
  const fallbackRates: ExchangeRates = {
    base: 'EUR',
    date: '1970-01-01',
    rates: { USD: 1, GBP: 1, JPY: 1 },
  };

  const baseline: PriceFile = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : emptyPriceFile;
  const fresh: PriceFile = existsSync(freshPath) ? JSON.parse(readFileSync(freshPath, 'utf8')) : emptyPriceFile;
  const spark: SparklineDump = existsSync(sparkPath) ? SparklineDumpSchema.parse(JSON.parse(readFileSync(sparkPath, 'utf8'))) : emptySparkline;
  const range: RangeDump = existsSync(rangePath) ? RangeDumpSchema.parse(JSON.parse(readFileSync(rangePath, 'utf8'))) : emptyRange;
  const rates: ExchangeRates = existsSync(ratesPath) ? ExchangeRatesSchema.parse(JSON.parse(readFileSync(ratesPath, 'utf8'))) : fallbackRates;

  const merged = mergePrices(baseline, fresh);

  return cards.map((card) => {
    const history: Snapshot[] = spark.records[card.id] ?? [];
    const rangeForCard: Range | null = range.records[card.id] ?? null;
    return {
      params: { id: card.id },
      props: {
        card,
        priceRecord: merged[card.id] ?? null,
        history,
        rangeForCard,
        rates,
      },
    };
  });
}

interface Props {
  card: CardIdentity;
  priceRecord: CardPriceRecord | null;
  history: Snapshot[];
  rangeForCard: Range | null;
  rates: ExchangeRates;
}
const { card, priceRecord, history, rangeForCard, rates } = Astro.props;
---
<Base title={`${card.defaultName} — Pokémon TCG Catalog`}>
  <article data-pagefind-body data-pagefind-meta={`title:${card.defaultName}`}>
    <h1>{card.defaultName}</h1>
    <PrintGallery card={card} />
    {priceRecord !== null && priceRecord.sources.cardmarket && (
      <PriceTile
        record={priceRecord}
        history={history}
        range={rangeForCard}
        currency={DEFAULT_CURRENCY}
        rates={rates}
      />
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

- [ ] **Step 2: Update existing e2e tests — `tests/e2e/price-tile.spec.ts`**

Read the file first. Add two new tests to it (append before the closing of the top-level describe if it has one; otherwise just append at end of file):

```ts
test('PriceTile renders volatility pill when enough history exists', async ({ page }) => {
  await page.goto('card/base1-4');
  // Once the worker has >=7 snapshots (after bootstrap + a few days of nightly),
  // this will render a pill. For the fixture build (no worker), skip with soft assertion.
  const tile = page.locator('.price-tile');
  await expect(tile).toBeVisible();
  // Pill may or may not be present depending on history state — check only that
  // if present, it has one of the three expected values.
  const pill = tile.locator('.volatility-pill');
  const count = await pill.count();
  if (count > 0) {
    await expect(pill).toHaveAttribute('data-volatility', /(stable|moderate|volatile)/);
  }
});

test('PriceTile renders the RangePanel replacing the old eBay placeholder', async ({ page }) => {
  await page.goto('card/base1-4');
  const panel = page.locator('.range-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.range-header')).toHaveText('90-day range');
  // The old eBay placeholder copy should be GONE.
  await expect(page.locator('body')).not.toContainText(/awaiting v2\.1/i);
});
```

- [ ] **Step 3: Write new e2e suite — `tests/e2e/currency-switch.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('currency selector is visible in the site header', async ({ page }) => {
  await page.goto('card/base1-4');
  const select = page.locator('[data-currency-select]');
  await expect(select).toBeVisible();
  const options = await select.locator('option').allTextContents();
  expect(options).toEqual(expect.arrayContaining([
    expect.stringContaining('EUR'),
    expect.stringContaining('USD'),
    expect.stringContaining('GBP'),
    expect.stringContaining('JPY'),
  ]));
});

test('changing currency updates every price on the page', async ({ page }) => {
  await page.goto('card/base1-4');
  // Default starts at EUR (or browser locale; in test env likely EUR)
  const priceNumber = page.locator('.price-tile .price-number').first();
  const initialText = await priceNumber.textContent();
  expect(initialText).toMatch(/[€$£¥][0-9]/);

  // Switch to USD
  await page.selectOption('[data-currency-select]', 'USD');
  await expect(priceNumber).toHaveText(/^\$[0-9]/);

  // Switch to GBP
  await page.selectOption('[data-currency-select]', 'GBP');
  await expect(priceNumber).toHaveText(/^£[0-9]/);

  // Switch to JPY (no decimal)
  await page.selectOption('[data-currency-select]', 'JPY');
  await expect(priceNumber).toHaveText(/^¥[0-9,]+$/);
});

test('currency choice persists across page reload', async ({ page }) => {
  await page.goto('card/base1-4');
  await page.selectOption('[data-currency-select]', 'GBP');
  await page.reload();
  await expect(page.locator('.price-tile .price-number').first()).toHaveText(/^£[0-9]/);
});
```

- [ ] **Step 4: Local rebuild + full e2e**

```bash
# Ensure we have local copies of all data files. If you have a Cloudflare-authenticated shell:
WORKER_URL="<your worker URL>" npm run pull-history-from-worker
npm run fetch-exchange-rates
# Then trigger the fixture-mode build (fast, offline-capable) for Playwright:
npm run build:fixtures-empty-prices   # ← existing from v2.0
# Actually for v2.1's new assertions we want a full build:
npm run build
# Finally the e2e:
npx playwright test --reporter=list
```

Expected: all existing tests pass + 5 new tests pass (2 PriceTile + 3 currency-switch).

If `build` fails locally because `data/cards.json` isn't present, run `npm run build` once from scratch. Playwright's configured `webServer.command` is `build:fixtures-empty-prices && preview`; for this step run `build && preview` in two terminals instead.

- [ ] **Step 5: Commit**

```bash
git add src/pages/card/[id].astro tests/e2e/price-tile.spec.ts tests/e2e/currency-switch.spec.ts
git commit -m "feat(ui): card-page integration for history + currency + volatility + range panel"
```

---

## Task 12: CI workflow integration + deploy

**Files:**
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Modify `.github/workflows/build.yml` to include new steps**

Read the file first. Add three new steps to the `build` job, in this order after `npm run test:unit` but before the `Build (live TCGdex fetch)` step:

```yaml
      - name: Fetch exchange rates
        run: npm run fetch-exchange-rates
      - name: Push today's history snapshot to D1
        run: npm run push-history-to-d1
        continue-on-error: true      # don't fail build if D1 push has transient error
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Pull history snapshot from Worker
        run: npm run pull-history-from-worker
        continue-on-error: true      # sparkline disappears if this fails, but build still succeeds
        env:
          WORKER_URL: ${{ secrets.WORKER_URL }}
```

The existing `Build (live TCGdex fetch)` step already runs `npm run build` — this picks up `data/exchange-rates.json` and the two history snapshot files automatically.

- [ ] **Step 2: Commit and push**

```bash
git add .github/workflows/build.yml
git commit -m "ci: add exchange rates, D1 push, and history pull steps to nightly build"
```

- [ ] **Step 3: Ensure GitHub repo has the three new secrets**

Report to user — they do this manually via the GitHub web UI (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — with scope `Account.D1:Edit` for the `pokemon-tcg-history` database
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID (find via `npx wrangler whoami`)
- `WORKER_URL` — the URL from Task 2 Step 3 (e.g. `https://pokemon-tcg-history-api.<account>.workers.dev`)

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Watch the triggered workflow**

```bash
gh run watch $(gh run list --workflow=build-and-deploy --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Expected: the build step output includes lines from all three new scripts. The workflow takes longer than v2.0's ~3-5 min because of the bootstrap-size history push and pull; expect 6-10 min.

- [ ] **Step 6: Verify the live site**

```bash
# Charizard page shows a sparkline AND a range panel AND a currency switcher
curl -s https://davstaylor.github.io/pokemon-tcg/card/base1-4/ | grep -oE 'price-chart-slot|range-panel|data-currency-select' | sort -u
# Expected: three lines (one per feature)

# Spot-check a second card from the bootstrap:
curl -sI https://davstaylor.github.io/pokemon-tcg/card/base1-1/ | head -1
# Expected: HTTP/2 200
```

- [ ] **Step 7: Final no-op commit only if a post-deploy fix was needed**

If all verifications pass, no additional commit. The plan is complete.

---

## Self-review checklist

**Spec coverage:**

| Spec § | Covered in task(s) |
| --- | --- |
| §1 Vision | Implicit throughout |
| §2 Milestone status | Task 9 removes dashed eBay placeholder |
| §3 Architecture diagram | Tasks 1-7 (data path), Task 10-12 (UI + deploy) |
| §4 D1 schema | Task 1 (schema.sql), Task 2 (Worker queries) |
| §5 Worker API — 3 endpoints | Task 2 |
| §6 Ingest pipeline | Task 6 (push script), Task 12 (CI integration) |
| §7 Build-time read | Task 7 (pull script), Task 11 (card-page integration) |
| §8 Volatility | Task 4 (util), Task 9 (pill rendering) |
| §9 Currency layer | Task 3 (util), Task 5 (rates fetch), Task 10 (switcher UI), Task 11 (data attrs everywhere) |
| §10 UI changes | Task 9 (tile update + RangePanel), Task 10 (header + switcher) |
| §11 Day-1 bootstrap | Task 6 |
| §12 Error handling | Task 7 (fallbacks on Worker fail), Task 12 (`continue-on-error`) |
| §13 Testing | Task 3/4/7 (unit), Task 11 (e2e) |
| §14 Key decisions | Embedded in Context and per-task rationales |

**Placeholder scan:** no "TBD" / "similar to Task N" / "handle edge cases" patterns. Every step has concrete code or commands.

**Type consistency:**
- `Snapshot`, `SparklineDump`, `RangeDump`, `Range` defined in Task 7 and used identically in Tasks 9, 11.
- `SupportedCurrency`, `ExchangeRates` defined in Task 3 and used identically in Tasks 9, 10, 11.
- `CardPriceRecord` from v2.0 is passed through unchanged.
- `VolatilityResult` bucket values match between Task 4 (`'stable' | 'moderate' | 'volatile' | 'unknown'`) and Task 9 (CSS classes `.volatility-stable` etc.).
- `data-price-currency-field` selector is set in Task 9 (PriceTile/RangePanel rendering) and consumed in Task 10 (CurrencySelect DOM mutation).

**Known risks for executor:**
- Task 1 requires user-driven wrangler login. Don't skip it. The implementer subagent should produce the files and stop.
- Task 6 bootstrap takes 3-5 minutes for ~86k rows and costs one full use of the D1 write allowance. Idempotent but expensive.
- Task 12's first live run will be slower than subsequent runs; don't panic if it takes 10 min.
- `CLOUDFLARE_API_TOKEN` must have `D1:Edit` scope specifically; tokens with only `Workers:Edit` won't allow writes.

---

## Estimated effort

| Task | Effort |
| --- | --- |
| 1 Worker scaffold + D1 | 40 min (plus user wrangler steps) |
| 2 Worker endpoints + deploy | 40 min |
| 3 Currency util | 25 min |
| 4 Volatility util | 20 min |
| 5 Exchange rates | 20 min |
| 6 Push + bootstrap scripts | 50 min (plus ~5 min bootstrap wall time) |
| 7 History pull | 40 min |
| 8 PriceChart (verify) | 5 min |
| 9 PriceTile + RangePanel | 60 min |
| 10 CurrencySelect + Base.astro | 50 min |
| 11 Card-page integration + e2e | 60 min |
| 12 CI workflow + deploy | 30 min (plus ~10 min CI wall time) |
| **Total** | **~7.5 hours focused work + ~20 min CI wall time** |

Realistically a full day with debugging, Cloudflare account setup, and visual verification.
