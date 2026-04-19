# Pokémon TCG Catalog — Live-Data Fetch Design

**Date:** 2026-04-19
**Status:** Approved (brainstorming → implementation-ready)
**Scope:** Switch the catalog data pipeline from fixture-backed to TCGdex-backed, so every card in the public catalog appears on the live site with current prices. Adds evergreen operational support (Dependabot, schema-drift alerting).

**Builds on:** [v1 catalog](2026-04-18-pokemon-tcg-catalog-design.md) (schema, pages, Pagefind search) and [v2.0 prices](2026-04-19-pokemon-tcg-prices-v2-design.md) (PriceTile, fast-poll workflow). This spec does not introduce new user-facing features; it makes the already-built UI reach every card rather than the 2-card fixture.

## 1. Problem & goal

The site currently deploys from a checked-in fixture of 2 cards. All the pipelines (multilingual search, faceted filter, price tiles, chart.js, fast-poll) work end-to-end — but only those 2 cards are visible to visitors. The stopgap was deliberate: a naive live-fetch would fire ~127,000 HTTP requests per build and rate-limit us.

**Goal:** deploy the full TCGdex catalog (23,160 English cards plus metadata-linked translations in 10 populated languages) via a nightly build that completes inside GitHub Actions' time budget and stays loud when TCGdex's shape changes.

## 2. Architecture

Data sources remain unchanged (TCGdex as sole catalog source, Cardmarket via TCGdex for pricing). What changes is how we reach that data:

### Three observations drive the new fetch pattern

1. **Pricing is on the per-card detail endpoint, and it's the same regardless of which language we request.** There is no per-language price; Cardmarket tracks a card by its TCGdex canonical id.
2. **Canonical card fields (HP, attacks, rarity, artist, flavor text, types, weaknesses) are effectively language-invariant.** The only language-varying fields on our card pages are `name`, `setName`, and `imageURL`.
3. **TCGdex's `/v2/{lang}/cards` summary endpoint returns exactly `{id, localId, name, image}` per card in a single response** — the fields we actually need for non-English prints.

Result: we only need per-card detail fetches for English. For every other populated language we fetch a single summary list.

### Fetch cost table

| Language | Endpoint | Requests |
| --- | --- | ---: |
| English | `/v2/en/cards` (summaries) + one `/v2/en/cards/{id}` per card | 1 + 23,160 |
| Japanese, French, German, Italian, Spanish, Portuguese, Traditional Chinese, Simplified Chinese, Thai, Indonesian (10 populated languages) | `/v2/{lang}/cards` (summaries only) | 10 × 1 |
| **Total** | | **~23,171** |

At **concurrency 20**, that's roughly 1,150 batches of per-card fetches. Assuming ~200 ms per batch round-trip, the EN fetch takes about 4 minutes. Non-EN summaries complete in seconds. Astro static-site generation of 23,160 card pages plus Pagefind indexing typically adds 3–5 minutes. Total expected CI build time: **~10 minutes**.

### Small tweak needed in `normalise.ts`

The existing `toPrint()` function uses `?? 'Unknown'` / `?? null` / `?? []` fallbacks for most scalar fields, which naturally absorbs summary-only input. The one exception is the `set` object — `toPrint` reads `raw.set.name`, `raw.set.symbol`, `raw.set.releaseDate`. Summary records don't include a `set` object (they just have `id`, `localId`, `name`, `image`).

Fix: relax three lines in `toPrint()`:

```ts
// Before:
setName: raw.set.name,
setSymbol: raw.set.symbol ? `${raw.set.symbol}.png` : '',
releaseDate: raw.set.releaseDate,

// After:
setName: raw.set?.name ?? '',
setSymbol: raw.set?.symbol ? `${raw.set.symbol}.png` : '',
releaseDate: raw.set?.releaseDate ?? '',
```

Also make `raw.set` optional in the `RawCard` type. The `filters` block in normalise's main loop reads `raw.set.id` and `raw.set.serie.id`, but that block only runs on the FIRST print encountered for a card identity, and we iterate `SUPPORTED_LANGUAGES` with EN first — so the first print is always the EN detail record with a full `set` object. No change needed there.

The fields affected on non-EN prints (`setName`, `setSymbol`, `releaseDate`) aren't rendered by `PrintGallery` for secondary OR primary non-EN prints — those components only show the language label, image, and name. So the empty-string placeholders are invisible in the UI.

## 3. Implementation shape

### 3.1 `src/data/fetch.ts`

Rewrite to the two-tier pattern:

```ts
import pLimit from 'p-limit';
import TCGdex from '@tcgdex/sdk';
import type { Language } from './schema';
import { SUPPORTED_LANGUAGES } from './schema';
import type { RawDumps } from './normalise';

const CONCURRENCY = 20;

export async function fetchAllLanguages(): Promise<RawDumps> {
  // EN: per-card detail for pricing and canonical fields
  const enTcgdex = new TCGdex('en' as never);
  const enSummaries = await enTcgdex.fetch('cards');
  if (!enSummaries || enSummaries.length === 0) {
    throw new Error('fetchAllLanguages: EN summary list empty — API outage');
  }
  const limit = pLimit(CONCURRENCY);
  let enFailures = 0;
  const enDetails = await Promise.all(
    enSummaries.map((s) =>
      limit(async () => {
        try {
          return await enTcgdex.fetch('cards', s.id);
        } catch (err) {
          enFailures++;
          console.warn(`EN fetch failed for ${s.id}: ${(err as Error).message}`);
          return null;
        }
      }),
    ),
  );
  if (enFailures / enSummaries.length > 0.05) {
    throw new Error(`fetchAllLanguages: ${enFailures}/${enSummaries.length} EN detail fetches failed — aborting`);
  }
  const enCards = enDetails.filter((c): c is NonNullable<typeof c> => c !== null);

  // Non-EN populated languages: summary list only, no per-card detail
  const otherLangs = SUPPORTED_LANGUAGES.filter((l): l is Exclude<Language, 'en'> => l !== 'en');
  const otherEntries = await Promise.all(
    otherLangs.map(async (lang) => {
      const langTcgdex = new TCGdex(lang as never);
      const summaries = await langTcgdex.fetch('cards');
      if (!summaries || summaries.length === 0) {
        console.warn(`${lang} returned zero cards — data gap at source, not fetched as outage`);
        return [lang, []] as const;
      }
      return [lang, summaries] as const;
    }),
  );

  const result = { en: enCards, ...Object.fromEntries(otherEntries) } as unknown as RawDumps;
  return result;
}
```

The `RawCard` shape in `normalise.ts` is a superset of both the detail response and the summary response, so no type adjustments are needed at that boundary — downstream code sees one record type.

### 3.2 CI flip

`.github/workflows/build.yml`:
- Change the build step from `npm run build:fixtures` back to `npm run build`.
- Remove the temporary-state comment that was added when we switched to fixtures.
- Add `timeout-minutes: 20` to the `build` job as an explicit budget (default is 6 hours — we want to fail fast if the pipeline regresses, not idle for hours).
- Everything else (Node 22, permissions, deploy job, `paths-ignore` on `data/prices-fresh.json`) stays as-is.

### 3.3 Dependabot

New file: `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: "07:00"
      timezone: Europe/London
    open-pull-requests-limit: 5
    groups:
      production:
        dependency-type: production
      development:
        dependency-type: development
```

Weekly Monday-morning PRs, grouped so we get two PRs per week at most (one per ecosystem type) rather than one-per-package.

### 3.4 Schema-drift check

New workflow: `.github/workflows/schema-drift-check.yml`

```yaml
name: schema-drift-check

on:
  schedule:
    - cron: '17 9 * * 1'        # Mondays 09:17 UTC (off-the-hour so we don't join every other repo on :00)
  workflow_dispatch: {}

permissions:
  contents: read
  issues: write                  # can open a drift issue

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - name: Fetch + normalise + validate (no build, no deploy)
        id: check
        run: |
          if npx tsx scripts/schema-drift-probe.ts; then
            echo "result=pass" >> "$GITHUB_OUTPUT"
          else
            echo "result=fail" >> "$GITHUB_OUTPUT"
            exit 0  # don't fail the job; we open an issue instead
          fi

      - name: Open issue on drift detection
        if: steps.check.outputs.result == 'fail'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '[schema-drift] TCGdex shape validation failed on weekly check',
              labels: ['schema-drift'],
              body: `The weekly schema-drift probe failed. See the workflow run for details:\n\n${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}\n\nLikely causes: TCGdex added/renamed/removed a field, changed a type, or shipped a new enum value we don't recognise.`,
            });
```

Companion script: `scripts/schema-drift-probe.ts`

```ts
// Runs only the fetch + normalise + validate pipeline. No Astro build, no disk write.
// Exits 0 on valid shape, exits non-zero on Zod validation failure.
import { fetchAllLanguages } from '../src/data/fetch.ts';
import { normalise } from '../src/data/normalise.ts';
import { CardIdentityArraySchema } from '../src/data/schema.ts';

async function main() {
  console.log('Fetching all languages...');
  const dumps = await fetchAllLanguages();
  console.log('Normalising...');
  const identities = normalise(dumps);
  console.log('Validating...');
  CardIdentityArraySchema.parse(identities);
  console.log(`OK: ${identities.length} identities match current schema.`);
}

main().catch((err) => {
  console.error('DRIFT DETECTED:', err);
  process.exit(1);
});
```

### 3.5 File changes summary

| File | Change |
| --- | --- |
| `src/data/fetch.ts` | Rewritten to two-tier concurrency-limited pattern |
| `src/data/normalise.ts` | Three `?? ''` fallbacks on set fields in `toPrint()`; make `set` optional in `RawCard` type |
| `scripts/schema-drift-probe.ts` | NEW — runs just the fetch/normalise/validate for drift detection |
| `.github/workflows/build.yml` | `build:fixtures` → `build`; add `timeout-minutes: 20`; delete stopgap comment |
| `.github/workflows/schema-drift-check.yml` | NEW — weekly drift check that opens an issue on failure |
| `.github/dependabot.yml` | NEW — weekly grouped npm PRs |
| `package.json` | Add `p-limit` as runtime dependency |

## 4. Error handling & edge cases

| Situation | Behavior |
| --- | --- |
| Any single EN per-card fetch fails | Log, skip. Failure counter increments. |
| >5% of EN per-card fetches fail | Abort build. Likely systemic (rate limit, outage, network). |
| EN summary list returns zero cards | Abort build immediately. Empty EN is a certain outage signal. |
| Non-EN summary list returns zero cards | Log warning, continue. Some populated languages are occasionally empty at TCGdex; we keep deploying with the other prints. |
| TCGdex returns a schema shape we don't recognise | Zod boundary validation fails → build fails → previous deployment stays live. |
| CI build exceeds 20 min | Workflow times out. Previous deployment stays live. Investigate (rate limit? TCGdex slow?) before bumping the limit. |
| Dependabot bumps `@tcgdex/sdk` in a shape-breaking way | PR triggers a build → build fails via Zod → we don't merge the PR. |
| Schema-drift probe detects a shape change | Opens a GitHub issue tagged `schema-drift` with a link to the failing run. |

## 5. Testing

| Level | Test |
| --- | --- |
| Unit (existing, no change) | Schema, normalise, merge, delta, freshness — 49 tests still pass. |
| Unit (new) | A mock-network test for `fetchAllLanguages` that verifies concurrency limit is honoured and summary-vs-detail requests are made correctly. Stub the SDK so no real network. |
| E2E (existing, no change) | 16 existing tests still pass. |
| CI smoke (manual, post-flip) | After merging, trigger the nightly workflow manually. Expected: completes in ≤15 min, deploys the full catalog. Verify a random card from a non-EN language (e.g. Dracaufeu as FR of `base1-4`) renders on the live site. |
| Drift check | Trigger `schema-drift-check.yml` manually on merge. Expected: exits clean (current schema matches live TCGdex). |

## 6. Performance budget

| Stage | Budget | Expected |
| --- | --- | --- |
| EN summaries fetch | 5 s | 1 request |
| EN detail fetches (concurrency 20) | 5 min | 23,160 requests |
| Non-EN summaries fetch | 30 s | 10 requests, parallel |
| Normalise + price-extract | 30 s | pure CPU over ~25k records |
| Astro SSG | 4 min | 23,160 static pages |
| Pagefind indexing | 2 min | ~25k searchable pages |
| Upload to Pages + deploy | 2 min | — |
| **Total** | **~14 min, 20 min ceiling** | ~10 min typical |

If real-world CI exceeds 15 minutes on first run, pause and investigate; don't just bump the timeout. Common causes: TCGdex rate-limiting us (429 responses), TCGdex slowed down, or network flakiness.

## 7. Key decisions log

- **Concurrency 20.** Starting point. Conservative for a free public API. If we see zero 429s over a week of nightly runs, bump to 30 or 40 for faster builds. If we see 429s, drop to 10 and add retry-with-backoff.
- **Summaries-only for non-EN.** Saves ~90% of cross-language request volume. The cost is that non-EN prints in our UI can't show extra metadata (HP, attacks, flavor text in that language) — but the UI doesn't show those for secondary prints anyway. No loss of user-visible information.
- **5% EN-detail-failure abort threshold.** Fail-loud for systemic issues (rate limit, auth, outage) without making a single flaky card kill the build. 5% of 23k is ~1,158 — much higher than normal transient failure rates.
- **Weekly drift check separate from nightly build.** A build failure is a deployment problem; a drift failure is a schema problem. Different signals, different responders. Drift check opens an issue rather than emailing owners so the discovery doesn't get lost.
- **Dependabot grouped by dependency type.** Minimises PR noise. Still exposes each bump; we just get them batched.
- **`p-limit` over `PQueue`.** Smaller, zero-dep, does exactly one thing well. Can upgrade if we need retries, priority, or scheduling later.
- **No retry-with-backoff in v1.** Failed fetches are logged and skipped. Adding retry is a complication we can layer on if the 5% threshold is tripped by flaky network rather than rate limits. Wait for evidence before adding complexity.

## 8. Open questions

None at the time of approval. Unknowns surfaced during implementation go in a separate doc rather than mutating this spec.
