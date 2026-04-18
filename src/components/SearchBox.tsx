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
        // @ts-expect-error — pagefind is generated at build time, not resolvable at typecheck time
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
