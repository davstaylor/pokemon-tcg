import { useState, useEffect } from 'preact/hooks';
import type { CardIdentity } from '@/data/schema';

type Filters = { set?: string; type?: string; rarity?: string; series?: string };

function applyFilter(filtered: CardIdentity[]) {
  const allowed = new Set(filtered.map((c) => c.id));
  document.querySelectorAll<HTMLElement>('[data-card-tile]').forEach((el) => {
    const id = el.getAttribute('data-card-id');
    el.style.display = id && allowed.has(id) ? '' : 'none';
  });
  const counter = document.querySelector('[data-result-count]');
  if (counter) counter.textContent = String(filtered.length);
}

export default function FacetSidebar({ cards }: { cards: CardIdentity[] }) {
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
    applyFilter(filtered);
  }, [filters, cards]);

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
                  value={v}
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
