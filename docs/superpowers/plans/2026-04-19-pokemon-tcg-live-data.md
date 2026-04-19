# Pokémon TCG Live-Data Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the catalog pipeline from fixture-backed to TCGdex-backed so every card in the public catalog appears on the live site.

**Architecture:** Two-tier fetch via `p-limit(20)` — per-card detail for English (pricing + canonical fields), summary-only lists for the other 10 populated languages. Add Dependabot and a weekly schema-drift workflow as evergreen support.

**Tech Stack:** TypeScript strict, `@tcgdex/sdk`, `p-limit`, Zod, tsx, GitHub Actions, Astro 6, Pagefind.

**Spec reference:** [`docs/superpowers/specs/2026-04-19-pokemon-tcg-live-data-design.md`](../specs/2026-04-19-pokemon-tcg-live-data-design.md)

---

## Context an engineer must know before starting

- **The live catalog has ~23,160 English cards plus 10 populated non-English languages** (FR, DE, IT, ES, PT, JA, ZH-TW, ZH-CN, TH, ID). Korean/Polish/Russian/Dutch are supported by TCGdex but currently empty and not in `SUPPORTED_LANGUAGES`.
- **Only English needs per-card detail fetches** — that's where Cardmarket pricing lives and where canonical fields (HP, attacks, etc.) come from. Cards are language-invariant below the name/image/setName fields, so for the other 10 languages we only need the summary list (one request per language).
- **The existing `normalise.ts` tolerates most missing fields** via `??` fallbacks. It needs one small tweak: `toPrint()` currently reads `raw.set.name` / `raw.set.symbol` / `raw.set.releaseDate` unconditionally, and summary cards don't include a `set` object. Task 1 makes those three reads optional.
- **Failure policy:** individual card-detail fetches that fail are logged + skipped. If >5% of EN detail fetches fail, abort the build (systemic issue). If the EN summary list itself is empty, abort (certain outage). Non-EN summary failures log but don't abort (data gaps at source are tolerable).
- **CI currently runs `npm run build:fixtures`** (committed `6194252`). Task 5 flips it back to `npm run build` (live fetch).
- **GitHub Pages deploy already works** — the v2.0 flow with fast-poll workflow is live at https://davstaylor.github.io/pokemon-tcg/. This plan extends deploy coverage to the full catalog.
- **Node 22, Astro 6, Zod v4, Vitest 4.** `main` branch, push-and-deploy pattern.

---

## File structure (planned end state)

```
/
├── .github/
│   ├── workflows/
│   │   ├── build.yml                      # modified: build:fixtures → build, + timeout
│   │   ├── prices-fast-poll.yml           # unchanged from v2.0
│   │   └── schema-drift-check.yml         # NEW
│   └── dependabot.yml                     # NEW
├── scripts/
│   ├── fetch-and-build-data.ts            # unchanged
│   ├── fetch-prices-fresh.ts              # unchanged
│   └── schema-drift-probe.ts              # NEW
├── src/data/
│   ├── fetch.ts                           # rewritten: two-tier concurrency-limited pattern
│   ├── normalise.ts                       # modified: `set` optional, three `?? ''` fallbacks
│   └── schema.ts                          # unchanged
├── tests/unit/
│   └── normalise.test.ts                  # extended: two new tests for summary-only cards
└── package.json                           # modified: + p-limit dependency
```

---

## Task 1: Normalise tolerance for summary-only cards

**Files:**
- Modify: `src/data/normalise.ts`
- Modify: `tests/unit/normalise.test.ts`

- [ ] **Step 1: Write the failing tests — append to `tests/unit/normalise.test.ts`**

Add these two new tests at the end of the existing `describe('normalise', ...)` block, before the closing `});`:

```ts
  it('tolerates summary-only non-EN cards (no set field present)', () => {
    // Simulates the shape the live fetch will produce: EN has full detail,
    // non-EN has only /v2/{lang}/cards summaries (id, localId, name, image).
    const mixed = {
      en: fixture.en,   // full detail including set
      fr: [{ id: 'base1-4', localId: '4', name: 'Dracaufeu', image: 'https://assets.tcgdex.net/fr/base/base1/4' }],
    };
    expect(() => normalise(mixed as never)).not.toThrow();
    const result = normalise(mixed as never);
    const charizard = result.find((c) => c.id === 'base1-4')!;
    expect(charizard.prints.fr?.name).toBe('Dracaufeu');
    expect(charizard.prints.fr?.setName).toBe('');
    expect(charizard.prints.fr?.releaseDate).toBe('');
  });

  it('preserves EN-first filter derivation when non-EN is summary-only', () => {
    // filters.setId, filters.series come from the first-encountered record for
    // an identity. SUPPORTED_LANGUAGES puts EN first, so filters are always
    // derived from the full EN record — even when later languages are summaries.
    const mixed = {
      en: fixture.en,
      fr: [{ id: 'base1-4', localId: '4', name: 'Dracaufeu', image: 'x' }],
    };
    const result = normalise(mixed as never);
    const charizard = result.find((c) => c.id === 'base1-4')!;
    expect(charizard.filters.setId).toBe('base1');
    expect(charizard.filters.series).toBe('base');
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npm run test:unit`
Expected: 2 new tests fail with `TypeError: Cannot read properties of undefined (reading 'name')` (or similar) from `toPrint()` trying to read `raw.set.name` on the summary-only record.

- [ ] **Step 3: Modify `src/data/normalise.ts` — relax `RawCard.set` and three reads in `toPrint`**

Open `src/data/normalise.ts`. The file starts with a `RawCard` type declaration. Change the `set` field from required to optional:

```ts
// Before:
type RawCard = {
  id: string;
  localId: string;
  name: string;
  image: string | null;
  set: {
    id: string;
    name: string;
    symbol: string | null;
    serie: { id: string; name: string };
    releaseDate: string;
  };
  ...
};

// After:
type RawCard = {
  id: string;
  localId: string;
  name: string;
  image: string | null;
  set?: {
    id: string;
    name: string;
    symbol: string | null;
    serie: { id: string; name: string };
    releaseDate: string;
  };
  ...
};
```

Note: only the `set` property gains `?`; the rest of `RawCard` is unchanged.

Then find the `toPrint` function and relax these three reads:

```ts
// Before:
setName: raw.set.name,
setSymbol: raw.set.symbol ? `${raw.set.symbol}.png` : '',
...
releaseDate: raw.set.releaseDate,

// After:
setName: raw.set?.name ?? '',
setSymbol: raw.set?.symbol ? `${raw.set.symbol}.png` : '',
...
releaseDate: raw.set?.releaseDate ?? '',
```

The rest of `toPrint` and the `normalise` main loop stay unchanged. The `filters` derivation in the main loop reads `raw.set.id` and `raw.set.serie.id` without `?.` — that's intentional, because it only runs on the FIRST language encountered for a card identity, and `SUPPORTED_LANGUAGES` puts EN first (where `set` is always present from the per-card detail fetch).

- [ ] **Step 4: Run tests to confirm pass**

Run: `npm run test:unit`
Expected: 51/51 pass (49 existing + 2 new).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/data/normalise.ts tests/unit/normalise.test.ts
git commit -m "feat(fetch): tolerate summary-only non-EN cards in normalise"
```

---

## Task 2: Rewrite `fetch.ts` to two-tier concurrency-limited pattern

**Files:**
- Modify: `src/data/fetch.ts`
- Modify: `package.json` (add p-limit)

- [ ] **Step 1: Install p-limit**

```bash
npm install p-limit
```

- [ ] **Step 2: Rewrite `src/data/fetch.ts`**

Replace the entire file contents with:

```ts
import pLimit from 'p-limit';
import TCGdex from '@tcgdex/sdk';
import type { Language } from './schema';
import { SUPPORTED_LANGUAGES } from './schema';
import type { RawDumps } from './normalise';

// Concurrency for the EN per-card detail fetch loop. TCGdex is a free public
// API; 20 parallel requests is a conservative starting point. If nightly runs
// show zero 429s over a week, this can be bumped. If we see 429s, drop to 10
// and add retry-with-backoff.
const CONCURRENCY = 20;

// If more than this fraction of EN per-card detail fetches fail, we assume a
// systemic issue (rate limit, outage, auth) and abort rather than shipping a
// degraded catalog. 5% of 23k is ~1,158 — well above normal transient noise.
const EN_FAILURE_ABORT_THRESHOLD = 0.05;

export async function fetchAllLanguages(): Promise<RawDumps> {
  // ---- English: per-card detail (for pricing and canonical fields) ----
  const enTcgdex = new TCGdex('en' as never);
  const enSummaries = await enTcgdex.fetch('cards');
  if (!enSummaries || enSummaries.length === 0) {
    throw new Error('fetchAllLanguages: EN summary list returned zero cards — treating as outage');
  }

  console.log(`Fetching EN detail for ${enSummaries.length} cards (concurrency ${CONCURRENCY})...`);
  const limit = pLimit(CONCURRENCY);
  let enFailures = 0;
  const enResults = await Promise.all(
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

  const enFailureRate = enFailures / enSummaries.length;
  if (enFailureRate > EN_FAILURE_ABORT_THRESHOLD) {
    throw new Error(
      `fetchAllLanguages: ${enFailures}/${enSummaries.length} EN detail fetches failed (${(enFailureRate * 100).toFixed(1)}%) — aborting`,
    );
  }
  const enCards = enResults.filter((c): c is NonNullable<typeof c> => c !== null && c !== undefined);
  console.log(`EN: ${enCards.length} cards fetched successfully (${enFailures} skipped)`);

  // ---- Non-EN populated languages: summary list only (id, localId, name, image) ----
  const otherLangs = SUPPORTED_LANGUAGES.filter((l): l is Exclude<Language, 'en'> => l !== 'en');
  const otherEntries = await Promise.all(
    otherLangs.map(async (lang) => {
      const langTcgdex = new TCGdex(lang as never);
      const summaries = await langTcgdex.fetch('cards');
      if (!summaries || summaries.length === 0) {
        console.warn(`${lang}: zero cards — data gap at source, not fetched as outage`);
        return [lang, [] as unknown[]] as const;
      }
      console.log(`${lang}: ${summaries.length} summaries fetched`);
      return [lang, summaries] as const;
    }),
  );

  const result = { en: enCards, ...Object.fromEntries(otherEntries) } as unknown as RawDumps;

  // Fail loud if every language is empty — systemic outage.
  const totalCards = Object.values(result).reduce((sum, cards) => sum + (cards?.length ?? 0), 0);
  if (totalCards === 0) {
    throw new Error('fetchAllLanguages: every language returned zero cards — certain outage');
  }

  return result;
}
```

- [ ] **Step 3: Smoke-test against live TCGdex (local)**

This is a local end-to-end test. Run the full build against live data:

```bash
rm -f data/cards.json data/prices-baseline.json  # clean slate
time npm run build
```

Expected: succeeds in ~8-12 minutes. Stdout includes:
- `Fetching EN detail for 23xxx cards (concurrency 20)...`
- `EN: 23xxx cards fetched successfully (N skipped)` — N should be small (< 50)
- Ten lines like `fr: 21271 summaries fetched`
- `Wrote 23xxx price records to data/prices-baseline.json`
- `Wrote 24xxx card identities to data/cards.json in Xs`
- `Astro` build lines with thousands of `/card/*/index.html` pages generated
- Pagefind indexing ~25k pages

If this fails with rate-limiting (429 responses), drop `CONCURRENCY` to 10 in `src/data/fetch.ts`, recommit, and try again.

- [ ] **Step 4: Verify a random card page in the live build**

```bash
ls dist/card | head -20
ls dist/card | wc -l
```

Expected: the `card/` directory contains ~23k entries. Counts should roughly match `jq 'length' data/cards.json`.

- [ ] **Step 5: Typecheck + unit tests**

```bash
npm run typecheck
npm run test:unit
```

Expected: typecheck clean, 51/51 unit tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/data/fetch.ts package.json package-lock.json
git commit -m "feat(fetch): two-tier concurrency-limited fetch (EN detail + non-EN summaries)"
```

---

## Task 3: Schema-drift probe script

**Files:**
- Create: `scripts/schema-drift-probe.ts`

- [ ] **Step 1: Create `scripts/schema-drift-probe.ts`**

```ts
// Weekly schema-drift probe. Runs only the fetch + normalise + validate pipeline.
// No Astro build, no disk write. Exits 0 on valid shape, non-zero on Zod failure.
// Intended for CI use in schema-drift-check.yml — decouples "TCGdex shape changed"
// detection from nightly deployment health.
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

- [ ] **Step 2: Smoke-test the probe**

```bash
npx tsx scripts/schema-drift-probe.ts
```

Expected: exits 0 with the `OK: N identities match current schema.` line. (Takes ~5-7 min because it does the full fetch.)

If the probe finds real drift on first run, that's the drift check working as designed — fix the schema in a separate commit.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/schema-drift-probe.ts
git commit -m "feat(ci): add schema-drift probe script for weekly shape validation"
```

---

## Task 4: Dependabot config + schema-drift workflow

**Files:**
- Create: `.github/dependabot.yml`
- Create: `.github/workflows/schema-drift-check.yml`

- [ ] **Step 1: Create `.github/dependabot.yml`**

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

- [ ] **Step 2: Create `.github/workflows/schema-drift-check.yml`**

```yaml
name: schema-drift-check

on:
  schedule:
    - cron: '17 9 * * 1'        # Mondays 09:17 UTC — off-the-hour to avoid joining every other repo on :00
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
        with:
          node-version: 22
          cache: npm
      - run: npm ci

      - name: Fetch + normalise + validate (no build, no deploy)
        id: check
        run: |
          if npx tsx scripts/schema-drift-probe.ts; then
            echo "result=pass" >> "$GITHUB_OUTPUT"
          else
            echo "result=fail" >> "$GITHUB_OUTPUT"
          fi
        continue-on-error: true

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

      - name: Fail the job (so red shows on the Actions tab)
        if: steps.check.outputs.result == 'fail'
        run: exit 1
```

- [ ] **Step 3: Validate yaml syntax**

```bash
npx --yes yaml-lint .github/workflows/schema-drift-check.yml .github/dependabot.yml
```

(If `yaml-lint` isn't already available, use Python or any yaml parser: `python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml'))"` — just ensure the files parse.)

Expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add .github/dependabot.yml .github/workflows/schema-drift-check.yml
git commit -m "ci: add Dependabot + weekly schema-drift check workflow"
```

---

## Task 5: Flip CI to live build + smoke-test deploy

**Files:**
- Modify: `.github/workflows/build.yml`

- [ ] **Step 1: Modify `.github/workflows/build.yml`**

Read the file first. Make three changes in the `build:` job:

1. Under `jobs.build:`, add a `timeout-minutes: 20` line just after `runs-on: ubuntu-latest`.
2. In the build step, change `npm run build:fixtures` to `npm run build`, and rename the step from `Build (fixture — live-fetch strategy pending)` to `Build (live TCGdex fetch)`.
3. Remove the comment block above the build step that explains the temporary fixture state.

The relevant portion should end up looking like:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test:unit
      - name: Build (live TCGdex fetch)
        run: npm run build
        env:
          PUBLIC_BUILD_TIMESTAMP: ${{ github.event.head_commit.timestamp || github.run_started_at }}
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
```

Leave all other parts of `build.yml` unchanged (triggers, permissions, deploy job).

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: flip build to live TCGdex fetch with 20-min timeout"
```

- [ ] **Step 3: Push and trigger deploy**

```bash
git push origin main
```

The push auto-triggers `build-and-deploy` with the new live-fetch build. Watch it:

```bash
gh run watch $(gh run list --workflow=build-and-deploy --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Expected: workflow succeeds within ~15 min. If it times out at 20 min, investigate immediately — don't bump the timeout until you understand why (rate limit? slow network?).

- [ ] **Step 4: Verify live deployment of the full catalog**

Once deploy completes, verify that cards beyond the old 2-card fixture are live:

```bash
# A modern SV-era card that was NOT in the fixture:
curl -sI https://davstaylor.github.io/pokemon-tcg/card/sv03-215/ | head -3
# Expected: HTTP/2 200

# Charizard (base1-4) still works:
curl -s https://davstaylor.github.io/pokemon-tcg/card/base1-4/ | grep -oE '<h1[^>]*>[^<]+' | head -1
# Expected: matches "Charizard"

# Spot-check a French-only name like Dracaufeu appears on the Charizard page:
curl -s https://davstaylor.github.io/pokemon-tcg/card/base1-4/ | grep -c 'Dracaufeu'
# Expected: >= 1

# Card count estimate — each card has its own directory
# (The live host doesn't expose directory listings, so sample a few random-looking IDs)
for ID in swsh1-1 sv03-1 swsh12pt5-60 base1-1; do
  STATUS=$(curl -sI "https://davstaylor.github.io/pokemon-tcg/card/$ID/" | head -1)
  echo "$ID: $STATUS"
done
# Expected: most show HTTP/2 200
```

- [ ] **Step 5: Trigger the schema-drift workflow manually**

```bash
gh workflow run schema-drift-check.yml
sleep 10
gh run watch $(gh run list --workflow=schema-drift-check --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Expected: the first run succeeds (no drift on freshly-aligned schema). If it fails, that's a real schema misalignment — investigate and fix before Task 5 is considered done.

- [ ] **Step 6: Final no-op commit only if a tweak was needed**

If everything succeeded, no additional commit. The plan is done.

---

## Self-review (done by writer before handoff)

**Spec coverage:**

| Spec § | Covered in task(s) |
| --- | --- |
| §1 Problem & goal | Implicit throughout; Task 5 step 4 verifies the deploy covers the full catalog |
| §2 Architecture (two-tier fetch) | Task 2 |
| §2 `normalise.ts` small tweak | Task 1 |
| §3.1 fetch.ts rewrite | Task 2 |
| §3.2 CI flip + timeout | Task 5 |
| §3.3 Dependabot | Task 4 |
| §3.4 Schema-drift workflow | Task 4 (workflow) + Task 3 (probe) |
| §3.5 File change summary | All touched files addressed |
| §4 Error handling | Task 2 (failure threshold, EN-empty abort, all-empty abort) |
| §5 Testing | Task 1 (unit tests for summary tolerance), Task 2 (local smoke test), Task 5 (live smoke + drift) |
| §6 Performance budget | Task 5 (20-min timeout; smoke step expects ≤15 min) |
| §7 Key decisions | Embedded in Task 2 code comments and Context block |

**Placeholder scan:** no "TBD", "similar to Task N", or "add appropriate error handling" phrases. Every step has exact code or exact commands.

**Type consistency:** `RawCard.set` is optional from Task 1 onward; Task 2's new `fetch.ts` produces mixed EN-detail + non-EN-summary shape that `normalise.ts` already handles after Task 1. `SUPPORTED_LANGUAGES`, `Language`, and `RawDumps` imports match across Tasks 2 and 3.

**Known risks / notes for executor:**
- **TCGdex rate limits are undocumented.** Concurrency 20 is a guess. If Task 2 step 3 (local smoke) shows 429 responses in the SDK's error path, drop to 10 and commit the change.
- **First live CI run on merged main will take ~10 minutes.** That's intentional and within budget. Don't panic.
- **The schema-drift probe runs the same fetch as nightly.** If it's failing for real reasons, nightly will be failing for the same reasons — check Actions tab for both signals.

---

## Estimated effort

| Task | Effort |
| --- | --- |
| 1 Normalise tolerance | 20 min |
| 2 fetch.ts rewrite + smoke | 45 min (plus ~8 min wall time for the smoke build) |
| 3 Drift probe script + smoke | 20 min (plus ~5 min for the probe's live fetch) |
| 4 Dependabot + drift workflow | 15 min |
| 5 CI flip + deploy smoke | 30 min (plus ~15 min for the CI run) |
| **Total** | **~2 hours focused work + ~30 min CI wall time** |
