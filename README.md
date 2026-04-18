# Pokémon TCG Catalog

A multilingual reference site for Pokémon TCG collectors. Search any card in English, Japanese, Korean, or Chinese — see every regional print side-by-side on one page.

## Status

v1 — catalog-only. Price data and market analytics are deferred to v2.

## Develop

```bash
npm install
npm run build:fixtures   # generates data/cards.json from checked-in fixture (offline-friendly)
npm run dev
```

Visit http://localhost:4321/pokemon-tcg.

For a full live fetch from TCGdex (requires internet, takes a few minutes):

```bash
npm run build
npm run preview
```

## Test

```bash
npm run typecheck
npm run test:unit
npm run test:e2e
```

## Data sources

- Catalog data: [TCGdex](https://tcgdex.dev) via `@tcgdex/sdk`.
- Card images: hot-linked from TCGdex's CDN. Copyright © The Pokémon Company.

Design doc: [`docs/superpowers/specs/2026-04-18-pokemon-tcg-catalog-design.md`](docs/superpowers/specs/2026-04-18-pokemon-tcg-catalog-design.md).
Implementation plan: [`docs/superpowers/plans/2026-04-18-pokemon-tcg-catalog-v1.md`](docs/superpowers/plans/2026-04-18-pokemon-tcg-catalog-v1.md).
