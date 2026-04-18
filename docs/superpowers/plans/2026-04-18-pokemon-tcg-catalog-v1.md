# Pokémon TCG Catalog v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static multilingual Pokémon TCG catalog to GitHub Pages: users can search in EN/JP/KR/ZH and see every regional print of any card side-by-side. No prices yet.

**Architecture:** Astro SSG with Preact islands for interactivity. Build-time pipeline fetches TCGdex data for four languages, normalises to a card-identity-keyed schema, emits one static page per card, and indexes everything with Pagefind. Nightly rebuild via GitHub Actions.

**Tech Stack:** Astro 4+, Preact, TypeScript, Zod, Pagefind, `@tcgdex/sdk`, Vitest, Playwright, GitHub Actions, GitHub Pages.

**Spec reference:** [`docs/superpowers/specs/2026-04-18-pokemon-tcg-catalog-design.md`](../specs/2026-04-18-pokemon-tcg-catalog-design.md)

---

## Context an engineer must know before starting

- The TCGdex API is free and public: `https://api.tcgdex.net/v2/`. Its official Node SDK `@tcgdex/sdk` handles pagination and language selection. Use the SDK, not raw fetch.
- **Card identity** in this codebase is the pair `{setId, localId}` (TCGdex calls the collector number `localId`). A card identity aggregates all available regional prints.
- **Images are hotlinked**, never downloaded to the repo. TCGdex returns image URLs as base strings (without extension); you append `/high.webp` or `/low.webp` to pick resolution.
- **No runtime secrets.** Everything that needs data happens at build time.
- **Fail-loud philosophy:** if the TCGdex API is down or its schema has drifted, the build fails. GitHub Pages keeps serving the previous deployment. We never overwrite a working site with broken data.

---

## File structure

Files created during this plan:

```
/ (repo root)
├── .github/
│   └── workflows/
│       └── build.yml                    # nightly + manual rebuild + deploy
├── astro.config.mjs                      # Astro config (Preact integration, site URL)
├── package.json
├── tsconfig.json
├── playwright.config.ts
├── vitest.config.ts
├── src/
│   ├── layouts/
│   │   └── Base.astro                   # site shell (header, footer, <head>)
│   ├── components/
│   │   ├── CardTile.astro               # grid thumbnail
│   │   ├── PrintGallery.astro           # side-by-side regional prints on card page
│   │   ├── Disclaimer.astro             # repeated footer disclaimer
│   │   ├── SearchBox.tsx                # Preact island — search input + results
│   │   └── FacetSidebar.tsx             # Preact island — filter chips
│   ├── pages/
│   │   ├── index.astro                  # home
│   │   ├── search.astro                 # results page
│   │   └── card/
│   │       └── [id].astro               # one page per card identity
│   ├── data/
│   │   ├── schema.ts                    # Zod schemas + TS types
│   │   ├── normalise.ts                 # TCGdex → CardIdentity merge
│   │   └── fetch.ts                     # wraps @tcgdex/sdk, returns raw data
│   └── lib/
│       └── build-meta.ts                # build timestamp constant (injected)
├── scripts/
│   └── fetch-and-build-data.ts          # runs before Astro build
├── data/
│   ├── cards.json                       # generated — NOT committed
│   └── fixtures/
│       └── sample-cards.json            # checked-in — 10-card sample for tests
├── tests/
│   ├── unit/
│   │   ├── schema.test.ts
│   │   ├── normalise.test.ts
│   │   └── search-sanity.test.ts
│   └── e2e/
│       ├── home.spec.ts
│       ├── card-page.spec.ts
│       └── search.spec.ts
└── docs/                                 # already exists
```

Each file has one clear responsibility. `schema.ts` is the source of truth for types and is imported everywhere — change it there and only there.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `astro.config.mjs`
- Create: `src/layouts/Base.astro`
- Create: `src/pages/index.astro`
- Modify: `.gitignore`

- [ ] **Step 1: Initialise Node + install Astro with Preact**

Run from repo root:

```bash
npm init -y
npm install --save-dev astro @astrojs/preact preact typescript @types/node
```

- [ ] **Step 2: Replace the generated `package.json` scripts**

Open `package.json` and set the `"scripts"` block to:

```json
"scripts": {
  "dev": "astro dev",
  "build": "tsx scripts/fetch-and-build-data.ts && astro build && pagefind --site dist",
  "build:fixtures": "FIXTURES=1 tsx scripts/fetch-and-build-data.ts && astro build && pagefind --site dist",
  "preview": "astro preview",
  "test:unit": "vitest run",
  "test:e2e": "playwright test",
  "typecheck": "tsc --noEmit"
}
```

Leave the rest of `package.json` untouched.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "preact",
    "types": ["astro/client"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

- [ ] **Step 4: Create `astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

export default defineConfig({
  site: 'https://davidtaylor.github.io',
  base: '/pokemon-tcg',
  integrations: [preact()],
  output: 'static',
});
```

(The `site` and `base` values are placeholders matching the user's GitHub handle; if the repo name differs, update `base`.)

- [ ] **Step 5: Create `src/layouts/Base.astro`**

```astro
---
interface Props {
  title: string;
  description?: string;
}
const { title, description = 'Pokémon TCG multilingual catalog' } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>{title}</title>
    <meta name="description" content={description} />
  </head>
  <body>
    <main>
      <slot />
    </main>
  </body>
</html>
```

- [ ] **Step 6: Create minimal `src/pages/index.astro`**

```astro
---
import Base from '@/layouts/Base.astro';
---
<Base title="Pokémon TCG Catalog">
  <h1>Pokémon TCG Catalog</h1>
  <p>A multilingual reference for collectors.</p>
</Base>
```

- [ ] **Step 7: Add Astro build outputs to .gitignore**

Open `.gitignore` and append:

```
# Astro
dist/
.astro/
# Generated data
data/cards.json
# Test output
test-results/
playwright-report/
```

- [ ] **Step 8: Verify dev server starts**

Run: `npm run dev`
Expected: output contains `Local: http://localhost:4321/pokemon-tcg`. Ctrl-C to stop. If the port shows the wrong base path, recheck `astro.config.mjs`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json astro.config.mjs src/ .gitignore
git commit -m "chore: scaffold Astro+Preact project"
```

---

## Task 2: Schema + Zod validators

**Files:**
- Create: `src/data/schema.ts`
- Create: `tests/unit/schema.test.ts`
- Modify: `package.json` (add Zod + Vitest)

- [ ] **Step 1: Install Zod and Vitest**

```bash
npm install zod
npm install --save-dev vitest
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
});
```

- [ ] **Step 3: Write the failing test first — `tests/unit/schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { CardIdentitySchema } from '@/data/schema';

describe('CardIdentitySchema', () => {
  it('accepts a minimal valid card identity with one print', () => {
    const valid = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: {
        en: {
          name: 'Charizard',
          setName: 'Base',
          setSymbol: 'https://assets.tcgdex.net/en/base/base1/symbol.png',
          rarity: 'Holo Rare',
          hp: 120,
          types: ['Fire'],
          attacks: [],
          artist: 'Mitsuhiro Arita',
          imageURL: 'https://assets.tcgdex.net/en/base/base1/4/high.webp',
          releaseDate: '1999-01-09',
          flavorText: 'Spits fire that is hot enough to melt boulders.',
        },
      },
      searchTokens: ['Charizard'],
      filters: { setId: 'base1', rarity: 'Holo Rare', types: ['Fire'], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(valid)).not.toThrow();
  });

  it('accepts a card with multiple regional prints', () => {
    const multi = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: {
        en: { name: 'Charizard', setName: 'Base', setSymbol: 'x', rarity: 'Holo Rare', hp: 120, types: ['Fire'], attacks: [], artist: 'A', imageURL: 'x', releaseDate: '1999-01-09', flavorText: null },
        ja: { name: 'リザードン', setName: '拡張パック', setSymbol: 'x', rarity: 'Holo Rare', hp: 120, types: ['Fire'], attacks: [], artist: 'A', imageURL: 'x', releaseDate: '1996-10-20', flavorText: null },
      },
      searchTokens: ['Charizard', 'リザードン'],
      filters: { setId: 'base1', rarity: 'Holo Rare', types: ['Fire'], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(multi)).not.toThrow();
  });

  it('rejects a card with no prints at all', () => {
    const empty = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: {},
      searchTokens: [],
      filters: { setId: 'base1', rarity: 'x', types: [], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(empty)).toThrow();
  });

  it('rejects unknown language keys in prints', () => {
    const bad = {
      id: 'base1-4',
      defaultName: 'Charizard',
      prints: { fr: { /* doesn't matter */ } },
      searchTokens: ['Charizard'],
      filters: { setId: 'base1', rarity: 'x', types: [], series: 'base' },
    };
    expect(() => CardIdentitySchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `npm run test:unit`
Expected: all 4 tests fail with "Cannot find module '@/data/schema'".

- [ ] **Step 5: Implement `src/data/schema.ts`**

```ts
import { z } from 'zod';

export const SUPPORTED_LANGUAGES = ['en', 'ja', 'ko', 'zh'] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];

export const AttackSchema = z.object({
  name: z.string(),
  cost: z.array(z.string()),
  damage: z.string(),
  text: z.string().nullable(),
});
export type Attack = z.infer<typeof AttackSchema>;

export const PrintDataSchema = z.object({
  name: z.string(),
  setName: z.string(),
  setSymbol: z.string(),
  rarity: z.string(),
  hp: z.number().nullable(),
  types: z.array(z.string()),
  attacks: z.array(AttackSchema),
  artist: z.string(),
  imageURL: z.string(),
  releaseDate: z.string(),
  flavorText: z.string().nullable(),
});
export type PrintData = z.infer<typeof PrintDataSchema>;

export const PrintsSchema = z
  .object({
    en: PrintDataSchema.optional(),
    ja: PrintDataSchema.optional(),
    ko: PrintDataSchema.optional(),
    zh: PrintDataSchema.optional(),
  })
  .strict()
  .refine((prints) => Object.keys(prints).length > 0, {
    message: 'A card identity must have at least one print',
  });

export const CardIdentitySchema = z.object({
  id: z.string(),
  defaultName: z.string(),
  prints: PrintsSchema,
  searchTokens: z.array(z.string()),
  filters: z.object({
    setId: z.string(),
    rarity: z.string(),
    types: z.array(z.string()),
    series: z.string(),
  }),
});
export type CardIdentity = z.infer<typeof CardIdentitySchema>;

export const CardIdentityArraySchema = z.array(CardIdentitySchema);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:unit`
Expected: all 4 tests pass.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no output.

- [ ] **Step 8: Commit**

```bash
git add src/data/schema.ts tests/unit/schema.test.ts vitest.config.ts package.json package-lock.json
git commit -m "feat(schema): define CardIdentity schema with Zod validation"
```

---

## Task 3: TCGdex fetch + normalise

**Files:**
- Create: `src/data/fetch.ts`
- Create: `src/data/normalise.ts`
- Create: `tests/unit/normalise.test.ts`
- Create: `data/fixtures/sample-cards.json`

- [ ] **Step 1: Install the TCGdex SDK**

```bash
npm install @tcgdex/sdk
```

- [ ] **Step 2: Create checked-in fixture `data/fixtures/sample-cards.json`**

This fixture represents what TCGdex returns for a handful of cards across four languages. Checked in so tests never hit the network. Paste exactly:

```json
{
  "en": [
    { "id": "base1-4", "localId": "4", "name": "Charizard", "image": "https://assets.tcgdex.net/en/base/base1/4", "set": { "id": "base1", "name": "Base", "symbol": "https://assets.tcgdex.net/en/base/base1/symbol", "serie": { "id": "base", "name": "Base" }, "releaseDate": "1999-01-09" }, "rarity": "Holo Rare", "hp": 120, "types": ["Fire"], "attacks": [], "illustrator": "Mitsuhiro Arita", "description": "Spits fire that is hot enough to melt boulders." },
    { "id": "base1-2", "localId": "2", "name": "Blastoise", "image": "https://assets.tcgdex.net/en/base/base1/2", "set": { "id": "base1", "name": "Base", "symbol": "https://assets.tcgdex.net/en/base/base1/symbol", "serie": { "id": "base", "name": "Base" }, "releaseDate": "1999-01-09" }, "rarity": "Holo Rare", "hp": 100, "types": ["Water"], "attacks": [], "illustrator": "Ken Sugimori", "description": null }
  ],
  "ja": [
    { "id": "base1-4", "localId": "4", "name": "リザードン", "image": "https://assets.tcgdex.net/ja/base/base1/4", "set": { "id": "base1", "name": "拡張パック", "symbol": "https://assets.tcgdex.net/ja/base/base1/symbol", "serie": { "id": "base", "name": "Base" }, "releaseDate": "1996-10-20" }, "rarity": "Holo Rare", "hp": 120, "types": ["Fire"], "attacks": [], "illustrator": "Mitsuhiro Arita", "description": null }
  ],
  "ko": [
    { "id": "base1-4", "localId": "4", "name": "리자몽", "image": "https://assets.tcgdex.net/ko/base/base1/4", "set": { "id": "base1", "name": "베이스", "symbol": "https://assets.tcgdex.net/ko/base/base1/symbol", "serie": { "id": "base", "name": "Base" }, "releaseDate": "1999-10-20" }, "rarity": "Holo Rare", "hp": 120, "types": ["Fire"], "attacks": [], "illustrator": "Mitsuhiro Arita", "description": null }
  ],
  "zh": [
    { "id": "base1-4", "localId": "4", "name": "喷火龙", "image": "https://assets.tcgdex.net/zh-tw/base/base1/4", "set": { "id": "base1", "name": "基本系列", "symbol": "https://assets.tcgdex.net/zh-tw/base/base1/symbol", "serie": { "id": "base", "name": "Base" }, "releaseDate": "2000-03-01" }, "rarity": "Holo Rare", "hp": 120, "types": ["Fire"], "attacks": [], "illustrator": "Mitsuhiro Arita", "description": null }
  ]
}
```

- [ ] **Step 3: Write failing tests — `tests/unit/normalise.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalise } from '@/data/normalise';
import { CardIdentityArraySchema } from '@/data/schema';

const fixture = JSON.parse(
  readFileSync(new URL('../../data/fixtures/sample-cards.json', import.meta.url), 'utf8'),
);

describe('normalise', () => {
  it('merges the four language dumps into one identity per card', () => {
    const result = normalise(fixture);
    expect(result).toHaveLength(2);
    const charizard = result.find((c) => c.id === 'base1-4')!;
    expect(Object.keys(charizard.prints).sort()).toEqual(['en', 'ja', 'ko', 'zh']);
  });

  it('includes cards that only exist in one language', () => {
    const result = normalise(fixture);
    const blastoise = result.find((c) => c.id === 'base1-2')!;
    expect(blastoise).toBeDefined();
    expect(Object.keys(blastoise.prints)).toEqual(['en']);
  });

  it('builds multilingual search tokens', () => {
    const result = normalise(fixture);
    const charizard = result.find((c) => c.id === 'base1-4')!;
    expect(charizard.searchTokens).toEqual(
      expect.arrayContaining(['Charizard', 'リザードン', '리자몽', '喷火龙']),
    );
  });

  it('uses English name as defaultName when available', () => {
    const result = normalise(fixture);
    expect(result.find((c) => c.id === 'base1-4')!.defaultName).toBe('Charizard');
  });

  it('falls back to Japanese defaultName when no English print exists', () => {
    const jpOnly = {
      en: [],
      ja: [fixture.ja[0]],
      ko: [],
      zh: [],
    };
    const result = normalise(jpOnly);
    expect(result[0].defaultName).toBe('リザードン');
  });

  it('produces output that passes schema validation', () => {
    const result = normalise(fixture);
    expect(() => CardIdentityArraySchema.parse(result)).not.toThrow();
  });

  it('appends /high.webp to bare image URLs', () => {
    const result = normalise(fixture);
    const charizard = result.find((c) => c.id === 'base1-4')!;
    expect(charizard.prints.en!.imageURL).toBe(
      'https://assets.tcgdex.net/en/base/base1/4/high.webp',
    );
  });
});
```

- [ ] **Step 4: Run tests and confirm they fail**

Run: `npm run test:unit`
Expected: normalise tests fail with "Cannot find module '@/data/normalise'".

- [ ] **Step 5: Implement `src/data/normalise.ts`**

```ts
import type { CardIdentity, PrintData, Language } from './schema';
import { SUPPORTED_LANGUAGES } from './schema';

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
  rarity: string | null;
  hp: number | null;
  types?: string[];
  attacks?: Array<{ name: string; cost?: string[]; damage?: string | number; effect?: string | null }>;
  illustrator: string | null;
  description: string | null;
};

export type RawDumps = Record<Language, RawCard[]>;

function toImageURL(base: string | null): string {
  if (!base) return '';
  return `${base}/high.webp`;
}

function toPrint(raw: RawCard): PrintData {
  return {
    name: raw.name,
    setName: raw.set.name,
    setSymbol: raw.set.symbol ? `${raw.set.symbol}.png` : '',
    rarity: raw.rarity ?? 'Unknown',
    hp: raw.hp ?? null,
    types: raw.types ?? [],
    attacks: (raw.attacks ?? []).map((a) => ({
      name: a.name,
      cost: a.cost ?? [],
      damage: a.damage != null ? String(a.damage) : '',
      text: a.effect ?? null,
    })),
    artist: raw.illustrator ?? 'Unknown',
    imageURL: toImageURL(raw.image),
    releaseDate: raw.set.releaseDate,
    flavorText: raw.description,
  };
}

function pickDefaultName(prints: Partial<Record<Language, PrintData>>): string {
  const preference: Language[] = ['en', 'ja', 'ko', 'zh'];
  for (const lang of preference) {
    const p = prints[lang];
    if (p) return p.name;
  }
  throw new Error('normalise: card has no prints — invariant violated');
}

export function normalise(dumps: RawDumps): CardIdentity[] {
  const byId = new Map<string, {
    prints: Partial<Record<Language, PrintData>>;
    filters: CardIdentity['filters'];
  }>();

  for (const lang of SUPPORTED_LANGUAGES) {
    for (const raw of dumps[lang] ?? []) {
      const existing = byId.get(raw.id);
      const print = toPrint(raw);
      if (!existing) {
        byId.set(raw.id, {
          prints: { [lang]: print },
          filters: {
            setId: raw.set.id,
            rarity: raw.rarity ?? 'Unknown',
            types: raw.types ?? [],
            series: raw.set.serie.id,
          },
        });
      } else {
        existing.prints[lang] = print;
      }
    }
  }

  return Array.from(byId.entries()).map(([id, { prints, filters }]) => ({
    id,
    defaultName: pickDefaultName(prints),
    prints,
    searchTokens: Object.values(prints)
      .map((p) => p!.name)
      .filter((n): n is string => !!n),
    filters,
  }));
}
```

- [ ] **Step 6: Run tests and verify they pass**

Run: `npm run test:unit`
Expected: all normalise tests pass. Schema tests still pass.

- [ ] **Step 7: Implement `src/data/fetch.ts` — wraps TCGdex SDK**

```ts
import TCGdex from '@tcgdex/sdk';
import type { Language } from './schema';
import { SUPPORTED_LANGUAGES } from './schema';
import type { RawDumps } from './normalise';

const SDK_LANG_MAP: Record<Language, string> = {
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  zh: 'zh-tw',
};

export async function fetchAllLanguages(): Promise<RawDumps> {
  const entries = await Promise.all(
    SUPPORTED_LANGUAGES.map(async (lang) => {
      const tcgdex = new TCGdex(SDK_LANG_MAP[lang] as never);
      const summaries = await tcgdex.fetch('cards');
      if (!summaries || summaries.length === 0) {
        throw new Error(`fetchAllLanguages: ${lang} returned zero cards (API outage or schema drift?)`);
      }
      const full = await Promise.all(summaries.map((s) => tcgdex.fetch('cards', s.id)));
      return [lang, full.filter((x): x is NonNullable<typeof x> => x !== null)] as const;
    }),
  );
  return Object.fromEntries(entries) as RawDumps;
}
```

- [ ] **Step 8: Typecheck + full test run**

```bash
npm run typecheck
npm run test:unit
```

Both should pass. The fetch function isn't unit-tested (it hits the network); it'll be exercised in Task 5 via the build script.

- [ ] **Step 9: Commit**

```bash
git add src/data/normalise.ts src/data/fetch.ts tests/unit/normalise.test.ts data/fixtures/sample-cards.json package.json package-lock.json
git commit -m "feat(data): fetch and normalise TCGdex multilingual card data"
```

---

## Task 4: Build-time data pipeline script

**Files:**
- Create: `scripts/fetch-and-build-data.ts`
- Create: `src/lib/build-meta.ts`
- Modify: `package.json` (add tsx)

- [ ] **Step 1: Install tsx**

```bash
npm install --save-dev tsx
```

- [ ] **Step 2: Create `src/lib/build-meta.ts`**

```ts
export const BUILD_TIMESTAMP: string = import.meta.env.PUBLIC_BUILD_TIMESTAMP ?? new Date().toISOString();
```

- [ ] **Step 3: Create `scripts/fetch-and-build-data.ts`**

```ts
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchAllLanguages } from '../src/data/fetch.ts';
import { normalise, type RawDumps } from '../src/data/normalise.ts';
import { CardIdentityArraySchema } from '../src/data/schema.ts';

const USE_FIXTURES = process.env.FIXTURES === '1';
const OUT_DIR = resolve(import.meta.dirname, '..', 'data');
const OUT_FILE = resolve(OUT_DIR, 'cards.json');

async function main() {
  const start = Date.now();
  console.log(USE_FIXTURES ? 'Loading fixture dumps...' : 'Fetching TCGdex dumps for 4 languages...');

  let dumps: RawDumps;
  if (USE_FIXTURES) {
    dumps = JSON.parse(
      readFileSync(resolve(OUT_DIR, 'fixtures', 'sample-cards.json'), 'utf8'),
    );
  } else {
    dumps = await fetchAllLanguages();
  }

  console.log('Normalising...');
  const identities = normalise(dumps);

  console.log('Validating schema...');
  CardIdentityArraySchema.parse(identities);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(identities));

  const secs = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Wrote ${identities.length} card identities to data/cards.json in ${secs}s`);
}

main().catch((err) => {
  console.error('Data build failed:', err);
  process.exit(1);
});
```

- [ ] **Step 4: Run with fixtures to confirm script works end-to-end**

```bash
FIXTURES=1 npx tsx scripts/fetch-and-build-data.ts
```

Expected output:
```
Loading fixture dumps...
Normalising...
Validating schema...
Wrote 2 card identities to data/cards.json in 0.0s
```

Confirm `data/cards.json` exists and parses as an array of 2 items: `node -e "console.log(JSON.parse(require('fs').readFileSync('data/cards.json')).length)"` → prints `2`.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-and-build-data.ts src/lib/build-meta.ts package.json package-lock.json
git commit -m "feat(build): add fetch+normalise build script with FIXTURES mode"
```

---

## Task 5: Dynamic card detail pages

**Files:**
- Create: `src/pages/card/[id].astro`
- Create: `src/components/PrintGallery.astro`
- Create: `tests/e2e/card-page.spec.ts`
- Create: `playwright.config.ts`

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:4321/pokemon-tcg',
  },
  webServer: {
    command: 'npm run build:fixtures && npm run preview',
    url: 'http://localhost:4321/pokemon-tcg',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

- [ ] **Step 3: Create `src/components/PrintGallery.astro`**

```astro
---
import type { CardIdentity } from '@/data/schema';
interface Props { card: CardIdentity }
const { card } = Astro.props;
const printEntries = Object.entries(card.prints) as Array<[string, NonNullable<typeof card.prints.en>]>;
---
<section class="print-gallery" data-card-id={card.id}>
  {printEntries.map(([lang, print]) => (
    <figure class="print">
      <span class="lang-label">{lang.toUpperCase()}</span>
      {print.imageURL ? (
        <img src={print.imageURL} alt={print.name} loading="lazy" />
      ) : (
        <div class="image-placeholder">{card.id}</div>
      )}
      <figcaption>{print.name}</figcaption>
    </figure>
  ))}
</section>

<style>
  .print-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 1rem;
  }
  .print { margin: 0; text-align: center; }
  .print img { width: 100%; height: auto; border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.12); }
  .lang-label { font-size: 0.75rem; letter-spacing: 2px; color: #7a5e3a; }
  .image-placeholder { aspect-ratio: 2/3; background: #eee; display: grid; place-items: center; border-radius: 10px; }
  figcaption { margin-top: 0.5rem; font-weight: 600; }
</style>
```

- [ ] **Step 4: Create `src/pages/card/[id].astro`**

```astro
---
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Base from '@/layouts/Base.astro';
import PrintGallery from '@/components/PrintGallery.astro';
import type { CardIdentity } from '@/data/schema';

export async function getStaticPaths() {
  const cards: CardIdentity[] = JSON.parse(
    readFileSync(resolve(process.cwd(), 'data/cards.json'), 'utf8'),
  );
  return cards.map((card) => ({ params: { id: card.id }, props: { card } }));
}

interface Props { card: CardIdentity }
const { card } = Astro.props;
---
<Base title={`${card.defaultName} — Pokémon TCG Catalog`}>
  <article>
    <h1>{card.defaultName}</h1>
    <PrintGallery card={card} />
    <aside>
      <p>Set: {card.filters.setId}</p>
      <p>Rarity: {card.filters.rarity}</p>
      <p>Types: {card.filters.types.join(', ') || '—'}</p>
    </aside>
  </article>
</Base>
```

- [ ] **Step 5: Write e2e test — `tests/e2e/card-page.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('card page renders all four regional prints for base1-4', async ({ page }) => {
  await page.goto('/card/base1-4');
  await expect(page.locator('h1')).toHaveText('Charizard');

  const gallery = page.locator('.print-gallery');
  await expect(gallery.locator('.print')).toHaveCount(4);
  await expect(gallery.locator('.lang-label')).toHaveText(['EN', 'JA', 'KO', 'ZH']);
  await expect(gallery.getByText('リザードン')).toBeVisible();
  await expect(gallery.getByText('리자몽')).toBeVisible();
  await expect(gallery.getByText('喷火龙')).toBeVisible();
});

test('card page renders a single print when only one exists (Blastoise)', async ({ page }) => {
  await page.goto('/card/base1-2');
  await expect(page.locator('h1')).toHaveText('Blastoise');
  await expect(page.locator('.print-gallery .print')).toHaveCount(1);
});
```

- [ ] **Step 6: Run e2e test**

```bash
npm run test:e2e
```

Expected: both tests pass. Playwright will auto-start `build:fixtures` then `preview`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/card src/components/PrintGallery.astro tests/e2e/card-page.spec.ts playwright.config.ts package.json package-lock.json
git commit -m "feat(pages): dynamic card detail pages with multi-region print gallery"
```

---

## Task 6: Home page and site chrome

**Files:**
- Create: `src/components/Disclaimer.astro`
- Create: `src/components/CardTile.astro`
- Modify: `src/layouts/Base.astro`
- Modify: `src/pages/index.astro`
- Create: `tests/e2e/home.spec.ts`

- [ ] **Step 1: Create `src/components/Disclaimer.astro`**

```astro
---
import { BUILD_TIMESTAMP } from '@/lib/build-meta';
---
<footer class="disclaimer">
  <p>
    Catalog data via <a href="https://tcgdex.dev" target="_blank" rel="noopener">TCGdex</a> (open source).
    Card images © The Pokémon Company. Translation and print data may contain inaccuracies — verify with TCGdex before acting on it.
  </p>
  <p class="build-stamp">Data last built: <time datetime={BUILD_TIMESTAMP}>{BUILD_TIMESTAMP}</time></p>
</footer>

<style>
  .disclaimer {
    margin-top: 4rem;
    padding: 1.5rem;
    border-top: 1px solid #e8ddc6;
    background: #f5efe2;
    color: #5a4a36;
    font-size: 0.85rem;
    text-align: center;
  }
  .disclaimer a { color: #7a5e3a; text-decoration: underline; }
  .build-stamp { opacity: 0.7; margin-top: 0.5rem; }
</style>
```

- [ ] **Step 2: Create `src/components/CardTile.astro`**

```astro
---
import type { CardIdentity } from '@/data/schema';
interface Props { card: CardIdentity }
const { card } = Astro.props;
const preferredPrint = card.prints.en ?? card.prints.ja ?? card.prints.ko ?? card.prints.zh!;
---
<a class="card-tile" href={`/pokemon-tcg/card/${card.id}`}>
  {preferredPrint.imageURL ? (
    <img src={preferredPrint.imageURL} alt={card.defaultName} loading="lazy" />
  ) : (
    <div class="placeholder">{card.id}</div>
  )}
  <div class="caption">
    <strong>{card.defaultName}</strong>
    <span>{card.filters.setId} · {card.filters.rarity}</span>
  </div>
</a>

<style>
  .card-tile {
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: inherit;
    transition: transform 150ms ease;
  }
  .card-tile:hover { transform: translateY(-3px); }
  .card-tile img { width: 100%; border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.1); }
  .placeholder { aspect-ratio: 2/3; background: #eee; display: grid; place-items: center; border-radius: 10px; }
  .caption { margin-top: 0.5rem; font-size: 0.9rem; }
  .caption span { display: block; color: #7a5e3a; font-size: 0.8rem; }
</style>
```

- [ ] **Step 3: Rewrite `src/layouts/Base.astro` to include global styles and footer**

```astro
---
import Disclaimer from '@/components/Disclaimer.astro';
interface Props { title: string; description?: string }
const { title, description = 'Pokémon TCG multilingual catalog' } = Astro.props;
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
      main { max-width: 1100px; margin: 0 auto; padding: 2rem 1rem; }
      h1 { font-weight: 600; letter-spacing: -0.5px; }
      a { color: var(--accent); }
    </style>
  </head>
  <body>
    <main><slot /></main>
    <Disclaimer />
  </body>
</html>
```

- [ ] **Step 4: Rewrite `src/pages/index.astro`**

```astro
---
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Base from '@/layouts/Base.astro';
import CardTile from '@/components/CardTile.astro';
import type { CardIdentity } from '@/data/schema';

const cards: CardIdentity[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/cards.json'), 'utf8'),
);
const featured = cards.slice(0, 6);
---
<Base title="Pokémon TCG Catalog">
  <header class="hero">
    <h1>Pokémon TCG Catalog</h1>
    <p class="tagline">Every regional print, on every card, in every language.</p>
    <form action="/pokemon-tcg/search" method="get" class="search-stub">
      <input type="search" name="q" placeholder="Search any card name in EN / JA / KO / ZH…" />
      <button type="submit">Search</button>
    </form>
  </header>

  <section>
    <h2>Featured cards</h2>
    <div class="grid">
      {featured.map((card) => <CardTile card={card} />)}
    </div>
  </section>
</Base>

<style>
  .hero { text-align: center; margin-bottom: 3rem; }
  .tagline { color: var(--muted); font-size: 1.1rem; }
  .search-stub { margin-top: 1.5rem; display: inline-flex; gap: 0.5rem; }
  .search-stub input {
    padding: 0.75rem 1rem; border-radius: 999px; border: 1px solid #d9c9a3;
    width: min(500px, 70vw); background: var(--paper);
  }
  .search-stub button {
    padding: 0.75rem 1.5rem; border-radius: 999px; border: 0;
    background: var(--accent); color: white; cursor: pointer;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1.5rem; }
</style>
```

- [ ] **Step 5: Write e2e test — `tests/e2e/home.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('home page renders hero and featured grid', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Pokémon TCG Catalog');
  await expect(page.locator('.grid .card-tile')).toHaveCount(2); // fixtures have 2 cards
});

test('footer shows TCGdex credit and build timestamp', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer.disclaimer');
  await expect(footer).toContainText('TCGdex');
  await expect(footer).toContainText('© The Pokémon Company');
  await expect(footer.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
});
```

- [ ] **Step 6: Run e2e tests**

```bash
npm run test:e2e
```

Expected: home + card-page tests all pass (4 tests total).

- [ ] **Step 7: Commit**

```bash
git add src/components src/layouts src/pages/index.astro tests/e2e/home.spec.ts
git commit -m "feat(ui): home page with featured grid, shared layout, footer disclaimer"
```

---

## Task 7: Search with Pagefind

**Files:**
- Create: `src/pages/search.astro`
- Create: `src/components/SearchBox.tsx`
- Create: `tests/e2e/search.spec.ts`
- Modify: `package.json` (pagefind)

- [ ] **Step 1: Install Pagefind**

```bash
npm install --save-dev pagefind
```

- [ ] **Step 2: Create `src/components/SearchBox.tsx` (Preact island)**

```tsx
import { useState, useEffect, useRef } from 'preact/hooks';

type PagefindResult = {
  id: string;
  url: string;
  excerpt: string;
  meta: { title?: string };
};

type Pagefind = {
  search: (q: string) => Promise<{ results: Array<{ id: string; data: () => Promise<PagefindResult> }> }>;
};

declare global { interface Window { pagefind?: Pagefind } }

export default function SearchBox({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<PagefindResult[]>([]);
  const pagefindRef = useRef<Pagefind | null>(null);

  useEffect(() => {
    (async () => {
      if (!window.pagefind) {
        window.pagefind = await import(/* @vite-ignore */ '/pokemon-tcg/pagefind/pagefind.js') as unknown as Pagefind;
      }
      pagefindRef.current = window.pagefind;
      if (initialQuery) handleSearch(initialQuery);
    })();
  }, []);

  async function handleSearch(q: string) {
    if (!pagefindRef.current || q.length < 2) { setResults([]); return; }
    const raw = await pagefindRef.current.search(q);
    const data = await Promise.all(raw.results.slice(0, 20).map((r) => r.data()));
    setResults(data);
  }

  return (
    <div>
      <input
        type="search"
        value={query}
        placeholder="Search any card name…"
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setQuery(v);
          handleSearch(v);
        }}
        style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 999, border: '1px solid #d9c9a3', background: '#fffdf6' }}
      />
      <ul style={{ listStyle: 'none', padding: 0, marginTop: '1rem' }}>
        {results.map((r) => (
          <li key={r.id} style={{ marginBottom: '0.75rem' }}>
            <a href={r.url} style={{ color: '#3b2a1a', textDecoration: 'none' }}>
              <strong>{r.meta.title ?? r.url}</strong>
              <div style={{ color: '#7a5e3a', fontSize: '0.9rem' }} dangerouslySetInnerHTML={{ __html: r.excerpt }} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/pages/search.astro`**

```astro
---
import Base from '@/layouts/Base.astro';
import SearchBox from '@/components/SearchBox';
const q = new URL(Astro.request.url).searchParams.get('q') ?? '';
---
<Base title={`Search — Pokémon TCG Catalog`}>
  <h1>Search</h1>
  <SearchBox client:load initialQuery={q} />
</Base>
```

- [ ] **Step 4: Make card pages indexable by Pagefind**

Modify `src/pages/card/[id].astro` — add `data-pagefind-body` attribute to the article and a `data-pagefind-meta` for the title. Replace the `<article>` opening tag with:

```astro
<article data-pagefind-body data-pagefind-meta={`title:${card.defaultName}`}>
```

Also add tokens so JP/KO/ZH names are indexed — add this hidden block inside the article, after `<PrintGallery>`:

```astro
<div style="position:absolute;left:-9999px" aria-hidden="true">
  {card.searchTokens.join(' ')}
</div>
```

- [ ] **Step 5: Verify Pagefind build step is in `npm run build`**

Confirm `package.json` scripts include `&& pagefind --site dist`. (Added in Task 1 step 2.) If missing, add it now.

- [ ] **Step 6: Write e2e test — `tests/e2e/search.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('searching "Charizard" finds base1-4', async ({ page }) => {
  await page.goto('/search');
  await page.fill('input[type=search]', 'Charizard');
  await expect(page.locator('ul a[href*="/card/base1-4"]')).toBeVisible();
});

test('searching in Japanese "リザードン" finds base1-4', async ({ page }) => {
  await page.goto('/search');
  await page.fill('input[type=search]', 'リザードン');
  await expect(page.locator('ul a[href*="/card/base1-4"]')).toBeVisible();
});

test('searching in Korean "리자몽" finds base1-4', async ({ page }) => {
  await page.goto('/search');
  await page.fill('input[type=search]', '리자몽');
  await expect(page.locator('ul a[href*="/card/base1-4"]')).toBeVisible();
});

test('searching in Chinese "喷火龙" finds base1-4', async ({ page }) => {
  await page.goto('/search');
  await page.fill('input[type=search]', '喷火龙');
  await expect(page.locator('ul a[href*="/card/base1-4"]')).toBeVisible();
});
```

- [ ] **Step 7: Run tests**

```bash
npm run test:e2e
```

Expected: all 8 e2e tests pass (home + card-page + 4 new search tests).

- [ ] **Step 8: Commit**

```bash
git add src/components/SearchBox.tsx src/pages/search.astro src/pages/card tests/e2e/search.spec.ts package.json package-lock.json
git commit -m "feat(search): multilingual Pagefind search with JP/KO/ZH tokenisation"
```

---

## Task 8: Faceted filters on search page

**Files:**
- Create: `src/components/FacetSidebar.tsx`
- Modify: `src/pages/search.astro`
- Modify: `tests/e2e/search.spec.ts`

- [ ] **Step 1: Create `src/components/FacetSidebar.tsx`**

```tsx
import { useState, useEffect } from 'preact/hooks';
import type { CardIdentity } from '@/data/schema';

type Filters = { set?: string; type?: string; rarity?: string; series?: string };

export default function FacetSidebar({ cards, onFilter }: { cards: CardIdentity[]; onFilter: (cards: CardIdentity[]) => void }) {
  const [filters, setFilters] = useState<Filters>({});

  const sets = Array.from(new Set(cards.map((c) => c.filters.setId))).sort();
  const types = Array.from(new Set(cards.flatMap((c) => c.filters.types))).sort();
  const rarities = Array.from(new Set(cards.map((c) => c.filters.rarity))).sort();
  const serieses = Array.from(new Set(cards.map((c) => c.filters.series))).sort();

  useEffect(() => {
    const filtered = cards.filter((c) => {
      if (filters.set && c.filters.setId !== filters.set) return false;
      if (filters.type && !c.filters.types.includes(filters.type)) return false;
      if (filters.rarity && c.filters.rarity !== filters.rarity) return false;
      if (filters.series && c.filters.series !== filters.series) return false;
      return true;
    });
    onFilter(filtered);
  }, [filters]);

  function renderFacet(label: string, key: keyof Filters, values: string[]) {
    return (
      <section style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.8rem', letterSpacing: 2, textTransform: 'uppercase', color: '#7a5e3a' }}>{label}</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {values.map((v) => (
            <li key={v}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0' }}>
                <input
                  type="radio"
                  name={key}
                  checked={filters[key] === v}
                  onChange={() => setFilters({ ...filters, [key]: v })}
                />
                {v}
              </label>
            </li>
          ))}
        </ul>
        {filters[key] && (
          <button onClick={() => setFilters({ ...filters, [key]: undefined })} style={{ fontSize: '0.8rem', color: '#c86f3d', background: 'none', border: 0, cursor: 'pointer' }}>
            Clear {label}
          </button>
        )}
      </section>
    );
  }

  return (
    <aside style={{ borderRight: '1px solid #e8ddc6', paddingRight: '1.5rem' }}>
      {renderFacet('Set', 'set', sets)}
      {renderFacet('Type', 'type', types)}
      {renderFacet('Rarity', 'rarity', rarities)}
      {renderFacet('Series', 'series', serieses)}
    </aside>
  );
}
```

- [ ] **Step 2: Update `src/pages/search.astro` to wire facets + results**

```astro
---
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Base from '@/layouts/Base.astro';
import SearchBox from '@/components/SearchBox';
import FacetSidebar from '@/components/FacetSidebar';
import CardTile from '@/components/CardTile.astro';
import type { CardIdentity } from '@/data/schema';

const cards: CardIdentity[] = JSON.parse(
  readFileSync(resolve(process.cwd(), 'data/cards.json'), 'utf8'),
);
const q = new URL(Astro.request.url).searchParams.get('q') ?? '';
---
<Base title={`Search — Pokémon TCG Catalog`}>
  <h1>Search</h1>
  <SearchBox client:load initialQuery={q} />

  <div style="display:grid;grid-template-columns:220px 1fr;gap:2rem;margin-top:2rem;">
    <FacetSidebar client:load cards={cards} onFilter={(filtered) => {
      document.querySelectorAll('[data-card-tile]').forEach((el) => {
        const id = el.getAttribute('data-card-id');
        (el as HTMLElement).style.display = filtered.some((c: CardIdentity) => c.id === id) ? '' : 'none';
      });
      document.querySelector('[data-result-count]')!.textContent = String(filtered.length);
    }} />
    <div>
      <p><span data-result-count>{cards.length}</span> cards</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1.5rem;">
        {cards.map((card) => (
          <div data-card-tile data-card-id={card.id}>
            <CardTile card={card} />
          </div>
        ))}
      </div>
    </div>
  </div>
</Base>
```

- [ ] **Step 3: Add facet e2e test — append to `tests/e2e/search.spec.ts`**

```ts
test('filtering by Type=Water narrows results to Blastoise', async ({ page }) => {
  await page.goto('/search');
  await page.locator('input[type=radio][name=type][value="Water"]').check();
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await expect(page.locator('[data-card-tile]:visible')).toContainText('Blastoise');
});

test('clearing a facet restores all results', async ({ page }) => {
  await page.goto('/search');
  await page.locator('input[type=radio][name=type][value="Water"]').check();
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(1);
  await page.getByRole('button', { name: /Clear Type/i }).click();
  await expect(page.locator('[data-card-tile]:visible')).toHaveCount(2);
});
```

- [ ] **Step 4: Run e2e tests**

```bash
npm run test:e2e
```

Expected: all tests pass (10 total).

- [ ] **Step 5: Commit**

```bash
git add src/components/FacetSidebar.tsx src/pages/search.astro tests/e2e/search.spec.ts
git commit -m "feat(search): faceted filters for Set/Type/Rarity/Series"
```

---

## Task 9: Fixed-query sanity tests

**Files:**
- Create: `tests/unit/search-sanity.test.ts`

- [ ] **Step 1: Write sanity test — `tests/unit/search-sanity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalise } from '@/data/normalise';

const fixture = JSON.parse(
  readFileSync(new URL('../../data/fixtures/sample-cards.json', import.meta.url), 'utf8'),
);
const cards = normalise(fixture);

type Query = { q: string; expectedId: string; description: string };

const queries: Query[] = [
  { q: 'Charizard', expectedId: 'base1-4', description: 'English exact match' },
  { q: 'リザードン', expectedId: 'base1-4', description: 'Japanese exact match' },
  { q: '리자몽', expectedId: 'base1-4', description: 'Korean exact match' },
  { q: '喷火龙', expectedId: 'base1-4', description: 'Chinese Simplified exact match' },
  { q: 'Blastoise', expectedId: 'base1-2', description: 'English, single-language card' },
];

describe('search sanity — fixed query list', () => {
  for (const { q, expectedId, description } of queries) {
    it(`resolves "${q}" to ${expectedId} (${description})`, () => {
      const match = cards.find((c) => c.searchTokens.some((t) => t === q));
      expect(match?.id).toBe(expectedId);
    });
  }
});
```

- [ ] **Step 2: Run unit tests**

```bash
npm run test:unit
```

Expected: all unit tests pass (schema + normalise + 5 search-sanity = 16 total).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/search-sanity.test.ts
git commit -m "test: fixed-query sanity tests for multilingual search"
```

---

## Task 10: GitHub Actions CI + deployment

**Files:**
- Create: `.github/workflows/build.yml`

- [ ] **Step 1: Create `.github/workflows/build.yml`**

```yaml
name: build-and-deploy

on:
  schedule:
    - cron: '0 2 * * *'        # 02:00 UTC nightly
  workflow_dispatch: {}         # manual trigger for "new set just dropped"
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
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

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/deploy-pages@v4
        id: deployment
```

- [ ] **Step 2: Verify workflow syntax locally (optional but recommended)**

If you have `actionlint` installed: `actionlint .github/workflows/build.yml`. Otherwise push and check the first run.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: nightly rebuild + deploy to GitHub Pages"
```

---

## Task 11: README and end-to-end smoke test

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
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
```

- [ ] **Step 2: Full smoke test — fixtures build**

```bash
npm run build:fixtures
npm run preview
```

Open http://localhost:4321/pokemon-tcg in a browser and verify by hand:
- Home page renders with 2 featured cards
- Click on Charizard: card page shows 4 regional prints (EN, JA, KO, ZH)
- Click on Blastoise: card page shows 1 print (EN)
- Navigate to /pokemon-tcg/search, type "リザードン" — result links to base1-4
- Apply Type=Water facet on search page, only Blastoise remains
- Footer disclaimer visible on every page with TCGdex link and build timestamp

Stop the preview (Ctrl-C).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with dev/test instructions and data-source credits"
```

- [ ] **Step 4: Push to GitHub and enable Pages**

```bash
# Assumes the user has already created the remote repo via `gh repo create`
# or via the GitHub UI.
git push -u origin main
```

On GitHub: Settings → Pages → Source = "GitHub Actions". Then in the Actions tab, manually trigger the `build-and-deploy` workflow.

- [ ] **Step 5: Verify deployment**

After the workflow completes (5–15 minutes, mostly the full TCGdex fetch), the site URL appears in the workflow summary. Open it, confirm the catalog loads, search works, and the build timestamp in the footer reflects the deploy time.

- [ ] **Step 6: Final commit (only if any tweaks were needed post-deploy)**

No commit here unless something broke and required a fix.

---

## Self-review checklist (done by writer before handoff)

**Spec coverage:**

| Spec §  | Covered in task(s) |
| ------- | ------------------ |
| §1–2 Vision & scope | Implicit throughout |
| §3 Architecture     | Task 1 (scaffolding), Task 10 (CI/CD) |
| §4 Data pipeline    | Task 3 (fetch), Task 4 (build script), Task 10 (nightly cron) |
| §5 Schema           | Task 2 |
| §6 Pages            | Task 5 (card detail), Task 6 (home), Task 7–8 (search) |
| §7 Multi-language   | Task 3 (merge), Task 7 (search tokens), Task 9 (sanity tests) |
| §8 Visual direction | Task 6 (base palette, collector-binder feel in CardTile + PrintGallery) |
| §9 Error handling   | Task 3 (zero-card outage in fetch), Task 2 (schema validation), Task 4 (build-fail propagation) |
| §10 v2 pathway      | Not implemented (informational only in spec) — correct. |
| §11 Disclaimers     | Task 6 (Disclaimer component) |
| §12 Testing         | Task 2/3/9 (unit), Task 5–8 (e2e), Task 10 (CI runs them) |

**Placeholder scan:** no "TBD", "TODO", or "similar to Task N" shortcuts. Every step shows real code or real commands.

**Type consistency:** `CardIdentity`, `PrintData`, `Language` are defined in `schema.ts` (Task 2) and imported identically in every subsequent task. `normalise` (Task 3) returns `CardIdentity[]`; the build script (Task 4), card page (Task 5), home (Task 6), search (Task 7–8), and sanity tests (Task 9) all consume the same type.

**One known risk** worth flagging to the executor: the TCGdex SDK shape in Task 3 step 7 (`tcgdex.fetch('cards')` returning summaries, then re-fetching each by id) is based on the SDK's published behavior. If the SDK shape has changed, Task 3's fetch code is the place to adjust — subsequent tasks consume only the normalised output and are decoupled.

---

## Estimated effort

| Task | Effort |
| ---- | ------ |
| 1 Scaffolding | 30 min |
| 2 Schema | 45 min |
| 3 Fetch + normalise | 90 min |
| 4 Build script | 30 min |
| 5 Card pages | 60 min |
| 6 Home + chrome | 60 min |
| 7 Search (Pagefind) | 90 min |
| 8 Facets | 60 min |
| 9 Sanity tests | 20 min |
| 10 CI/CD | 30 min |
| 11 README + smoke | 30 min |
| **Total** | **~9 hours** |

Realistically 1.5–2 working days with debugging, real TCGdex API exploration, and visual polish iteration.
