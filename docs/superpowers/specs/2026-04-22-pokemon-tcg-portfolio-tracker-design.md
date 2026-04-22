# Portfolio Tracker — Design

**Date:** 2026-04-22
**Status:** Approved (brainstorming → implementation-ready)
**Scope:** Client-side "my cards" tracker. Users add owned cards with quantity + cost basis; the `/portfolio/` page shows a summary dashboard (cards, paid, current value, P&L), a 30-day portfolio-value trend chart, an autocomplete add-form, a holdings table, and export/import for backup. Card detail pages gain an inline "Add to my cards" button. Default display currency switches from EUR to GBP, supporting per-entry cost currency for international users.

**Builds on:** v2.1 currency switcher + exchange rates (`src/components/CurrencySelect.tsx`, `data/exchange-rates.json`), v2.1 sparkline Worker endpoint (`pokemon-tcg-history-api.david-taylor-pokemon.workers.dev/sparkline-dump`), Hot Cards' inline-SVG sparkline pattern, the `SupportedCurrency` type (`src/data/currency-schema.ts`), Pagefind multilingual search index.

## 1. Problem & goal

The catalog tells you what a card is worth *today*. It doesn't tell you what *your* cards are worth. A collector who owns 40 cards across 10 sets currently has to open each card page, read the price, and do mental arithmetic. This spec adds a self-service tracker: a personal "my cards" list stored in the browser, with running totals and a 30-day value trend.

**Success criteria:**
- A user with an empty collection can add a card via the card-page button in <5 s.
- Total portfolio value is accurate to today's Cardmarket trend × their chosen display currency.
- A UK user sees GBP by default and never has to think about FX conversions.
- An international user can enter a USD-priced purchase from 2024 and a GBP-priced purchase from 2025 and see both correctly represented.
- A power user can back up their collection via JSON export and restore from import.

## 2. Architecture

Data storage is **client-side localStorage only**. No new server schema, no accounts, no sync.

```
localStorage['pokemon-tcg:portfolio']           ← source of truth (JSON)
       ↓
  PortfolioDashboard (Preact island on /portfolio/)
       ├─ summary stats    (compute from entries + sparkline + rates)
       ├─ 30-day trend     (sum series across owned cards, convert currency)
       ├─ add form         (Pagefind autocomplete)
       ├─ holdings table   (edit qty/cost inline, remove, per-row P&L)
       └─ export/import    (JSON download / textarea import)

Card page (/card/[id])
  └─ PortfolioAddButton (small Preact island)
       └─ same localStorage writer
```

**External data the portfolio page needs at runtime:**
1. **Per-card current prices + 30-day history** — fetched from the existing Worker endpoint `/sparkline-dump` (returns all 23k cards, gzipped). Cached in localStorage with a 1-hour TTL.
2. **Exchange rates** — already shipped to the client via `Base.astro` through `CurrencySelect`. Portfolio subscribes to the currency-switcher event.

Total new static pages: **1** (`/portfolio/index.html`).
Total new Preact islands: **2** (portfolio dashboard + card-page button).
No new npm dependencies, no Worker changes, no data pipeline changes.

## 3. Data model

### Schema

One `localStorage` key stores a versioned JSON file:

```ts
// src/data/portfolio-schema.ts
import { z } from 'zod';
import { SupportedCurrencySchema } from './currency-schema';

export const PortfolioEntrySchema = z.object({
  cardId: z.string().min(1),
  qty: z.number().int().positive(),
  costValue: z.number().nonnegative(),     // entered in costCurrency
  costCurrency: SupportedCurrencySchema,    // 'EUR' | 'USD' | 'GBP' | 'JPY'
  addedAt: z.string(),                      // ISO 8601 date (YYYY-MM-DD)
});
export type PortfolioEntry = z.infer<typeof PortfolioEntrySchema>;

export const PortfolioFileSchema = z.object({
  version: z.literal(1),
  entries: z.array(PortfolioEntrySchema),
});
export type PortfolioFile = z.infer<typeof PortfolioFileSchema>;
```

**Storage key:** `pokemon-tcg:portfolio` (constant).

**Mutation semantics:**
- Each `cardId` appears AT MOST once. Adding an already-owned card with `qty=2, cost=£300` to a row with `qty=1, cost=£150` replaces it with `qty=3, cost=£450` (costs sum; currency inherited from the new entry — if currencies differ, the existing entry's currency is kept and the new cost is first converted at today's FX).
- Editing a row writes back the entire file (cheap — entries are small).
- Remove splices the entry by `cardId`.

### Rationale for per-entry currency

A typical UK collector may enter everything in GBP and never see the complexity. But if they buy a card on holiday priced in EUR, or an international user enters their collection in USD, the stored-currency-per-entry model handles it honestly: no hidden FX conversion at entry time, no drift when rates change.

Cost is a *historical fact* (what you paid on that day in that currency). FX-floating the stored value would be wrong. Aggregation to display currency uses today's rate, which is standard financial practice.

## 4. File structure

```
src/pages/
└── portfolio/
    └── index.astro                 # NEW — server-renders shell, mounts PortfolioDashboard

src/components/
├── PortfolioDashboard.tsx          # NEW — large Preact island, the page body
├── PortfolioAddButton.tsx          # NEW — small Preact island for card-page integration
└── CurrencySelect.tsx              # modified — emit 'currencychange' event; change default from EUR to GBP

src/data/
├── portfolio-schema.ts             # NEW — Zod schemas + types
├── portfolio-storage.ts            # NEW — localStorage read/write/add/remove/update helpers
├── portfolio-aggregate.ts          # NEW — pure functions: stats, trend series, currency conversion
└── currency.ts                     # existing — convertFromEUR reused; add convertToEUR reverse helper

src/pages/
├── card/[id].astro                 # modified — mount PortfolioAddButton in the aside
└── index.astro                     # modified — add "My portfolio →" link

tests/unit/
├── portfolio-storage.test.ts       # NEW — add/remove/update, Zod round-trip, dedup semantics
└── portfolio-aggregate.test.ts     # NEW — stats math, trend series, currency aggregation

tests/e2e/
└── portfolio.spec.ts               # NEW — end-to-end: add → edit → export → clear → import → delete
```

No existing files grow unreasonably. `src/components/CurrencySelect.tsx` gets one event-dispatch line and one default-currency change.

## 5. Page layout — `/portfolio/`

Split-dashboard design (approved mockup at `.superpowers/brainstorm/18502-1776883395/content/layout.html` Option B).

```
┌────────────────────────────────────────────────────────────────┐
│ My portfolio                                                    │
│ Track what you own and what it's worth now.                     │
│                                                                 │
│ ┌────────────────────┐ ┌──────────────────────────────────┐     │
│ │  47       £3,420   │ │ ▲ 30-day value (GBP)             │     │
│ │ cards      paid    │ │                                  │     │
│ │                    │ │          _/̲̲~~~~                  │     │
│ │ £4,180    +£760    │ │     ~~~/_/̲̲                       │     │
│ │ value      P&L     │ │ ~~~~~/                           │     │
│ └────────────────────┘ └──────────────────────────────────┘     │
│                                                                 │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ [ find a card… ] [ qty ] [ cost £ ] [ Add ]                │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                 │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │       │ Card              │ Qty │ Cost  │ Value │ P&L │   │  │
│ │ [img] │ Charizard         │  1  │ £300  │ £360  │ +£60│ × │  │
│ │       │ Base Set          │     │       │       │     │   │  │
│ │ [img] │ Umbreon VMAX      │  2  │ £380  │£1,040 │+£280│ × │  │
│ │       │ Evolving Skies    │     │       │       │     │   │  │
│ │ [img] │ Blastoise         │  1  │  €60  │  £50  │ −£2 │ × │  │
│ │       │ Base Set          │     │       │       │     │   │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                 │
│  3 of 47 shown                     [Export JSON] [Import JSON] │
└────────────────────────────────────────────────────────────────┘
```

**Grid:** two columns at desktop (`repeat(auto-fit, minmax(min(360px, 100%), 1fr))` — same pattern as Hot Cards Task 4 fix). Stats card and trend card side by side; stack to one column below ~720 px.

**Stats card:** 2×2 grid of labeled big-numbers. P&L cell colored green if non-negative, red if negative.

**Trend card:** inline SVG line chart, ~200 px tall. Uses same builder as `HotHoverPopup` (30 points → `<polyline>`). Labelled "30-day value ({CURRENCY})" — currency updates when the user switches.

**Add form:** horizontal flex bar. The "find a card" input is a Pagefind-driven autocomplete (see §7). Qty defaults to 1. Cost input label shows the active display currency symbol and stores that currency code on the entry.

**Table:** 7 columns (thumb, card, qty, cost, value, P&L, remove). Thumb uses the same `pickThumbnailUrl`/`onerror` pattern as `HotSection.astro`. Card cell shows name + set name. Qty and cost are `<input>` elements (always-editable). Value = `qty × currentPrice_display`. P&L = `value − cost_in_display`.

**Footer:** "N of M shown" counter + Export/Import buttons.

**Empty state:** when `entries.length === 0`, the table is replaced with a welcome block:

```
  ┌────────────────────────────────────────────────────────────┐
  │  You haven't added any cards yet.                          │
  │                                                            │
  │  Start by searching above, or paste an exported collection.│
  │                                                            │
  │                     [Import JSON]                          │
  └────────────────────────────────────────────────────────────┘
```

The add form + dashboard remain visible; summary stats show zeros; trend chart shows a single horizontal zero-line.

## 6. Card-page integration

Add a small button to `src/pages/card/[id].astro`, immediately below the existing `<aside>` that lists Set/Rarity/Types. It's a Preact island because it needs localStorage access + the current display currency.

### Static markup (in `[id].astro`)

```astro
<aside>
  <p>Set: <a href={`/pokemon-tcg/set/${card.filters.setId}/`}>...</a></p>
  <p>Rarity: ...</p>
  <p>Types: ...</p>
</aside>
<PortfolioAddButton client:load cardId={card.id} cardName={card.defaultName} />
```

### Island behaviour

Initial state: a single button reading **"+ Add to my cards"**. Styled as a small outline button.

On click, the button transforms into an inline mini-form row:

```
┌────────────────────────────────────────────────────────────┐
│ Qty [__]   Cost £[____]   [Save]  [Cancel]                 │
└────────────────────────────────────────────────────────────┘
```

- Qty defaults to `1`.
- Cost input's symbol (£/€/$/¥) is driven by the current `CurrencySelect` value (read from localStorage on mount + updated on `currencychange` event).
- **Save** validates qty ≥ 1 and cost ≥ 0, writes to localStorage, then collapses the form to a success state: **"✓ Added (×Qty) — Undo"**. Undo restores the prior state for 5 s, then the UI becomes the plain "+ Add to my cards" button again.
- If the card is already in the portfolio, the button reads **"✓ Owned (×Qty) — Update"** and clicking opens the mini-form pre-filled.
- **Cancel** reverts to the button.

### Currency reactivity

When the user switches display currency via `CurrencySelect`, the card-page button re-reads its label symbol. Already-saved entries are NOT retroactively converted — cost currency is captured at Save time.

## 7. Autocomplete (portfolio page add form)

The "find a card" input uses Pagefind — the same index already built by Set/Series + Search + Home. No new index, no new fetch infrastructure.

### Behaviour

- User types ≥2 chars. 150ms debounce.
- Call `window.pagefind.search(query)`; take top 10 results.
- Extract `cardId` from each result's URL (same helper used in `SearchBox.tsx`'s filter update).
- For each result, display the card's thumbnail + name + set name in a dropdown below the input.
- Click a result → input displays the chosen card name, the hidden `cardId` state locks in, focus moves to the Qty input.
- Enter key in Qty → focus Cost. Enter in Cost → clicks Add.
- If the chosen card is already in the portfolio, the add button changes to "Update" and the Qty/Cost fields pre-fill with the existing entry's values.

### Thumbnail source

Pagefind's result `data()` yields meta fields we set in the card page's `<article data-pagefind-meta>`. Currently: `title` + `subtitle` (= set name). Add a new meta field `thumb` with the EN-preferred image URL so the autocomplete dropdown can show a tiny image without a second fetch.

Concrete change to `src/pages/card/[id].astro`:

```astro
<article data-pagefind-body
         data-pagefind-meta={`title:${card.defaultName}, subtitle:${card.filters.setName}, thumb:${thumbForCard(card)}, cardId:${card.id}`}>
```

`thumbForCard(card)` is the same EN-first/JA-fallback helper used in `HotSection.astro`. `cardId` is also emitted so the autocomplete can read it directly without URL-parsing.

## 8. Summary stats + trend — client-side math

All computation happens in `src/data/portfolio-aggregate.ts` (pure functions, unit-tested without localStorage/DOM).

### Today's currents

```ts
function entryCurrentEur(entry: PortfolioEntry, dump: SparklineDump): number | null {
  const series = dump.records[entry.cardId];
  if (!series || series.length === 0) return null;
  return series[series.length - 1].trend;
}
```

Returns null if the card has no history — its row renders "—" for current value and is excluded from summary stats (with a "1 card has no price data" notice in the footer).

### Summary stats

```ts
function computeSummary(
  entries: PortfolioEntry[],
  dump: SparklineDump,
  rates: ExchangeRates,
  display: SupportedCurrency,
): PortfolioSummary {
  let cards = 0;
  let paidInDisplay = 0;
  let valueInDisplay = 0;
  let unpriced = 0;

  for (const e of entries) {
    cards += e.qty;
    paidInDisplay += convertBetween(e.costValue, e.costCurrency, display, rates) * 1;
    const curEur = entryCurrentEur(e, dump);
    if (curEur === null) { unpriced++; continue; }
    valueInDisplay += e.qty * convertFromEUR(curEur, display, rates);
  }

  return {
    cards,
    uniqueCards: entries.length,
    paidInDisplay,
    valueInDisplay,
    pnlValue: valueInDisplay - paidInDisplay,
    pnlPct: paidInDisplay > 0 ? (valueInDisplay - paidInDisplay) / paidInDisplay : 0,
    unpriced,
  };
}
```

`convertBetween(value, from, to, rates)` — helper that converts via EUR (all rates are stored as EUR→X). Added to `src/data/currency.ts`.

### Trend series

```ts
function computeTrendSeries(
  entries: PortfolioEntry[],
  dump: SparklineDump,
  rates: ExchangeRates,
  display: SupportedCurrency,
): Array<{ date: string; valueInDisplay: number }> {
  // Collect every distinct date across all owned cards' series, sorted ascending.
  const dateSet = new Set<string>();
  for (const e of entries) {
    const series = dump.records[e.cardId] ?? [];
    for (const s of series) if (s.trend !== null) dateSet.add(s.date);
  }
  const dates = [...dateSet].sort();

  // For each date, sum (qty × trend_on_or_before_that_date) per card.
  // Uses most-recent-prior snapshot per card to fill gaps (forward-fill).
  return dates.map((date) => {
    let totalEur = 0;
    for (const e of entries) {
      const series = dump.records[e.cardId] ?? [];
      const snap = findSnapshotOnOrBefore(series, date);
      if (snap !== null && snap.trend !== null) totalEur += e.qty * snap.trend;
    }
    return { date, valueInDisplay: convertFromEUR(totalEur, display, rates) };
  });
}
```

`findSnapshotOnOrBefore(series, targetIso)` walks a date-sorted (oldest→newest) `Snapshot[]` backwards and returns the most-recent entry with `date ≤ targetIso`, or `null`. Same pattern as `pickBaseline` in `src/data/hot-cards.ts:45`; the plan can either reuse that implementation (rename/promote it to a shared helper) or inline a copy in `portfolio-aggregate.ts`.

Rendered as an inline SVG `<polyline>` (identical builder to `HotHoverPopup.buildSparklinePoints`). Line color: green if last value > first value, red otherwise.

**FX caveat:** the trend line converts every day's EUR sum using *today's* FX rate. Historical FX is not preserved. Displayed as-is with the label "30-day value ({CURRENCY})" — users understand this is a notional "at today's rate" line, which matches how the summary stats work. Documented in decisions log.

## 9. Currency handling

### Default change

`src/components/CurrencySelect.tsx` currently defaults to `'EUR'`. Change the default to `'GBP'`. Users who already have a different preference in localStorage are unaffected (localStorage wins).

### Custom event

`CurrencySelect` currently reacts to its own `<select>` change by walking `[data-price-currency-field]` elements in the DOM. Add one line: on change, also dispatch `window.dispatchEvent(new CustomEvent('currencychange', { detail: { currency } }))`.

`PortfolioDashboard` and `PortfolioAddButton` listen for this event and re-render accordingly.

### convertBetween helper

Add to `src/data/currency.ts`:

```ts
export function convertBetween(
  value: number,
  from: SupportedCurrency,
  to: SupportedCurrency,
  rates: ExchangeRates,
): number {
  if (from === to) return value;
  // All rates are stored as EUR → X multipliers. Convert via EUR.
  const inEur = from === 'EUR' ? value : value / rates.rates[from];
  return to === 'EUR' ? inEur : inEur * rates.rates[to];
}
```

## 10. Export / Import JSON

### Export

Button renders a download link: `pokemon-tcg-portfolio-YYYY-MM-DD.json` with `Content-Type: application/json`. File content is exactly the `PortfolioFile` JSON shape, pretty-printed (2-space indent). One line of code using `URL.createObjectURL(new Blob([json], {type: 'application/json'}))`.

### Import

Button opens an inline modal with a `<textarea>`. User pastes JSON and clicks **Replace portfolio**.

- Parse → `JSON.parse`.
- Validate → `PortfolioFileSchema.parse` (Zod). On failure, show the Zod error inline.
- On success → replace the entire localStorage value. Does NOT merge — merge semantics are fiddly and the user can always export before import.
- Confirmation: "Replaced portfolio with N entries." Dismiss modal.

The UI is intentionally barebones — Export/Import is a power-user backup feature, not a primary workflow.

## 11. Sparkline fetch + caching

### Fetch

```ts
const SPARKLINE_CACHE_KEY = 'pokemon-tcg:sparkline-cache';
const SPARKLINE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SPARKLINE_URL = 'https://pokemon-tcg-history-api.david-taylor-pokemon.workers.dev/sparkline-dump';

async function fetchSparklineWithCache(): Promise<SparklineDump> {
  const cached = localStorage.getItem(SPARKLINE_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as { at: number; data: unknown };
      if (Date.now() - parsed.at < SPARKLINE_CACHE_TTL_MS) {
        return SparklineDumpSchema.parse(parsed.data);
      }
    } catch { /* fall through and re-fetch */ }
  }
  const res = await fetch(SPARKLINE_URL);
  if (!res.ok) throw new Error(`Sparkline dump ${res.status}`);
  const raw = await res.json();
  const dump = SparklineDumpSchema.parse(raw);
  localStorage.setItem(SPARKLINE_CACHE_KEY, JSON.stringify({ at: Date.now(), data: dump }));
  return dump;
}
```

### Size caveat

The full sparkline dump is ~30 MB uncompressed (~5 MB gzipped). First portfolio page load is a one-time ~5 MB fetch; subsequent page loads within 1 hour hit the cache. Refetch after 1 hour. This is a known v1 trade-off (documented in decisions log); a filter endpoint `/sparkline-query?ids=a,b,c` is a natural v2 optimization if the page feels slow in practice.

### Loading state

While fetching, the summary cards show a skeleton (gray bars). Table rows render immediately from localStorage; their "Current value" and "P&L" columns show "—" until the dump resolves.

## 12. Discovery

`src/pages/index.astro` currently has `.browse-links` with two anchors (Browse all sets, See hot cards). Add a third:

```astro
<div class="browse-links">
  <a href="/pokemon-tcg/sets/">Browse all sets →</a>
  <a href="/pokemon-tcg/hot/">See hot cards →</a>
  <a href="/pokemon-tcg/portfolio/">My portfolio →</a>
</div>
```

No site-header nav change — consistent with the precedent set by Set/Series and Hot Cards.

## 13. SEO

- `<title>My portfolio — Pokémon TCG Catalog</title>`
- `<meta name="description" content="Your personal Pokémon TCG collection — total value, P&L, and a 30-day value trend. Stored in your browser.">`
- `<meta name="robots" content="noindex">` — the page is personal and has no meaningful shared content for Google. No reason to index a page that's empty by default and different for every visitor.
- No `og:image` (user-specific content, no canonical preview).

## 14. Error handling

| Situation | Behavior |
| --- | --- |
| `localStorage.getItem('pokemon-tcg:portfolio')` returns null | Treat as empty `{ version: 1, entries: [] }`. Normal empty state. |
| Stored JSON fails Zod validation | Show a dismissible red banner: "Couldn't read your portfolio (data may be corrupted). Export your raw data for recovery." Fall back to empty state without overwriting. Preserves data for manual recovery. |
| `SPARKLINE_URL` fetch fails (offline, Worker down) | Summary current/P&L columns show "—". Trend chart shows "Prices unavailable — reconnect to load." Cost basis and quantities still display correctly. |
| User adds a card whose `cardId` doesn't match any record in the sparkline dump (e.g. a just-released card before the next daily push) | Row saves fine; current value = "—"; noted in the summary as "1 card has no current price". |
| `qty < 1` or `cost < 0` in the add form | Prevent submission, highlight the offending field with a red border. No toast. |
| Import JSON fails validation | Show the Zod error under the textarea. Do not replace localStorage. |
| `QuotaExceededError` on localStorage write (unlikely — a 1000-entry portfolio is <100 KB) | Show an error banner: "Storage quota exceeded." Don't commit. |
| Currency switch while the sparkline is still loading | Summary re-renders with converted costs immediately; current-value cells wait for the fetch. |

## 15. Testing

### Unit — `tests/unit/portfolio-storage.test.ts`

Pure localStorage-mocked tests (use a fake storage object). ~8 cases:
1. `addEntry` on empty portfolio → entry with `addedAt` filled, `version: 1`.
2. `addEntry` with existing `cardId` → quantities sum, costs sum (same-currency path).
3. `addEntry` with existing `cardId` and different currency → new cost converted at today's rate, added to existing cost, existing currency kept.
4. `removeEntry` → splice by cardId; no-op if absent.
5. `updateEntry` → writes qty/cost in place; 0 qty is rejected (must use remove).
6. `loadPortfolio` on missing key → returns empty file.
7. `loadPortfolio` on corrupted JSON → returns empty file + caller can detect via a `loadPortfolioSafe(): { file, corrupted }` variant.
8. `savePortfolio` round-trip → Zod-valid, deterministic JSON output.

### Unit — `tests/unit/portfolio-aggregate.test.ts`

~7 cases:
1. `computeSummary` on empty entries → all zeros.
2. `computeSummary` with mixed-currency costs → correct sum in display currency.
3. `computeSummary` with one unpriced card → `unpriced: 1`, not counted in value.
4. `computeSummary` P&L percent guard → zero paid → 0%, not NaN.
5. `computeTrendSeries` → dates sorted, sums correct per date with forward-fill.
6. `computeTrendSeries` empty portfolio → empty array.
7. `convertBetween` identity / EUR passthrough / double-hop accuracy.

### E2E — `tests/e2e/portfolio.spec.ts`

Runs against the fixture catalog (2 cards). Each test starts with an empty localStorage (cleared in `beforeEach`). ~6 cases:
1. `/portfolio/` empty state renders: hero text, big Import JSON button, zeros in stats.
2. Autocomplete: type "Chari" → dropdown shows 1 result (base1-4) → click → qty focus → enter "2" + "150" → Add. Table now shows 1 row with qty=2, cost=£150. Summary: 2 cards, £150 paid.
3. Edit qty from 2 to 3 (type + blur) → summary updates to 3 cards.
4. Click × on the row → row gone → empty state returns.
5. Export → click download button → assert download triggers with correct filename pattern. (Playwright's `downloadPromise`.)
6. Import: paste a 3-entry JSON → click Replace → table shows 3 rows, summary reflects 3 entries.

Fixture note: the existing `data/fixtures/sample-sparkline.json` gives both fixture cards 30-day history, so the trend chart has real data. Playwright's `addInitScript` seeds localStorage for tests that start non-empty. The portfolio dashboard's `fetch` to the Worker's `/sparkline-dump` endpoint is intercepted via `page.route()` in the e2e `beforeEach` and responded with the fixture JSON — keeps tests deterministic and offline-friendly.

### E2E — modify `tests/e2e/card-page.spec.ts`

Add one test: on `/card/base1-4`, click the "+ Add to my cards" button → mini-form appears → fill 1 + 100 → Save → button transforms to "✓ Owned (×1) — Update". Reload the page; state persists.

## 16. Key decisions log

- **localStorage over D1** — keeps the feature zero-cost and zero-auth. A collector who wants multi-device sync can Export/Import JSON. Upgrading to D1 later means adding a sync layer on top, not rearchitecting.
- **Per-entry currency code** — honours the historical fact of "what you paid"; supports mixed-currency collections for international users. One extra field in the schema; ~40 extra lines of aggregation logic.
- **Default currency change EUR → GBP** — matches the primary user's locale; international users still see 4 options in the switcher. Existing users with a non-EUR preference in localStorage are unaffected.
- **Cost basis row displays in its native currency** — it's a historical fact. Aggregates (summary + P&L) convert to display currency for comparability with value.
- **Trend chart uses today's FX across all 30 days** — simplification. Historical FX would require per-day rates (not stored; Frankfurter does provide historical, but wiring is v2 scope). Note in the chart label so the user is not misled.
- **Full sparkline dump cached 1h** — one-time 5 MB gzipped download per hour. Simpler than a filter endpoint. Revisit if latency complaints surface.
- **Empty state replaces the table, not the dashboard** — keeps Add form + Export/Import visible; preserves a sense of "this is where your data will live."
- **No merge-on-import** — paste replaces. Merge semantics (same cardId in both — sum? keep old? keep new?) introduce confusion; Export-before-Import is the safer workflow.
- **No sort/filter controls on the table for v1** — newest-first is the natural default. Sortable columns + filter bar are v2 if the list gets long.
- **Noindex on the page** — it's personal data, not shared content. No reason to feed it to Google.
- **Reuse Pagefind for autocomplete, not a new index** — same multilingual behaviour the rest of the site has, zero new build steps.
- **Preact island approach over Astro partial pages** — the dashboard's cross-cell reactivity (currency change updates 4 stats + the chart + 3 row columns at once) is a natural fit for a component with state.

## 17. Open questions

None at the time of approval. Any unknowns discovered during implementation go in a separate doc.
