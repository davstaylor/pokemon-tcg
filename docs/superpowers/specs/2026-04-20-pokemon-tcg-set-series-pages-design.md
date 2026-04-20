# Set & Series Pages — Design

**Date:** 2026-04-20
**Status:** Approved (brainstorming → implementation-ready)
**Scope:** Add set-level and series-level browse pages. No new data fetches; no schema changes; purely a view layer on top of existing `data/cards.json`. Adds Astro's sitemap integration so Google can index the now-browsable catalog.

**Builds on:** v1 catalog (`CardIdentity` schema with `filters.setId`, `filters.setName`, `filters.series`; each `PrintData` carries `setName` and `setSymbol`). No dependency on v2.0 / v2.1 pricing data.

## 1. Problem & goal

The site has 23,158 card pages and a search facet for "Set" — but **zero ways to browse by set**. A user who wants to see every Base Set card has to search "base" and scroll, or jump to a specific card and have no navigation back to the set. This spec fills that gap with three new route families:

- `/set/[setId]/` — grid of every card in a set
- `/series/[seriesId]/` — chronological list of sets within a series
- `/sets/` — a single index page listing every series

This also gives Google 150+ new indexable landing pages (meaningful URLs + unique titles + Open Graph).

## 2. Architecture

No new data sources, no new storage. Pure Astro static-site generation using the existing `data/cards.json`.

```
data/cards.json (existing, 23k CardIdentity records)
   │
   ├─ group by filters.setId       →  /set/[setId]/index.html    (per set)
   ├─ group by filters.series      →  /series/[seriesId]/index.html (per series)
   └─ distinct series              →  /sets/index.html            (series index)
```

All three route families use Astro's `getStaticPaths()` to iterate the grouped data at build time. Total new static pages: ~150 set + ~15 series + 1 sets-index ≈ **~170 pages**, adding ~2 MB to the artifact.

## 3. File structure

```
src/pages/
├── set/
│   └── [setId].astro          # NEW — one page per set (grid of cards)
├── series/
│   └── [seriesId].astro       # NEW — one page per series (list of sets)
├── sets/
│   └── index.astro            # NEW — index of all series
└── card/[id].astro             # modified — set line becomes a link

src/components/
└── SetHeader.astro            # NEW — shared header for set pages (logo, name, release date, count)
```

Reuses existing `CardTile.astro` for the per-set grid. No new global components.

## 4. Set page (`/set/[setId]/`)

### Structure

```
┌─────────────────────────────────────────────────────────┐
│ ← Base Set series                                       │  ← breadcrumb → /series/base/
│                                                         │
│  [symbol]  Base Set                                    │  ← SetHeader
│             102 cards · released 1999-01-09             │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [card] [card] [card] [card] [card] [card]             │
│  [card] [card] [card] [card] [card] [card]             │  ← existing CardTile grid
│  [card] [card] [card] ...                               │
└─────────────────────────────────────────────────────────┘
```

### Sorting

By collector number ascending, with **numeric sort**: "2" before "10" before "100". TCGdex's `localId` is sometimes a pure integer string ("4"), sometimes contains letters ("SWSH01", "H1", "TG1"). Sort function:

```ts
function compareLocalIds(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  const aNumeric = Number.isFinite(na) && String(na) === a;
  const bNumeric = Number.isFinite(nb) && String(nb) === b;
  if (aNumeric && bNumeric) return na - nb;       // both numeric
  if (aNumeric) return -1;                        // numeric before alpha
  if (bNumeric) return 1;
  return a.localeCompare(b);                      // both alpha
}
```

### Data lookup

At `getStaticPaths()`-time, group `cards.json` by `filters.setId`. Each set page receives:

```ts
{
  setId: 'base1',
  setName: 'Base Set',
  setSymbol: 'https://assets.tcgdex.net/en/base/base1/symbol.png',
  seriesId: 'base',
  seriesName: 'Base',
  releaseDate: '1999-01-09',
  cards: CardIdentity[]   // all cards in set, pre-sorted by localId
}
```

`setSymbol` and `releaseDate` are pulled from the EN print of the first card in the set. If no EN print exists (rare for older/exclusive sets), fall back to the first available language's print.

### Series name resolution

`CardIdentity.filters.series` stores the **series ID** (e.g. `swsh`, `base`, `sv`) — derived from the set ID prefix by `deriveSeriesId()` in `normalise.ts`. TCGdex's live API doesn't expose a human series name (the `set.serie` field is absent in card-detail responses, only present in fixture data).

To display a human-readable series label, use the **earliest-released set's `setName` verbatim** as the series name. This works because, for every major series in the TCGdex catalog, the first set is named after the series itself:

| Series ID | Earliest set (→ series display name) |
| --- | --- |
| `swsh` | Sword & Shield |
| `sv` | Scarlet & Violet |
| `sm` | Sun & Moon |
| `base` | Base Set |
| `neo` | Neo Genesis |

Slightly verbose older-series labels (e.g. "Base Set" for the Base series) are acceptable — the series ID is unambiguous, the display name is an aesthetic concern only. The derivation is a pure function of the grouped card data; no lookup tables or manual overrides.

### SEO

- `<title>{setName} — Pokémon TCG Catalog</title>`
- `<meta name="description" content="All {N} cards from {setName}, released {date}. {Series} series.">`
- `<link rel="canonical" href="https://davstaylor.github.io/pokemon-tcg/set/{setId}/">`
- Open Graph: `og:title`, `og:description`, `og:image` (the set symbol URL)

## 5. Series page (`/series/[seriesId]/`)

### Structure

```
┌───────────────────────────────────────────────┐
│  Sword & Shield                               │  ← title
│  12 sets in this series                       │
├───────────────────────────────────────────────┤
│  [symbol] Sword & Shield                      │
│           202 cards · 2020-02-07    →          │
│                                               │
│  [symbol] Rebel Clash                         │
│           192 cards · 2020-05-01    →          │
│                                               │
│  [symbol] Darkness Ablaze                     │
│           189 cards · 2020-08-14    →          │
│                                               │
│  ... newest first                             │
└───────────────────────────────────────────────┘
```

No per-card grid at series level — that's what set pages are for. Keeps series pages scannable.

### Data lookup

Group cards by `filters.series`, then within each series, sub-group by `filters.setId` to produce a list of set summaries. Sort sets newest-first by release date.

### SEO

Mirrors set pages: unique title, description, canonical, OG image (the series's most-recent set symbol).

## 6. Sets index (`/sets/`)

Single page listing every series as a clickable tile:

```
┌──────────────────┬──────────────────┬──────────────────┐
│ Scarlet & Violet │ Sword & Shield   │ Sun & Moon       │
│ 10 sets          │ 12 sets          │ 11 sets          │
├──────────────────┼──────────────────┼──────────────────┤
│ Black & White    │ HeartGold/SS     │ Diamond & Pearl  │
│ ...              │ ...              │ ...              │
└──────────────────┴──────────────────┴──────────────────┘
```

Each tile links to `/series/[seriesId]/`. Ordered newest-first.

## 7. Integration with existing pages

### Card detail page (`src/pages/card/[id].astro`)

The existing aside line:

```astro
<p>Set: {card.filters.setName} <span style="...">({card.filters.setId})</span></p>
```

becomes:

```astro
<p>Set: <a href={`/pokemon-tcg/set/${card.filters.setId}/`}>{card.filters.setName}</a>
   <span style="color:#7a5e3a;font-size:0.8rem">({card.filters.setId})</span></p>
```

Single-link change; no other card-page modifications.

### Home page (`src/pages/index.astro`)

Add a small link at the bottom of the featured-cards section:

```astro
<div style="margin-top:2rem;text-align:center;">
  <a href="/pokemon-tcg/sets/">Browse all sets →</a>
</div>
```

Keeps navigation discoverable without adding site-header chrome.

## 8. Sitemap + Open Graph

Add `@astrojs/sitemap` as a dev dependency and integration. It auto-generates `/sitemap-index.xml` and `/sitemap-0.xml` at build time covering every static page. Points at `https://davstaylor.github.io/pokemon-tcg/` via the `site` config we already have.

Open Graph tags — add to `Base.astro` layout so every page gets them, falling back to the default catalog OG image for pages that don't specify.

## 9. Error handling

| Situation | Behavior |
| --- | --- |
| A `setId` referenced in `cards.json` has zero matching cards | Not possible — set IDs come from cards. |
| A card has a `setId` but no `setName` populated | Fall back to displaying the ID as the name. (Normalise should never produce this state, but be defensive.) |
| A set's first card has no `setSymbol` | Omit the logo image; heading still shows just text. |
| Series page requested for a non-existent seriesId | Astro's default 404. |
| Sets index requested before any build has run | Not possible in CI (cards.json is always written by the existing pipeline). For local dev without `cards.json`, the existing `getStaticPaths` pattern throws — same behavior as the card-detail page. |

## 10. Testing

| Level | Test |
| --- | --- |
| Unit (`tests/unit/set-sorting.test.ts`) | `compareLocalIds` — numeric-before-alpha, numeric-to-numeric, letter-suffix cases, tied values. |
| E2E (`tests/e2e/set-pages.spec.ts`) | `/set/base1/` renders the SetHeader with name "Base Set", 2 card tiles (fixture has 2 base1 cards), and a series-breadcrumb link to `/series/base/`. `/series/base/` renders a list with at least one set tile linking to `/set/base1/`. `/sets/` renders at least one series tile. |
| E2E (existing, modified) | `card-page.spec.ts` — the Set link on base1-4 points to `/set/base1/` (was plain text). |

No new unit tests needed for data grouping — that's bare-bones JS array operations covered implicitly by the e2e tests.

## 11. Key decisions log

- **Three route families, not one** — `/set/[id]/` is the card-grid workhorse; `/series/[id]/` is navigation; `/sets/` is a top-level directory. Combining any two compromises the URL's semantic meaning and hurts SEO.
- **No search/filter on set pages** — the existing `/search?set=base1` facet already handles that. Duplication would split the UX without adding value.
- **Sort by `localId` numeric-aware** — collectors expect "1, 2, 3, ..., 100, 101", not "1, 10, 100, 11". Implementing numeric-aware sort is 8 lines; the expected-sort-order usability gain is substantial.
- **Sets index (`/sets/`) lists series, not sets** — listing all 150+ sets on one page is a wall. Listing 15 series, each linking to 10 sets on average, is scannable.
- **Newest-first ordering everywhere** — modern sets are what collectors care about. Old fans still get old sets via direct search or breadcrumbs.
- **`@astrojs/sitemap` over hand-written sitemap** — 170 new pages + 23k existing cards is 23,330+ URLs. Auto-generation from routes is safer than maintaining a hand-crafted list.
- **No new site-header nav** — one cross-link from home is enough discovery for now. Adding a nav dropdown is a separate UI decision that should wait until we've built more browse surfaces (e.g., Pokédex, artist pages).

## 12. Open questions

None at the time of approval. Any unknowns discovered during implementation go in a separate doc.
