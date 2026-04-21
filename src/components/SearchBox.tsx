import { useState, useEffect } from 'preact/hooks';

type PagefindResult = {
  id: string;
  url: string;
  excerpt: string;
  meta: { title?: string; subtitle?: string };
};

type Pagefind = {
  search: (q: string) => Promise<{ results: Array<{ id: string; data: () => Promise<PagefindResult> }> }>;
};

declare global { interface Window { pagefind?: Pagefind } }

// Cap the number of pagefind results we resolve per query. Typical name
// searches return dozens; bulk/open-ended queries (e.g. "pika") can return
// thousands. 1000 is enough for any realistic name filter without stalling
// on Promise.all resolution.
const MAX_PAGEFIND_RESULTS = 1000;

// Extract the card ID segment from a URL like "/pokemon-tcg/card/base1-4"
// or the trailing-slash variant. Returns null for non-card URLs.
function extractCardId(url: string): string | null {
  const match = url.match(/\/card\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

// Recompute the visible-tile counter after any filter class is toggled.
// Both islands (SearchBox + FacetSidebar) call this so the counter reflects
// the intersection of all active filters rather than whichever ran last.
function updateVisibleCount() {
  const visible = document.querySelectorAll(
    '[data-card-tile]:not(.hidden-by-facet):not(.hidden-by-search)',
  ).length;
  const counter = document.querySelector('[data-result-count]');
  if (counter) counter.textContent = String(visible);
}

function applySearchFilter(allowedIds: Set<string> | null) {
  // allowedIds === null means "no active query" → clear the search filter
  // (remove the class from every tile) and let the facet sidebar own
  // visibility.
  document.querySelectorAll<HTMLElement>('[data-card-tile]').forEach((el) => {
    const id = el.getAttribute('data-card-id');
    const hide = allowedIds !== null && (!id || !allowedIds.has(id));
    el.classList.toggle('hidden-by-search', hide);
  });
  updateVisibleCount();
}

export default function SearchBox({ initialQuery = '' }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [pagefind, setPagefind] = useState<Pagefind | null>(null);

  // Load Pagefind once on mount.
  useEffect(() => {
    (async () => {
      if (!window.pagefind) {
        const pagefindUrl = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/pagefind/pagefind.js`;
        window.pagefind = (await import(/* @vite-ignore */ pagefindUrl)) as unknown as Pagefind;
      }
      setPagefind(window.pagefind);
    })();
  }, []);

  // Re-run search whenever the query changes OR pagefind finishes loading.
  // The second condition matters: if the user types before Pagefind is ready,
  // the query is captured in state and runs as soon as Pagefind loads.
  useEffect(() => {
    if (!pagefind) return;
    if (query.length < 2) {
      // Clear the search filter so the full grid (minus facets) is visible.
      applySearchFilter(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const raw = await pagefind.search(query);
      if (cancelled) return;
      const data = await Promise.all(
        raw.results.slice(0, MAX_PAGEFIND_RESULTS).map((r) => r.data()),
      );
      if (cancelled) return;
      const allowed = new Set<string>();
      for (const r of data) {
        const cardId = extractCardId(r.url);
        if (cardId) allowed.add(cardId);
      }
      applySearchFilter(allowed);
    })();
    return () => {
      cancelled = true;
    };
  }, [query, pagefind]);

  return (
    <input
      type="search"
      value={query}
      placeholder="Search any card name…"
      onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      style={{
        width: '100%',
        padding: '0.75rem 1rem',
        borderRadius: 999,
        border: '1px solid #d9c9a3',
        background: '#fffdf6',
      }}
    />
  );
}
