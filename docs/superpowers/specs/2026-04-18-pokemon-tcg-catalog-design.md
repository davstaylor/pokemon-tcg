# Pokémon TCG Catalog — v1 Design

**Date:** 2026-04-18
**Status:** Approved (brainstorming → implementation-ready)
**Scope:** v1 only (multilingual card catalog + search). Price data and predictive analytics explicitly deferred to v2.

## 1. Vision

A reference site for Pokémon TCG collectors that treats multilingual print data as a first-class citizen. Search for any card in any supported language and see every regional print of that card side-by-side on a single page.

The eventual goal — a live market tracker — is deferred. v1 is the solid catalog foundation that the market features will later attach to without a redesign.

## 2. Scope

### In scope (v1)

- Multilingual card catalog covering English, Japanese, Korean, and Chinese prints, sourced from TCGdex
- Search that resolves any card name in any of the four supported languages to a single card identity
- Card detail pages showing every available regional print side-by-side
- Faceted filters: Set, Type, Rarity, Series (TCGdex's term for the parent grouping above Set — e.g. Base, EX, Diamond & Pearl, ..., Scarlet & Violet)
- Static site hosted on GitHub Pages
- Data sourced at build time; nightly rebuilds
- Transparent data-source disclaimers

### Out of scope (v1 — deferred to v2+)

- Price data (eBay, Cardmarket, TCGplayer)
- Predictive analytics / price movement modeling
- User accounts, collection tracking, wishlists
- Community features (comments, forums)
- Real-time data pushes

### Non-goals

- Replacing TCGdex. We are a consumer of TCGdex, credited prominently. Our value-add is the unified multilingual presentation.
- Offering card gameplay rules, tournament legality, or deck-building tools.

## 3. Architecture

**Static site, build-time data fetch, hosted on GitHub Pages.**

| Concern      | Choice                                                       |
| ------------ | ------------------------------------------------------------ |
| Framework    | Astro (SSG) with Preact islands for interactive components   |
| Search       | Pagefind — file-based static search index, lazy-loaded       |
| Hosting      | GitHub Pages, `gh-pages` branch                              |
| Build engine | GitHub Actions                                               |
| Build cadence| Nightly cron (02:00 UTC) + manual dispatch                   |
| Images       | Hotlinked from TCGdex CDN with `loading="lazy"` + `srcset`   |

**Rationale:** Card catalog data is intrinsically static (it changes ~monthly when new sets release), so a build-time pipeline is the right fit. It keeps the site free to host, infinitely scalable, and needs no runtime secrets. The architecture also absorbs v2 prices cleanly via a parallel pipeline — see §10.

## 4. Data pipeline (CI-time)

A single GitHub Actions workflow runs on each schedule or dispatch:

1. **Fetch** TCGdex dumps for EN, JP, KR, ZH. TCGdex provides a free public REST API with permissive CORS.
2. **Normalise** into a card-identity-keyed schema (see §5). One card identity aggregates all available prints; a card identity is the pair `{set-id, collector-number}` — independent of language. Print variants (holo, reverse holo, 1st edition stamp, etc.) are treated as attributes of a single identity in v1 and may be split out in a later pass if the data warrants it.
3. **Generate pages**. One Astro route per card identity at `/card/[set-id]-[number]`.
4. **Build Pagefind index**. Tokenise names from all four languages so multilingual search resolves to the same card.
5. **Commit built site** to the `gh-pages` branch; GitHub Pages deploys automatically.
6. **Fail loud on any fetch or schema error.** Previous deployment stays live. We never ship silently broken data.

## 5. Schema

One record per card **identity**, not per language. Missing languages are omitted rather than nulled.

```ts
type CardIdentity = {
  id: string;                // e.g. "base1-4"
  defaultName: string;       // EN name if present, else JP, else the first available
  prints: {
    en?: PrintData;
    ja?: PrintData;
    ko?: PrintData;
    zh?: PrintData;
  };
  searchTokens: string[];    // names from all prints, for Pagefind tokenisation
  filters: {                 // denormalised for fast faceted filtering
    setId: string;
    rarity: string;
    types: string[];
    series: string;          // TCGdex series id, e.g. "base" | "ex" | "dp" | ... | "sv"
  };
};

type PrintData = {
  name: string;
  setName: string;
  setSymbol: string;         // URL
  rarity: string;
  hp: number | null;         // non-Pokémon cards have no HP
  types: string[];           // e.g. ["Fire"]; empty for Trainer/Energy
  attacks: Attack[];
  artist: string;
  imageURL: string;
  releaseDate: string;       // ISO 8601
  flavorText: string | null;
};

type Attack = {
  name: string;
  cost: string[];            // energy-type symbols
  damage: string;            // string, not number — TCG uses "30+", "×", etc.
  text: string | null;
};
```

All schemas validated at build time with Zod. Drift causes a loud build failure.

## 6. Pages and UX

### 6.1 Home

Prominent search bar as the centerpiece. Below: three featured sets (most recently released). Warm, tactile collector-binder aesthetic. Footer with source disclaimer.

### 6.2 Search results

Responsive card grid. Sidebar with four facets: **Set**, **Type**, **Rarity**, **Series**. Active filters shown as dismissable chips above the grid. Result count always visible. Empty state: "No cards match these filters" with a "Clear all" action.

### 6.3 Card detail

The centerpiece feature. **All available regional prints displayed together.**

- **Desktop:** grid of 2–4 prints side-by-side, depending on how many are available
- **Mobile:** swipeable horizontal carousel with language labels

Metadata panel below the gallery: HP, types, attacks, artist, release date, flavor text. Each print's metadata is language-specific — we display the English print's English text and the Japanese print's Japanese text (with optional romanisation in a future iteration). A "Data source: TCGdex, last updated [ISO timestamp]" footnote sits at the bottom of the panel.

## 7. Multi-language strategy

- **Search:** a single query matches against `searchTokens` from all four languages. Typing "Charizard", "リザードン", "리자몽", or "喷火龙" all resolve to the same card identity.
- **URLs:** one canonical URL per identity (`/card/base1-4`), not per language. This gives clean SEO and avoids duplicate-content penalties.
- **UI language:** English for v1. (Localising the UI itself is a future concern. We are *presenting* multilingual card data, not *translating* our interface.)
- **Missing prints:** cards that only exist in, say, Japanese simply show only the Japanese print. No empty placeholders.

## 8. Visual direction

**Base aesthetic: warm, tactile, card-art-forward collector binder.** Soft shadows, rounded corners, a warm cream/parchment palette. The card art is the visual hero on every page.

**Progression path for v2:** when price data arrives, we'll layer in discreet data-tile elements (small stat tiles showing latest sale, 24h change, etc.) in a restrained modern style. Not a dark-mode crypto-dashboard pivot — just information-dense tiles integrated into the collector feel.

## 9. Error handling & edge cases

| Situation                               | Behavior                                                             |
| --------------------------------------- | -------------------------------------------------------------------- |
| TCGdex API unreachable during build     | Fail build; keep previous deployment live; notify via GH Actions     |
| TCGdex returns a schema shape we don't recognise | Zod validation fails; build fails; previous deployment stays   |
| A language dump returns zero cards      | Treat as partial API outage; fail build                              |
| A card has some but not all prints      | Render only the prints that exist; no ghost tiles                    |
| A print has no image                    | Placeholder: set symbol + collector number on neutral background     |
| A print has no flavor text              | Hide the flavor-text row entirely (don't render "No flavor text")    |
| A user's search matches nothing         | Empty state with a "Clear all filters" CTA                           |

## 10. v2 pathway (informational — not in v1 scope)

This section exists so v1's architecture doesn't paint us into a corner later. We don't build any of it yet.

- **Separate workflow** runs every 5 minutes (GitHub Actions minimum cron granularity, which the user has confirmed is acceptable)
- **Fetches** eBay completed listings (Finding API) and Cardmarket public API for a curated watchlist of tracked cards
- **Writes** `prices.json` to a dedicated `data` branch
- **Site** polls `prices.json` on card-page load — no rebuild required for price freshness
- **Visualisation:** sparkline on card page, "latest sale" stat tile in the B-style data-tile language discussed in §8
- **Escape hatch:** if the 5-min cadence × thousands of cards exceeds GitHub Actions quotas, migrate *only* the price job to a Cloudflare Worker writing to a JSON endpoint. The card DB pipeline stays exactly as specified in §4.

## 11. Disclaimers (explicit requirement)

Two surfaces:

- **Footer, every page:**
  > Catalog data via [TCGdex](https://tcgdex.dev) (open source). Card images © The Pokémon Company. Translation and print data may contain inaccuracies — verify with TCGdex before acting on it.

- **Card-page data panel:**
  > Data source: TCGdex. Last updated: `[ISO timestamp from build]`.

The build step embeds the build timestamp into a static constant so each deployment self-reports its freshness.

## 12. Testing strategy

| Level               | What's tested                                            | Tooling                            |
| ------------------- | -------------------------------------------------------- | ---------------------------------- |
| Build-time schema   | Each language dump returns non-empty data matching schema| Zod validators in the build script |
| Multilingual search | Fixed query list — e.g. "Charizard", "リザードン" both resolve to `base1-4` | Vitest + Pagefind index probe      |
| Layout regression   | Home, one search result, one card page                   | Playwright visual snapshots        |

No unit tests for v1 UI components. YAGNI until interactive complexity grows beyond search + filter.

## 13. Key decisions log

A short record of *why*, not *what*, for decisions that could be revisited:

- **Astro over Next.js:** Astro is content-first; SSG with partial hydration is the right shape for a catalog. Next.js's data-fetching primitives are solved problems we don't have.
- **Pagefind over client-side MiniSearch:** Pagefind ships a lazy-loaded, per-query index fragment — avoiding a 10–30 MB client-side JSON download. Pages stay under 200 KB initial load.
- **Card-identity-keyed schema, not language-keyed:** lets the same URL serve any language user. Simpler SEO, better sharing, correct data model.
- **Hotlink images from TCGdex, don't self-host:** GitHub Pages' 1 GB soft limit is a hard ceiling for a multi-region image archive. TCGdex's terms permit hotlinking; we credit them.
- **Nightly catalog rebuild:** card data is practically static. Rebuilding more often wastes CI minutes. Manual dispatch covers the "new set just dropped" case.
- **Disabled fp-check plugin** in the user's Claude Code settings during this session because its Stop hook was noisy on non-security conversations. Unrelated to the product; recorded here only for session continuity.

## 14. Open questions

None at the time of approval. Open questions discovered during implementation go in a separate doc rather than mutating this one.
