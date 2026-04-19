# Pokémon TCG Prices v2.1 — Time-Series History + Volatility + Currency Switching

**Date:** 2026-04-19
**Status:** Approved (brainstorming → implementation-ready)
**Scope:** v2.1 only. Replaces the original v2.1 scope (eBay integration) with a richer single-source story: persistent per-card time-series history in Cloudflare D1, a real 30-point sparkline driven by that history, a volatility pill, a site-wide currency switcher, and a 90-day range panel that repurposes the retired eBay placeholder.

**Builds on:** [v2.0 prices](2026-04-19-pokemon-tcg-prices-v2-design.md) (PriceTile, PriceChart, nightly + fast-poll pipelines) and [live-data fetch](2026-04-19-pokemon-tcg-live-data-design.md) (full catalog, 23k cards on every build). The eBay integration originally planned for v2.1 is deferred indefinitely; its placeholder is removed in this milestone.

## 1. Vision

Visitors already see "what does this card cost right now" — v2.0 delivered that. v2.1 adds "what has it *been* costing, and how volatile is it?" The card page becomes a mini time-series reference with a sparkline, a volatility rating, and a 90-day range — all driven by history we accumulate in Cloudflare D1 over time. Currency switching makes the tile useful to non-EUR visitors.

## 2. Milestone status

| Milestone | Status |
| --- | --- |
| **v2.0** | Shipped. Single-source Cardmarket PriceTile on every card where data exists. |
| **v2.1 — this spec** | Time-series history in D1, real sparkline, volatility pill, currency switcher, 90-day range panel. **Replaces the eBay integration originally scoped for v2.1.** |
| **v2.2+** | Possible future work: cross-source (eBay or similar) if operational appetite appears; per-variant holo tracking; price alerts. |

v2.0's deliberate "dashed eBay placeholder" is retired in v2.1 — the honest move given the pivot. The right column of the PriceTile is repurposed for the 90-day range panel.

## 3. Architecture

Four services, one data boundary (Cloudflare D1 is the new external trust boundary for writes):

```
┌─ GitHub Actions (nightly) ─────────────────────────────────────────┐
│                                                                     │
│  ① fetch-and-build-data.ts (existing)                              │
│      → data/cards.json, data/prices-baseline.json                   │
│                                                                     │
│  ② fetch-exchange-rates.ts (NEW)                                   │
│      → Frankfurter API → data/exchange-rates.json                   │
│                                                                     │
│  ③ push-history-to-d1.ts (NEW, uses wrangler CLI)                  │
│      INSERT OR REPLACE snapshots (cardId, date, trend, low, ...)    │
│      ┌──────────────────────────────────────────────────────────┐   │
│      │         Cloudflare D1 (time-series DB)                   │   │
│      │  table: snapshots (cardId, date, trend, low, avg…)       │   │
│      └──────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ④ pull-history-from-worker.ts (NEW)                               │
│      GET /sparkline-dump?days=30  (30-day per-card snapshots)      │
│      GET /range-dump?days=90      (90-day aggregated min/max/now)  │
│      → data/sparkline-snapshot.json + data/range-snapshot.json     │
│        (local, not committed)                                       │
│                                                                     │
│  ⑤ Astro build                                                     │
│      reads cards.json + prices + exchange-rates + history-snapshot  │
│      emits per-card static HTML with sparkline data + multi-        │
│      currency values pre-computed as data-* attributes              │
│                                                                     │
│  ⑥ Pagefind + Pages deploy (existing)                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─ Cloudflare Worker (read-only, public) ─────────────────────────┐
│                                                                 │
│  GET /history/:cardId?days=90      → last N days, one card      │
│  GET /history-dump?days=90         → last N days, all cards     │
│  bindings: { D1: <snapshots db> }                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─ Client (static site) ──────────────────────────────────────────┐
│  No runtime fetches for history. Sparkline + volatility +       │
│  range panel are all baked into each card's HTML.               │
│  <CurrencySelect> is a Preact island that toggles which         │
│  data-* attribute is shown. localStorage persists the choice.   │
└─────────────────────────────────────────────────────────────────┘
```

**Write boundary:** GH Actions → D1 via wrangler CLI, authenticated by `CLOUDFLARE_API_TOKEN` (GitHub secret). D1 only accepts writes with this token.

**Read boundary:** Public HTTP from the Worker. No auth. CORS allows our domain. The Worker only runs at build time (called once per nightly), so visitor traffic never hits it.

## 4. D1 schema

```sql
-- Single table. Append-only via INSERT OR REPLACE.
CREATE TABLE IF NOT EXISTS snapshots (
  cardId TEXT NOT NULL,
  date TEXT NOT NULL,              -- 'YYYY-MM-DD', always UTC
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

- **Primary key is `(cardId, date)`** — allows `INSERT OR REPLACE` to be idempotent if the nightly runs twice in a day.
- **`idx_card_date`** — covers the per-card query path (card page sparkline).
- **`idx_date`** — covers the "dump everything for the last N days" query (build-time full-catalog pull).
- **No retention cap in v2.1** — D1 is effectively free up to 5GB. At ~50 bytes/row × 23k cards/day × 365 days ≈ 420 MB/year, we're fine for many years.

Nightly writes ~23,000 `INSERT OR REPLACE` rows per run. D1's free tier allows 100,000 writes/day; we use ~23k + headroom for retries.

## 5. Worker API

Single worker deployment. Lives in `workers/history-api/`:

```
workers/history-api/
├── wrangler.toml       # D1 binding, route config
├── src/index.ts        # router + handlers
├── package.json        # wrangler, typescript
└── README.md           # local dev instructions
```

**Endpoints (designed around two distinct build-time needs + one convenience):**

- `GET /history/:cardId?days=90`
  - Returns `{ cardId, days, snapshots: [{ date, trend, low, avg30, avg7, avg1 }, ...] }` sorted date-desc.
  - Used for single-card lookups (local dev, debugging, external consumers).

- `GET /sparkline-dump?days=30`
  - Returns `{ days, cutoff, records: { cardId: [...last 30 snapshots...], ... } }`, covering every card with history in the window.
  - Size estimate at steady-state: ~21k cards × 30 snapshots × ~110 bytes of compact JSON ≈ **69 MB raw, ~14 MB gzipped**. Fits inside Cloudflare Workers' 25 MB response ceiling on the free plan (with headroom).
  - Used by nightly build to populate every card's 30-point sparkline.

- `GET /range-dump?days=90`
  - Returns `{ days, records: { cardId: { low: number, high: number, latest: number }, ... } }`.
  - Pre-aggregated (`SELECT MIN(trend), MAX(trend), trend FROM snapshots WHERE date >= cutoff GROUP BY cardId`), so the payload is tiny: **~50 bytes × 21k ≈ 1 MB**.
  - Used by nightly build to populate each card's 90-day range panel. Separating this from the sparkline dump keeps each payload small enough for a single Worker response and makes the build less sensitive to either endpoint's performance.

**CORS:** `Access-Control-Allow-Origin: *` on all GET endpoints. Read-only, non-sensitive data (public market prices).

The Worker has zero auth. Cloudflare Workers' free plan covers 100k requests/day, far more than anyone would realistically use.

**Payload format note:** responses use JSON with short keys (`t` not `trend`, etc.) to trim size if profiling shows we're close to the 25 MB ceiling. v2.1 starts with full key names for readability; switch to short keys if the margin gets tight.

## 6. Ingest pipeline (write path)

New script `scripts/push-history-to-d1.ts`:

1. Reads `data/prices-baseline.json` (produced by existing `fetch-and-build-data.ts`)
2. For each record, produces an SQL `INSERT OR REPLACE` statement with today's UTC date
3. Batches into ~200 statements per `wrangler d1 execute` call (D1's HTTP API has statement count limits)
4. Logs row-insert counts and failure counts

The nightly `build.yml` workflow gains one step after the existing build step (before the Pages upload):

```yaml
- name: Push today's snapshot to D1
  run: npm run push-history-to-d1
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

**Failure handling:** if the D1 push fails, the workflow logs the error but does NOT fail the build — the site still deploys with whatever historical data was already baked in. Missing a day's snapshot is annoying, not catastrophic.

## 7. Build-time read (sparkline + volatility)

New script `scripts/pull-history-from-worker.ts`:

1. HTTP GETs two endpoints in parallel:
   - `https://<worker>.workers.dev/sparkline-dump?days=30` — 30 days of daily snapshots per card
   - `https://<worker>.workers.dev/range-dump?days=90` — 90-day low/high/latest per card (pre-aggregated)
2. Validates both response shapes with Zod
3. Writes to two local files (gitignored):
   - `data/sparkline-snapshot.json`
   - `data/range-snapshot.json`

The Astro build extends `src/pages/card/[id].astro` to:

1. Load `data/sparkline-snapshot.json` and `data/range-snapshot.json` alongside `cards.json`
2. For each card, look up its history array (may be empty) and range stats (may be absent)
3. Compute volatility (§8) from the sparkline array
4. Pass sparkline points, volatility, and range stats to `<PriceTile>` as props

**If the Worker endpoint is unreachable during build:** the build script falls back to empty data for the affected endpoint. Sparkline disappears (tile reverts to v2.0's 4-point chart from Cardmarket's built-in averages); range panel shows a "no history yet" state. Not a build-killer. Log loud warning. Both endpoints fail independently — losing one doesn't affect the other.

## 8. Volatility calculation

Pure function `src/data/volatility.ts`:

```ts
type VolatilityBucket = 'stable' | 'moderate' | 'volatile' | 'unknown';

export function computeVolatility(trendSeries: number[]): {
  bucket: VolatilityBucket;
  coefficient: number | null;  // σ/μ, or null if insufficient data
} {
  if (trendSeries.length < 7) return { bucket: 'unknown', coefficient: null };
  const mean = trendSeries.reduce((a, b) => a + b, 0) / trendSeries.length;
  if (mean === 0) return { bucket: 'unknown', coefficient: null };
  const variance = trendSeries.reduce((acc, v) => acc + (v - mean) ** 2, 0) / trendSeries.length;
  const stddev = Math.sqrt(variance);
  const coefficient = stddev / mean;
  if (coefficient < 0.03) return { bucket: 'stable', coefficient };
  if (coefficient < 0.10) return { bucket: 'moderate', coefficient };
  return { bucket: 'volatile', coefficient };
}
```

- **Insufficient data** (<7 points) renders no pill — don't guess on a day-5 card.
- **Buckets:** Stable (σ/μ < 3%), Moderate (3-10%), Volatile (>10%). Thresholds chosen by eyeball against typical Pokémon card behavior; can be tuned as we accumulate real data.

## 9. Currency layer

### 9.1 Exchange rates

New script `scripts/fetch-exchange-rates.ts`:

- Hits `https://api.frankfurter.app/latest?from=EUR&to=USD,GBP,JPY`
- Writes `data/exchange-rates.json`:

```json
{
  "base": "EUR",
  "date": "2026-04-19",
  "rates": { "USD": 1.0754, "GBP": 0.8581, "JPY": 162.38 }
}
```

- Runs as part of the nightly workflow before the Astro build.
- Frankfurter is an ECB wrapper; no auth, no rate limits. If it's down, we fall back to the previously committed rates (same date means same-currency display, just stale by one day).

### 9.2 Supported currencies

v2.1 supports **EUR, USD, GBP, JPY**. Adding more is a one-line change in `scripts/fetch-exchange-rates.ts` and the `CURRENCIES` array in `src/data/currency.ts`.

### 9.3 Build-time price multiplication

Every price number rendered on a card page is emitted with data attributes for every supported currency:

```html
<span class="price" data-eur="359.17" data-usd="386.40" data-gbp="308.22" data-jpy="58349">€359.17</span>
```

- Default visible text is in the user's preferred currency (from `<CurrencySelect>`).
- No runtime conversion — just DOM mutation to swap which data attribute is shown.
- Works with JS disabled (visitor sees the default currency).

### 9.4 `<CurrencySelect>` Preact island

Lives in `src/components/CurrencySelect.tsx`, imported by `src/layouts/Base.astro` so it appears on every page:

- Reads initial currency from `localStorage.getItem('currency')`; falls back to `Intl.NumberFormat().resolvedOptions()` locale match; fallback-fallback is `EUR`.
- Renders a small `<select>` styled to match the header.
- On change: writes `localStorage`, dispatches a `currencychange` custom event, and updates all `.price` elements on the page.
- JS cost: one tiny Preact island loaded with `client:load` (since we need the initial DOM update to happen immediately).

### 9.5 History in the selected currency

Historical sparkline values are ALSO multiplied at build time. Simplification: apply the CURRENT exchange rate to every historical point. Not perfectly accurate for a year-old data point, but the sparkline's shape is what matters, not exact historical conversions. A v2.2 refinement could use per-day exchange rates.

## 10. UI changes

### 10.1 `src/layouts/Base.astro`

Adds a slim header strip above `<main>`:

```
[Logo / title ...................................... Currency: USD $ ▼]
```

The existing Disclaimer footer stays unchanged. The header strip is ~40 px tall, light-cream background to match the collector palette.

### 10.2 `src/components/PriceTile.astro`

Two-column layout remains. Left column (Cardmarket live tile) gains:

- **Volatility pill** next to the LIVE badge (green Stable / amber Moderate / red Volatile)
- **Real 30-point sparkline** — `PriceChart.tsx` is updated to accept a variable number of points; v2.0's 4-point case still works as a degenerate input
- **σ/μ annotation** in the footer next to "vs 30d avg" ("σ/μ 6.2% · 30d")

Right column (previously dashed eBay placeholder) becomes the **90-day range panel** (`src/components/RangePanel.astro`):

- Low, high, range ($ delta between), % from low
- Range bar with a "now" marker — two-color gradient for the realized-range portion, grey for the out-of-range space above/below
- Footer line: "History from Cloudflare D1 · seeded with Cardmarket 30d/7d/1d on day 1"

### 10.3 `src/components/PriceChart.tsx`

Chart.js line chart extends gracefully from 4 points to 30+. No new configuration needed — pass `points: Array<{ label, value }>` with any length. The default 30-point case hides x-axis labels; the v2.0 4-point degenerate case still labels "30d / 7d / 1d / now" explicitly.

## 11. Day-1 bootstrap

D1 starts empty. A brand-new card page can't show a sparkline without fabricating something. Strategy:

**Before the first nightly, run a one-time `npm run bootstrap-d1-history` locally** that:

1. Reads `data/prices-baseline.json` (EN catalog with Cardmarket data)
2. For each card with `pricing.cardmarket`, emits three rows:
   - `date = today - 30`, values = `{ trend: avg30, low, avg30, avg7, avg1 }` (seed with what Cardmarket tells us was the 30-day average)
   - `date = today - 7`, values = `{ trend: avg7, ... }`
   - `date = today - 1`, values = `{ trend: avg1, ... }`
3. Also inserts today's real snapshot
4. Pushes via wrangler CLI in one batch

Result: every card has 4 data points on day 1 — matching v2.0's existing 4-point display. Real daily data fills in between those points as nightly runs accumulate.

The bootstrap script is **idempotent** (`INSERT OR REPLACE`) and can be re-run safely.

## 12. Error handling

| Situation | Behavior |
| --- | --- |
| D1 push fails during nightly | Log, continue. Site deploys with existing history. |
| Worker `/sparkline-dump` times out or returns an error | Fall back to empty sparkline data. Tile renders without the 30-point line; range panel unaffected if its endpoint responded. Log loud warning. |
| Worker `/range-dump` times out or returns an error | Fall back to empty range data. Range panel shows "no history yet" placeholder; sparkline unaffected. Log loud warning. |
| Frankfurter API down | Use the previously committed `data/exchange-rates.json`. Log a warning — only affects currency switching for new rate movements. |
| Card has <7 history points | Volatility pill not rendered (insufficient data). Sparkline shows whatever points exist. |
| Worker is returning malformed JSON | Zod validation fails during build → build fails loud. Previous deployment stays live. |
| `CLOUDFLARE_API_TOKEN` secret missing in CI | The D1 push step fails; the rest of the build continues. Site deploys without today's snapshot. |
| User's browser has no localStorage (rare) | Currency selector falls back to in-memory state; resets to default on each page load. |
| User picks a currency not in exchange-rates.json (shouldn't happen but defensive) | Selector is constrained to the supported set, so this can't occur. |

## 13. Testing

| Level | Test |
| --- | --- |
| Unit (`tests/unit/volatility.test.ts`) | Stable, moderate, volatile buckets; insufficient-data null; zero-mean null. |
| Unit (`tests/unit/currency.test.ts`) | Multiply against mock exchange rates; round to appropriate decimals per currency (0 for JPY, 2 for others); format with glyph. |
| Unit (`tests/unit/history-merge.test.ts`) | Given mock history + mock prices-fresh, emits correct data attributes. |
| E2E (`tests/e2e/price-tile.spec.ts`) | Existing tests still pass. Add: volatility pill appears for a fixture card with 30+ synthetic history rows; range panel min/max/now-marker render; currency switcher affects visible price across all tiles. |
| E2E (`tests/e2e/currency-switch.spec.ts`) | Click currency → all prices update; localStorage persists across reload. |
| Worker smoke | `curl` the deployed Worker endpoints after first deploy — `/history/:cardId` returns expected shape, `/history-dump` returns >1000 records. |
| D1 quota sanity | After first week of nightly runs, check D1 stats — should be ~7 × 23k = 161k rows, well under 5GB. |

## 14. Key decisions log

- **D1 over KV/R2** — time-series with SQL-native `ORDER BY date DESC LIMIT N` beats rewriting JSON blobs on KV, and avoids manual aggregation in Worker code for R2.
- **Public read Worker, no auth** — simpler ops. Data is non-sensitive (prices are public information). If Worker quota becomes a concern, we can gate later.
- **Wrangler CLI from CI for writes** — no need for a Worker write endpoint; CI already handles auth. Writes are batched, idempotent via INSERT OR REPLACE.
- **Unbounded retention** — D1 is cheap; years of history is a small cost. v2.2+ can consider cold-storage archival if ever needed.
- **Exchange rates via Frankfurter → committed JSON** — keeps the static-site promise intact; visitors don't hit a currency API.
- **Build-time currency multiplication** — every price node carries data-eur/data-usd/data-gbp/data-jpy. Currency switcher is a DOM mutation, no runtime math.
- **Current exchange rate applied to historical points** — simplification; v2.2 could use per-day rates if accuracy matters.
- **Volatility thresholds 3%/10%** — eyeball-picked; tune with real data.
- **Day-1 bootstrap with three synthetic points from Cardmarket averages** — gives instant-useful sparklines without waiting 30 days of real accumulation. Flagged as synthetic in the disclosure line.
- **Retire the dashed eBay placeholder** — honest: v2.1 isn't eBay anymore, so pretending a placeholder still promises it is misleading. The 90-day range panel fills the space with something that's actually real.
- **Frankfurter over ECB XML directly** — JSON is easier than XML parsing in our Node build. Frankfurter is a thin, free, reliable wrapper.

## 15. Open questions

None at the time of approval. Unknowns surfaced during implementation go in a separate doc.
