import { useState, useEffect } from 'preact/hooks';
import type { CardIdentity } from '@/data/schema';

type Filters = { set?: string; type?: string; rarity?: string; series?: string };

// Facet option: stable ID (what the filter matches against) + display label
// (what the user sees). For set/series the ID is the short code (e.g. "base1",
// "swsh") and the label is the human name (e.g. "Base", "Sword & Shield"),
// derived at build time in search.astro. For type/rarity the ID and label
// are the same string (the raw filter value).
export type FacetOption = { id: string; name: string };

function applyFilter(filtered: CardIdentity[]) {
  const allowed = new Set(filtered.map((c) => c.id));
  document.querySelectorAll<HTMLElement>('[data-card-tile]').forEach((el) => {
    const id = el.getAttribute('data-card-id');
    el.style.display = id && allowed.has(id) ? '' : 'none';
  });
  const counter = document.querySelector('[data-result-count]');
  if (counter) counter.textContent = String(filtered.length);
}

export default function FacetSidebar({
  cards,
  sets,
  serieses,
}: {
  cards: CardIdentity[];
  sets: FacetOption[];
  serieses: FacetOption[];
}) {
  const [filters, setFilters] = useState<Filters>({});

  // Type and rarity are cheap to derive client-side (few unique values, raw
  // strings that double as both ID and label).
  const types: FacetOption[] = Array.from(new Set(cards.flatMap((c) => c.filters.types)))
    .sort()
    .map((v) => ({ id: v, name: v }));
  const rarities: FacetOption[] = Array.from(new Set(cards.map((c) => c.filters.rarity)))
    .sort()
    .map((v) => ({ id: v, name: v }));

  useEffect(() => {
    const filtered = cards.filter((c) => {
      if (filters.set && c.filters.setId !== filters.set) return false;
      if (filters.type && !c.filters.types.includes(filters.type)) return false;
      if (filters.rarity && c.filters.rarity !== filters.rarity) return false;
      if (filters.series && c.filters.series !== filters.series) return false;
      return true;
    });
    applyFilter(filtered);
  }, [filters, cards]);

  function renderFacet(label: string, key: keyof Filters, options: FacetOption[]) {
    return (
      <section style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.8rem', letterSpacing: 2, textTransform: 'uppercase', color: '#7a5e3a' }}>{label}</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {options.map((opt) => (
            <li key={opt.id}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0' }}>
                <input
                  type="radio"
                  name={key}
                  value={opt.id}
                  checked={filters[key] === opt.id}
                  onChange={() => setFilters({ ...filters, [key]: opt.id })}
                />
                {opt.name}
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
