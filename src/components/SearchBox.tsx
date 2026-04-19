import { useState, useEffect } from 'preact/hooks';

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
      setResults([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const raw = await pagefind.search(query);
      if (cancelled) return;
      const data = await Promise.all(raw.results.slice(0, 20).map((r) => r.data()));
      if (cancelled) return;
      setResults(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [query, pagefind]);

  return (
    <div>
      <input
        type="search"
        value={query}
        placeholder="Search any card name…"
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
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
