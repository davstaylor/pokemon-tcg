# Pokémon TCG Prices — v2.0 Design

**Date:** 2026-04-19
**Status:** Approved (brainstorming → implementation-ready)
**Scope:** v2.0 only — single-source (Cardmarket via TCGdex) price display. eBay is explicitly deferred to v2.1, time-series history to v2.2.

**Builds on:** [v1 catalog spec](2026-04-18-pokemon-tcg-catalog-design.md). v1's `CardIdentity` schema and card pages remain unchanged structurally; v2.0 adds a new `PriceTile` component below the existing `PrintGallery` and a new build-time data pipeline for prices.

## 1. Vision

Turn the v1 catalog into a live-feeling market reference. A card page should communicate not just "this card exists in 11 languages" but also "it's trading at €359 right now, down 12% from its 30-day average." The UX must imply, even at v2.0's single-source stage, that deeper analytics are coming — so visitors read the tile and understand it as "live data" rather than "encyclopedic trivia."

## 2. Milestone decomposition

| Milestone | Scope |
| --- | --- |
| **v2.0 — this spec** | Single-source Cardmarket via TCGdex. Price tile on every card where Cardmarket data exists. "Tracked scope" = hot set(s) polled every 5 minutes; every other card refreshed nightly. chart.js mini-line showing 30d→7d→1d→trend momentum. Single-source delta (trend vs 30d avg). Dashed placeholder reserving v2.1's eBay slot. |
| **v2.1 (future)** | Add eBay completed-listings (Finding/Browse API) as a second source. Populate the placeholder. Single-source delta becomes a cross-source delta ("Cardmarket vs eBay") and surfaces regional-arbitrage signals. |
| **v2.2 (future)** | Time-series history store. Real sparklines (30+ data points, not 4). Divergence/convergence plots between sources. Volatility indicators. |

Each milestone ships as its own spec + plan. v2.0 is deliberately the smallest useful step that proves the polling/deploy cycle and produces a visible upgrade over v1.

## 3. Architecture

Two workflows, one trust boundary (TCGdex API → our repo → GitHub Pages).

```
                 Nightly workflow (02:00 UTC — existing from v1, extended)
                           │
                           ▼
                 scripts/fetch-and-build-data.ts
                 (one pass: fetches each card, writes both files)
                           │
                           ├── data/cards.json              (v1, unchanged)
                           └── data/prices-baseline.json   (new)
                                      │
                                      ▼
                             Astro build + Pagefind + deploy

                 Fast-poll workflow (every 5 min — NEW)
                           │
                           ▼
                 scripts/fetch-prices-fresh.ts
                 (polls only tracked-sets.yaml cards)
                           │
                           ▼
                 data/prices-fresh.json (partial, tracked-scope only)
                           │
                           ▼
                 Commit on main → Pages auto-redeploys within ~1 min
```

**File contracts:**
- `prices-baseline.json` contains one `CardPriceRecord` per card with any `pricing.cardmarket` data (~93% of the catalog per our probes). Updated nightly. Source of truth for any card outside the tracked scope.
- `prices-fresh.json` contains records only for cards in the tracked scope. Updated every 5 minutes. Source of truth for those cards.
- **Merge precedence at build time:** `prices-fresh` wins for any card whose id appears in it; `prices-baseline` is the fallback. A card absent from both files gets no PriceTile.
- **Both files keyed by `cardId`** with identical `CardPriceRecord` shape, so merging is a trivial `{ ...baseline, ...fresh }`.

**Rationale for two files (rather than one updated by both workflows):** separation of concerns — each workflow owns its own file, so commit conflicts between the nightly and the fast-poll are impossible by construction.

**Why the nightly produces prices too (not a separate job):** the nightly already fetches every `/cards/{id}` to build `cards.json`, and the pricing block is free data on those responses. Running a separate "baseline prices" job would duplicate every request.

**The v1 build script at `scripts/fetch-and-build-data.ts` is extended, not rewritten:** the normalise step gains an additional output stream that extracts `pricing.cardmarket` into `CardPriceRecord` shape and writes it to `data/prices-baseline.json`. The existing `data/cards.json` output is unchanged.

## 4. Schema

New file: `src/data/price-schema.ts`. This sits alongside the existing v1 `src/data/schema.ts` and is imported independently.

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
  updatedAt: z.string(),  // ISO 8601
});
export type CardMarketPrice = z.infer<typeof CardMarketPriceSchema>;

export const CardPriceRecordSchema = z.object({
  cardId: z.string(),
  sources: z
    .object({
      cardmarket: CardMarketPriceSchema.optional(),
      // v2.1: ebay: EbayPriceSchema.optional()
    })
    .strict()
    .refine((sources) => Object.keys(sources).length > 0, {
      message: 'A price record must have at least one source',
    }),
});
export type CardPriceRecord = z.infer<typeof CardPriceRecordSchema>;

export const PriceFileSchema = z.object({
  generatedAt: z.string(),  // ISO 8601 — when the workflow ran
  records: z.record(z.string(), CardPriceRecordSchema),  // keyed by cardId
});
export type PriceFile = z.infer<typeof PriceFileSchema>;
```

Per-card keyed, multi-source-ready from day one. The `sources` map is `{ cardmarket: {...} }` in v2.0 and becomes `{ cardmarket: {...}, ebay: {...} }` in v2.1 without a migration — adding an optional key to a `.strict()` object is backward-compatible.

**Holo variants.** Cardmarket's API exposes both non-holo and holo price points on the same card record (`avg`, `avg-holo`, `trend`, `trend-holo`, etc.). v2.0 uses the non-holo values only. Exposing the holo variant is a v2.1 concern and will most likely be modelled as a second logical source `{ source: 'cardmarket', variant: 'holo' }` rather than a flag inside one record.

## 5. Tracked scope

**Location:** `tracked-sets.yaml` at repo root. Initial content (v2.0):

```yaml
tracked:
  # Set IDs fast-polled every 5 minutes. Cards in these sets get a LIVE badge.
  # Every card in the catalog still has baseline prices from the nightly build.
  # Growth path: add more set IDs as coverage scales. Eventually holds every id.
  - base1   # Base Set (1999) — vintage scarcity, high price volatility makes the tile meaningful
```

**Fast-poll workflow** reads this file, enumerates the cards in those sets, and fetches each card's pricing. Cardmarket's `updated` timestamp becomes our `updatedAt`.

**Growth path.** Adding a set to the yaml is a one-line PR. Eventually contains every set ID; at that point the mechanism is unchanged — the workflow just polls every card. If the full-catalog poll at 5-minute cadence ever exceeds TCGdex's rate limits, we add a `tier` field to the yaml (`fast: [...]`, `warm: [...]`, `cold: [...]`) and run three separate workflows at 5 / 30 / 1440-minute cadences. Not needed in v2.0.

## 6. UI

### 6.1 PriceTile component

New component: `src/components/PriceTile.astro` with a Preact island inside for the chart. Structure mirrors the approved mockup:

```
┌──────────────────────────────────┬──────────────────────────────────┐
│ CARDMARKET            ● LIVE     │ EBAY · COMPLETED SALES           │
│ €359.17                          │ — —                              │
│ trend price                      │ latest sale (USD)                │
│                                  │                                  │
│ [chart.js mini-line: 30/7/1/now] │                                  │
│  30d €409  7d €324  1d €362  €359│ awaiting v2.1 integration        │
│                                  │                                  │
│ ─────────────────────────        │ ──────────────────────────       │
│ vs 30d avg                       │ Cross-source delta, regional    │
│ ▼ €50 · -12.3%    updated 10h ago│ arbitrage signals, time-series  │
│                   TCGdex →       │ plot here once live.            │
│                   Cardmarket     │                                  │
└──────────────────────────────────┴──────────────────────────────────┘
```

Rendered in grid on desktop (two columns), stacked on mobile.

### 6.2 chart.js integration

- chart.js loaded as a **lazy client island**, hydration boundary `client:visible`. No JS cost on card pages that don't render a PriceTile, and no JS cost until the tile scrolls into view.
- v2.0 chart is a 4-point line: `[30d avg, 7d avg, 1d avg, current trend]`. Tooltip on hover.
- Chart theming matches the collector palette (accent `#c86f3d`, ink `#3b2a1a`, muted `#7a5e3a`).
- In v2.2 the same component renders a 30+-point real sparkline from stored history. No API change from v2.0 — chart.js `data` array just grows.

### 6.3 Freshness badge

Computed at page-render time from `updatedAt`:

| Age | Badge |
| --- | --- |
| `< 30 min` | `● LIVE` (green) |
| `30 min – 48 h` | `updated Nh ago` (muted) |
| `> 48 h` | `updated Nd ago` (muted) + warning-bordered tile |

### 6.4 Placement

- Card page layout becomes: `h1` → `PrintGallery` → `PriceTile` (if pricing exists) → metadata panel → footer disclaimer.
- Cards without any `pricing.cardmarket` data: `PriceTile` is not rendered at all (no placeholder, no "no price data" message).
- Cards with pricing but outside tracked scope: tile still renders, just shows a stale-timestamp badge rather than `● LIVE`.
- eBay dashed-placeholder sub-tile is rendered whenever the live Cardmarket tile is rendered — it's a forward-looking design promise, not gated on data.

### 6.5 Home page

Out of scope for v2.0. The home page remains as built in v1. "Hot cards this week" modules and similar are a v2.2 concern (requires history to know what "hot" means).

## 7. Error handling

| Situation | Behavior |
| --- | --- |
| Per-card TCGdex fetch fails during fast poll | Log and skip that card; keep last-known price in the JSON. If failure rate for the whole batch exceeds 50%, fail workflow loudly. |
| `tracked-sets.yaml` references a set ID that doesn't exist at TCGdex | Workflow fails loudly on startup; misconfiguration should be noisy. |
| `pricing.cardmarket` missing for a tracked card | No tile rendered; card page otherwise unchanged. |
| Two workflow runs overlap and race to commit | `concurrency: price-update` group in the workflow YAML serialises them. |
| Currency unit unexpected (e.g., TCGdex changes Cardmarket away from EUR) | Zod validation fails; workflow fails loudly; previous `prices-fresh.json` stays live. |
| chart.js fails to load on client | Tile still renders the numeric values and delta; only the chart itself is absent. Graceful degradation. |
| Delta calculation when `avg30` is null | Show the price; hide the delta row (not render a "— —" placeholder). |

## 8. Testing

| Level | Test |
| --- | --- |
| Unit (`tests/unit/price-schema.test.ts`) | `CardMarketPriceSchema` parses valid, rejects wrong types, rejects unknown `source`. `PriceFileSchema` rejects records with no sources. |
| Unit (`tests/unit/price-merge.test.ts`) | Merge logic: when `prices-fresh.json` has card X, it wins over `prices-baseline.json`. When not, baseline is used. Respects schema on both sides. |
| Unit (`tests/unit/price-delta.test.ts`) | `trend - avg30 = delta`. Handles null gracefully. Percentage = delta/avg30 × 100, rounded to one decimal. |
| Unit (`tests/unit/freshness.test.ts`) | Badge is LIVE at 29m, "1h ago" at 1h1m, "2d ago" at 48h+, warning-bordered at 72h+. |
| E2E (`tests/e2e/price-tile.spec.ts`) | Card in tracked scope renders tile with LIVE badge, chart.js canvas, correct delta. Card without Cardmarket data renders no tile. Card with stale data renders tile with "Nh ago" badge. Home page does NOT load chart.js bundle. |
| CI dry-run | A `validate-config` job that parses `tracked-sets.yaml`, verifies every set ID resolves at TCGdex, and fails the PR if not. Prevents typos from reaching production. |

## 9. Disclaimers (carried from v1, extended)

Footer remains as in v1. Card-page data panel adds:

> Prices via Cardmarket (aggregated by TCGdex). Trend and rolling averages are Cardmarket's published values; no sale is guaranteed at the displayed price. Last updated: `[ISO timestamp]`.

## 10. Key decisions log

- **Two workflows, not one** — separating fast-poll from the full catalog rebuild lets us tune them independently. The 5-min job is tiny and cheap; the nightly job is unchanged from v1. Also means a bug in one doesn't break the other.
- **Two JSON files (`prices-baseline.json`, `prices-fresh.json`)** — one per workflow. Avoids commit-race pain, makes debugging trivial ("which workflow produced this value?").
- **chart.js over uPlot, μPlot, or hand-rolled SVG** — user asked for chart.js directly. The ~60 KB gzipped cost is acceptable when the library is lazy-loaded on pages with prices, and it earns its keep once v2.2 brings real time-series and hover tooltips.
- **yaml-configurable tracked scope** — keeps v2.0 shippable today with a single-set scope, scales to every set without code changes. Flexible without infrastructure.
- **Store prices in the repo on main** — simpler than a dedicated data branch for v2.0. Commit noise is ~288 commits/day at 5-min cadence; tolerable. Move to a data branch if/when this actually becomes annoying in practice.
- **Reserved eBay slot in UI from day one** — communicates the roadmap to visitors, makes v2.1 a data-layer change rather than a redesign.
- **EUR displayed natively** — Cardmarket is EUR. Conversion to USD/GBP requires a second data source (exchange rates) and is a v2.2 concern.
- **v2.0 single-source delta is trend-vs-avg30** — the one insight we can extract from a single source. Clear semantic ("is the card above or below its monthly average?"). Replaced by cross-source delta in v2.1.
- **chart.js data in v2.0 is only 4 points** — until v2.2 stores history, those are the only time-dimensioned data points Cardmarket gives us. Acknowledge rather than fabricate.

## 11. Open questions

None at the time of approval. Unknowns surfaced during implementation go in a separate doc rather than mutating this spec.
