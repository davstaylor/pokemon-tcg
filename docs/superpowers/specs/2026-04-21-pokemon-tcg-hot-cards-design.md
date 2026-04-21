# Hot Cards / Movers — Design

**Date:** 2026-04-21
**Status:** Approved (brainstorming → implementation-ready)
**Scope:** Add browse-by-movement browse pages. Three SSG routes plus a root redirect, all computed at build time from the existing `data/sparkline-snapshot.json` time series. Zero new data fetches, zero schema changes.

**Builds on:** v1 catalog, v2.1 D1 history (`sparkline-snapshot.json` gives 30 days of trend per card), set-pages feature (Open Graph + canonical tags in `Base.astro`, hardcoded `/pokemon-tcg/` URL convention, `getStaticPaths` pattern for browse routes).

## 1. Problem & goal

Collectors want a quick read on market movement: "what's climbing, what's crashing, which cards are seeing real money flow." The existing card pages answer "what is this card doing?" but not "what is the market doing?" This spec adds four ranked lists per time window — top % risers, top % fallers, top € gainers, top € losers — across three windows (24h / 7d / 30d).

Browse-style output (not search, not alert-style). Updated with every deploy; nightly is enough for v1.

## 2. Architecture

No new data sources, no new storage. Pure Astro SSG reading the existing sparkline dump and cards catalog.

```
data/cards.json              ─┐
data/sparkline-snapshot.json ─┼→  computeHotLists(cards, history, window)
                              ─┘     ↓
                                 getStaticPaths → /hot/[window]/index.html  × 3
                                                + /hot/index.html  (meta-refresh)
```

All computation happens at build time in `getStaticPaths`. Runtime page cost is a single Preact island (hover popup) that holds a static SVG element and swaps its data attributes on row hover. Zero build-time data fetches; zero client-side data fetches.

Total new static pages: **4** (three windows + one redirect root). Artifact size impact negligible.

## 3. Data pipeline

### New helper: `src/data/hot-cards.ts`

Pure-function module, no side effects, no fs access. Exports:

```ts
export type HotWindow = '24h' | '7d' | '30d';
export const HOT_WINDOWS: HotWindow[] = ['24h', '7d', '30d'];

// How many days of history to look back for each window.
// 24h ≈ 1 day; 7d = 7 days; 30d = 30 days.
export const WINDOW_DAYS: Record<HotWindow, number> = { '24h': 1, '7d': 7, '30d': 30 };

export interface HotRow {
  card: CardIdentity;
  currentEur: number;     // today's trend_eur (last snapshot)
  baselineEur: number;    // trend_eur at start of window
  deltaEur: number;       // currentEur - baselineEur
  deltaPct: number;       // deltaEur / baselineEur (as a decimal: 0.54 == +54%)
  history: number[];      // full 30-day series for the popup sparkline
}

export interface HotLists {
  pctRisers: HotRow[];    // top 10, sorted by deltaPct desc
  pctFallers: HotRow[];   // top 10, sorted by deltaPct asc (most-negative first)
  eurGainers: HotRow[];   // top 10, sorted by deltaEur desc
  eurLosers: HotRow[];    // top 10, sorted by deltaEur asc (most-negative first)
}

export function computeHotLists(
  cards: CardIdentity[],
  sparkline: SparklineDump,
  window: HotWindow,
): HotLists;
```

### Computation

For each card in `cards`:

1. Look up `sparkline.records[card.id]` (an array of `Snapshot { date, trend }`). Skip if absent or empty.
2. `currentEur = series[series.length - 1].trend`. Skip if null/zero.
3. **Baseline:** let `target = today - N days`. Find the most-recent snapshot whose date is **≤ `target`** (i.e. at least N days ago). `baselineEur` = that snapshot's trend. **If no snapshot has a date ≤ target, skip the card** — we don't have enough history to legitimately compute this window, and we don't fake it with a nearer snapshot.
4. Compute `deltaEur = currentEur - baselineEur`, `deltaPct = deltaEur / baselineEur` (guard against `baselineEur === 0` → skip).
5. Include in all four ranking passes, except: the two % lists apply an additional filter `baselineEur >= 1.0` to exclude penny-stock noise (a €0.05 → €0.20 card isn't a meaningful "+300%" signal).

**Worked example** (7-day window, today is Apr 21). Card A has snapshots on `[Apr 10, Apr 14, Apr 17, Apr 20, Apr 21]`. Target is Apr 14. The most recent snapshot `≤ Apr 14` is Apr 14 itself → baseline = Apr 14's trend. Change is `Apr21.trend − Apr14.trend`, labeled as "7d". Card B has snapshots on `[Apr 18, Apr 19, Apr 20, Apr 21]` only. Oldest is Apr 18, which is > Apr 14. No snapshot covers the target → Card B is skipped for the 7d window (but may still qualify for 24h).

Sort four times, `.slice(0, 10)`, return.

### Constants

- `HOT_LIST_SIZE = 10` (entries per section)
- `PCT_MIN_BASELINE_EUR = 1.0` (filter for % lists)

Exported from the module so tests and downstream code can reference them.

### Why not re-use `volatility.ts`?

Volatility is σ/μ over the window — a "how noisy" metric. Hot cards ranks by signed delta — a "what direction" metric. Different concept. Don't overload.

## 4. File structure

```
src/pages/
├── hot/
│   ├── [window].astro      # NEW — one page per window (24h, 7d, 30d)
│   └── index.astro         # NEW — minimal meta-refresh → /hot/7d/
└── index.astro             # modified — add "Hot cards →" link

src/components/
├── HotSection.astro        # NEW — one of the four sections (presentational)
└── HotHoverPopup.tsx       # NEW — single Preact island for the hover popup

src/data/
└── hot-cards.ts            # NEW — computeHotLists + types + constants

tests/unit/
└── hot-cards.test.ts       # NEW — ~6 cases covering filters + all four rankings

tests/e2e/
└── hot-pages.spec.ts       # NEW — 3 tests: sections render, popup appears, home link
```

No existing files grow significantly. `src/pages/index.astro` gets one extra link + CSS rule alongside the existing "Browse all sets →" from set-pages.

## 5. Page layout — `/hot/[window]/`

### Structure

```
┌────────────────────────────────────────────────────────────────┐
│ Hot cards — last 7 days                                         │
│ [ 24 hours ] [ 7 days (on) ] [ 30 days ]                        │
│                                                                 │
│ ┌──────────────────────────┐ ┌──────────────────────────┐       │
│ │ ▲ TOP % RISERS           │ │ ▲ TOP € GAINERS          │       │
│ │  1  Charizard UR  €65 +82%│ │  1  Moonbreon  €1200 +€298│       │
│ │  2  Umbreon VMAX  €520+54%│ │  2  Charizard UPC €850+€195│       │
│ │  …                        │ │  …                        │       │
│ └──────────────────────────┘ └──────────────────────────┘       │
│ ┌──────────────────────────┐ ┌──────────────────────────┐       │
│ │ ▼ TOP % FALLERS          │ │ ▼ TOP € LOSERS           │       │
│ │  1  Pikachu VMAX €18 −28% │ │  1  Gardevoir ex €220 −€68│       │
│ │  2  Mewtwo V Alt €45 −22% │ │  2  Giratina V Alt €340−€52│       │
│ │  …                        │ │  …                        │       │
│ └──────────────────────────┘ └──────────────────────────┘       │
└────────────────────────────────────────────────────────────────┘
```

Two-column grid (`repeat(auto-fit, minmax(420px, 1fr))`). Collapses to one column on narrow screens.

### Window tabs

Three anchors styled as pill tabs. The current window has `.on` / `aria-current="page"`. Non-current ones link to their counterparts:

```astro
<nav class="hot-tabs">
  {HOT_WINDOWS.map((w) => (
    <a href={`/pokemon-tcg/hot/${w}/`}
       class={w === current ? 'on' : ''}
       aria-current={w === current ? 'page' : undefined}>
      {w === '24h' ? '24 hours' : w === '7d' ? '7 days' : '30 days'}
    </a>
  ))}
</nav>
```

Three full page rebuilds rather than client-side tab switching keeps the route structure clean and every window is a real, indexable, shareable URL.

### Row DOM shape

```astro
<a class="hot-row" href={`/pokemon-tcg/card/${row.card.id}`}
   data-history={JSON.stringify(row.history)}
   data-card-name={row.card.defaultName}
   data-set-name={row.card.filters.setName}
   data-current={row.currentEur}
   data-delta-eur={row.deltaEur}
   data-delta-pct={row.deltaPct}
   data-image={pickThumbnailUrl(row.card) ?? ''}>
  <span class="rk">{rank}</span>
  <img class="th" src={pickThumbnailUrl(row.card) ?? ''} alt=""
       loading="lazy" onerror={ON_IMG_ERROR} />
  <span class="nm">
    <strong>{row.card.defaultName}</strong>
    <small>{row.card.filters.setName}</small>
  </span>
  <span class="pr">{formatEur(row.currentEur)}</span>
  <span class={`dl ${row.deltaEur >= 0 ? 'up' : 'dn'}`}>
    {metric === 'pct' ? formatPct(row.deltaPct) : formatEur(row.deltaEur, { signed: true })}
  </span>
</a>
```

Whole row is a `<a>` — clicking anywhere navigates. Hover triggers the popup. Data attributes carry everything the popup needs (no extra fetch, no lookup).

`pickThumbnailUrl(card)` is a trivial helper: return the first non-empty `imageURL` from the preferred-language prints (same order used elsewhere in the codebase).

## 6. Hover popup — `HotHoverPopup.tsx`

A single Preact island mounted once per page (inside `/hot/[window].astro`). Wire-up:

1. On mount, register `mouseenter` + `mouseleave` listeners on every `[data-card-id].hot-row`. Also handle `focusin` / `focusout` for keyboard users.
2. On `mouseenter`, read data attrs, position the popup to the right of the row (flip to left if there's not enough room), render the content with an inline SVG sparkline built from `data-history`, fade in (~80ms).
3. On `mouseleave`, fade out (~80ms).
4. On mobile (no hover), tap a row to toggle. Tap again anywhere else to dismiss. Tapping the same row still navigates to the card page (tap-through after toggle, not replace).

### Popup content

```
┌─────┬─────────────────────────────┐
│     │ Umbreon VMAX (Alt Art)      │
│     │ Evolving Skies · 215/203    │
│     │                             │
│ img │ €520         +€183 (+54%)   │
│     │                             │
│     │ ╭───────────────────╮       │
│     │ │    30-day trend   │       │
│     │ │  ~~~~_~~~~/̲̲~~     │       │
│     │ ╰───────────────────╯       │
│     │ Min €329  30 days  Max €520 │
│     │                             │
│     │ Click row to open card →    │
└─────┴─────────────────────────────┘
```

- **Left: 96px wide card image** — `data-image` URL. Same image-error fallback as `CardTile` (parchment placeholder becomes visible if image fails). If `data-image` is empty, placeholder only.
- **Right: info column**
  - Card name + set + collector number (from the card's filters).
  - Current price + delta in both € and %.
  - 30-day sparkline: inline `<svg>` with one `<polyline>` of up to 30 points, colored green if deltaEur ≥ 0, red otherwise. Min/max derived from `data-history`.
  - Click-through hint at the bottom.

### Single shared state

Only one popup can be visible at a time. Island holds refs to: the popup container, the image, the four text spans, and the SVG polyline. On `mouseenter`, mutate these in place — no React/Preact re-render per hover.

Inline SVG sparkline builder (no chart.js):

```ts
function buildSparkline(history: number[]): string {
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
```

SVG viewBox is `0 0 100 48`, preserveAspectRatio `none` so the line stretches to fill the container.

### Accessibility

- Each row is a native `<a>` so Tab reaches it; `focusin` shows the popup, `focusout` hides it.
- Popup has `role="tooltip"` and `aria-hidden` toggled with visibility.
- Mobile tap-to-toggle uses the same listeners — no pointer-event sniffing.

## 7. Windows & URL structure

| Path | Purpose |
| --- | --- |
| `/hot/` | Static page with `<meta http-equiv="refresh" content="0; url=/pokemon-tcg/hot/7d/">` + a visible link fallback for JS/meta-refresh-disabled clients. `<meta name="robots" content="noindex">` to avoid Google treating it as a duplicate. |
| `/hot/24h/` | Rankings over the last 1-day window. |
| `/hot/7d/` | Rankings over the last 7-day window (default). |
| `/hot/30d/` | Rankings over the last 30-day window. |

Paths are trailing-slashed to match existing routes (`/set/base1/`, `/series/base/`, `/sets/`).

## 8. SEO

For each window page:

- `<title>Hot cards — last {window label} — Pokémon TCG Catalog</title>`
- `<meta name="description" content="Top 10 risers, fallers, gainers and losers over the last {window label} in the Pokémon TCG catalog, updated daily.">`
- Canonical link + `og:title` + `og:description` + `og:type="website"` + `og:url` — all emitted by `Base.astro` already (set-pages Task 10 wired these globally).
- `og:image` not set for v1 (no single representative image for a "movers" page). Defer to portfolio or later polish.

`/hot/` root page sets `<meta name="robots" content="noindex">` so Google doesn't see the redirect shell.

## 9. Discovery

- `src/pages/index.astro` gets a second link next to "Browse all sets →":
  ```astro
  <div class="browse-links">
    <a href="/pokemon-tcg/sets/">Browse all sets →</a>
    <a href="/pokemon-tcg/hot/">See hot cards →</a>
  </div>
  ```
  The shared CSS class wraps both in a centred flex row.
- No card-page cross-link for v1 (every card links to every hot page would be noise for cold cards; reconsider if nav patterns ask for it).
- No site-header nav (consistent with set-pages; defer until there are 4+ browse surfaces).

## 10. Error handling

| Situation | Behavior |
| --- | --- |
| `sparkline-snapshot.json` missing entirely | Fall back to `emptySparkline` (same pattern as `card/[id].astro` frontmatter). All Hot pages render with empty sections. |
| Fewer than 10 qualifying cards for a window | Section renders whatever's available. No padding, no placeholder rows. |
| Zero qualifying cards (fresh deploy, no history yet) | Section body shows `<p class="empty">Not enough history yet — check back tomorrow.</p>`. One message per empty section, no global banner. |
| A card has a snapshot but `baselineEur === 0` | Skip — would divide by zero for %. Document in the helper's comment. |
| A card's image URL fails | Standard `ON_IMG_ERROR` removes the `<img>`; parchment placeholder remains (same convention as `CardTile` + `SetHeader`). |
| Window page requested for an undeclared window (e.g. `/hot/foo/`) | Astro's default 404 — `getStaticPaths` only emits the three declared windows. |

## 11. Testing

### Unit — `tests/unit/hot-cards.test.ts`

Synthetic `CardIdentity[]` + hand-built `SparklineDump`. ~6 cases:

1. `pctRisers` — correctly ranks by deltaPct desc, top 10 only.
2. `eurGainers` — correctly ranks by deltaEur desc, handles mixed positive/negative magnitudes.
3. `pctFallers` — negative deltas surface; tie-breaking stable.
4. Window-gap skip — a card with no snapshot at or before the baseline date is excluded from all four lists.
5. Price-floor filter — a card with `baselineEur = 0.80` (below €1) is excluded from % lists but still eligible for € lists if its delta is absolutely large enough.
6. Division-by-zero guard — a card with `baselineEur = 0` is skipped (no NaN, no Infinity).

Constants `HOT_LIST_SIZE` and `PCT_MIN_BASELINE_EUR` imported from the module so tests reference the same numbers the production code uses.

### E2E — `tests/e2e/hot-pages.spec.ts`

Fixture data needs extending: `data/fixtures/sample-cards.json` already has 2 cards. Add a `sparkline` block (or a new fixture file) with 30 synthetic snapshots for each, enough to put each card into at least one section. Coverage tests:

1. **`/hot/7d/` renders all four sections** — four `<section.hot-section>` blocks, correct headings ("Top % risers" / fallers / "Top € gainers" / losers), the `7 days` tab has `aria-current="page"`.
2. **Hovering a row shows the popup** — `page.hover('.hot-row:first-child')`, assert `.hot-popup` becomes visible, shows the correct card name, contains an `<svg>` with at least one `<polyline>`.
3. **Home page has a "See hot cards" link** pointing to `/pokemon-tcg/hot/`.

### No new integration tests for the redirect page

`meta http-equiv="refresh"` is covered by a DOM-only assertion in the home link test (curl `/hot/` → check the refresh tag content points at `/pokemon-tcg/hot/7d/`). Cheap; don't spin up a separate test.

## 12. Key decisions log

- **Three routes, not one with tabs** — each window is a real URL, indexable, shareable. Same reasoning as set vs. series vs. sets-index.
- **SSG all four ranked lists at build time** — the data is already local (`sparkline-snapshot.json`). Runtime recompute would need client-side JSON parsing of a ~2 MB dump. No value from being dynamic; the data only refreshes nightly anyway.
- **Single shared popup island rather than 40 per-row charts** — the popup only renders when hovered; one `<svg>` mutated in place costs nothing. Per-row chart.js islands would ship 40× the runtime and render cost for content 95% of users never look at.
- **Inline SVG sparkline instead of chart.js** — 30 points make a line; no tooltips, legends, axes needed. SVG is 20 lines of code, no dependency.
- **% floor is €1, € lists have no floor** — penny stocks dominate % by construction; € lists are self-filtering because a €0.50 card can't top an absolute-delta ranking.
- **10 rows per section** — 40 per page total. Enough to be interesting, not so much that a user has to scroll past hundreds of cards. Bump later if signal suggests the list is too short.
- **Meta-refresh for `/hot/` root** — GitHub Pages doesn't do redirects; meta-refresh + `noindex` is the standard static-host pattern.
- **No falls-per-se in € losers of low-priced cards** — if a €2 card drops 50%, that's only −€1; the ranking naturally deprioritises it. No additional filter needed on € losers.
- **No card-page backlink in v1** — most cards are never "hot" on any given day. A cross-link from every card to the hot page is noise. Revisit if home-page link isn't enough.

## 13. Open questions

None at the time of approval. Any unknowns discovered during implementation go in a separate doc.
