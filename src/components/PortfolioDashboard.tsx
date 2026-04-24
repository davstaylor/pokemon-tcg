import { useEffect, useState } from 'preact/hooks';
import { loadPortfolioSafe, addEntry, savePortfolio } from '@/data/portfolio-storage';
import { fetchSparklineWithCache } from '@/data/sparkline-fetch';
import { type ExchangeRates, type SupportedCurrency, CURRENCY_GLYPH, CURRENCY_DECIMALS } from '@/data/currency-schema';
import { computeSummary, computeTrendSeries, type PortfolioSummary, type TrendPoint } from '@/data/portfolio-aggregate';
import type { PortfolioFile } from '@/data/portfolio-schema';
import type { SparklineDump } from '@/data/history-schema';

const CURRENCY_STORAGE_KEY = 'pokemon-tcg-currency';

function detectCurrency(): SupportedCurrency {
  try {
    const saved = localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (saved === 'EUR' || saved === 'USD' || saved === 'GBP' || saved === 'JPY') return saved;
  } catch {}
  return 'GBP';
}

function formatCurrencyValue(value: number, currency: SupportedCurrency, signed = false): string {
  const decimals = CURRENCY_DECIMALS[currency];
  const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = signed ? (value >= 0 ? '+' : '−') : '';
  const abs = Math.abs(value);
  return `${sign}${CURRENCY_GLYPH[currency]}${fmt.format(abs)}`;
}

function formatPct(decimal: number): string {
  const pct = (decimal * 100).toFixed(1);
  const sign = decimal >= 0 ? '+' : '−';
  return `${sign}${pct.replace('-', '')}%`;
}

type PagefindResult = {
  id: string;
  url: string;
  excerpt?: string;
  meta: { title?: string; subtitle?: string; thumb?: string; cardId?: string };
};
type Pagefind = {
  search: (q: string) => Promise<{ results: Array<{ id: string; data: () => Promise<PagefindResult> }> }>;
};

const ADD_FORM_STYLES = `
  .portfolio-add {
    background: var(--paper);
    border: 1px solid #d9c9a3;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    margin-bottom: 1.25rem;
    position: relative;
  }
  .portfolio-add .add-row {
    display: grid;
    grid-template-columns: 1fr 80px 110px auto;
    gap: 0.5rem;
    align-items: center;
  }
  .portfolio-add input, .portfolio-add button {
    padding: 0.45rem 0.75rem;
    border: 1px solid #d9c9a3;
    border-radius: 6px;
    background: #fffdf6;
    font-size: 0.9rem;
  }
  .portfolio-add button {
    background: var(--accent); color: white; border-color: var(--accent);
    font-weight: 600; cursor: pointer;
  }
  .portfolio-add button:disabled {
    background: #d9c9a3; border-color: #d9c9a3; cursor: not-allowed;
  }
  .portfolio-add .search-wrap { position: relative; }
  .portfolio-add .suggestions {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    list-style: none;
    padding: 0.25rem 0;
    margin: 0;
    background: #fffdf6;
    border: 1px solid #d9c9a3;
    border-radius: 6px;
    box-shadow: 0 6px 16px rgba(59, 42, 26, 0.12);
    z-index: 10;
    max-height: 320px;
    overflow-y: auto;
  }
  .portfolio-add .suggestions li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
  }
  .portfolio-add .suggestions li:hover { background: #f5efe2; }
  .portfolio-add .suggestions img {
    width: 24px; height: 33px; object-fit: cover; border-radius: 2px;
    background: linear-gradient(135deg, #d9c9a3, #c8b78f); flex: 0 0 auto;
  }
  .portfolio-add .suggestions .nm strong { display: block; font-size: 0.85rem; }
  .portfolio-add .suggestions .nm small { display: block; color: var(--muted); font-size: 0.75rem; }
  @media (max-width: 560px) {
    .portfolio-add .add-row { grid-template-columns: 1fr; }
  }
`;

function buildSparklinePoints(points: TrendPoint[]): string {
  if (points.length < 2) return '';
  const values = points.map((p) => p.valueInDisplay);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 48 - ((p.valueInDisplay - min) / range) * 48;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export default function PortfolioDashboard({ rates }: { rates: ExchangeRates }) {
  const [file, setFile] = useState<PortfolioFile | null>(null);
  const [dump, setDump] = useState<SparklineDump | null>(null);
  const [currency, setCurrency] = useState<SupportedCurrency>('GBP');

  useEffect(() => {
    const { file } = loadPortfolioSafe();
    setFile(file);
    setCurrency(detectCurrency());

    fetchSparklineWithCache()
      .then((d) => setDump(d))
      .catch(() => setDump({ days: 30, cutoff: '1970-01-01', records: {} }));  // graceful fallback

    const onCurrencyChange = (e: Event) => {
      const next = (e as CustomEvent<{ currency: SupportedCurrency }>).detail?.currency;
      if (next) setCurrency(next);
    };
    window.addEventListener('currencychange', onCurrencyChange);
    return () => window.removeEventListener('currencychange', onCurrencyChange);
  }, []);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PagefindResult[]>([]);
  const [selected, setSelected] = useState<{ cardId: string; cardName: string; thumb: string } | null>(null);
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [pagefind, setPagefind] = useState<Pagefind | null>(null);

  // Load pagefind once.
  useEffect(() => {
    if (window.pagefind) {
      setPagefind(window.pagefind);
      return;
    }
    (async () => {
      const pagefindUrl = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/pagefind/pagefind.js`;
      try {
        window.pagefind = (await import(/* @vite-ignore */ pagefindUrl)) as unknown as Pagefind;
        setPagefind(window.pagefind!);
      } catch {
        // Pagefind unavailable — autocomplete won't work but rest of page does.
      }
    })();
  }, []);

  // Run search on query change.
  useEffect(() => {
    if (!pagefind || query.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const raw = await pagefind.search(query);
      if (cancelled) return;
      const data = await Promise.all(raw.results.slice(0, 10).map((r) => r.data()));
      if (cancelled) return;
      setSuggestions(data);
    })();
    return () => { cancelled = true; };
  }, [query, pagefind]);

  function selectSuggestion(r: PagefindResult) {
    const cardId = r.meta.cardId ?? '';
    if (!cardId) return;
    setSelected({
      cardId,
      cardName: r.meta.title ?? cardId,
      thumb: r.meta.thumb ?? '',
    });
    setQuery(r.meta.title ?? '');
    setSuggestions([]);
    // Focus qty — deferred so the render commits first.
    requestAnimationFrame(() => {
      (document.querySelector('.portfolio-add input[name=qty]') as HTMLInputElement | null)?.focus();
    });
  }

  function handleAdd() {
    if (selected === null) return;
    const qtyNum = Number(qty);
    const costNum = Number(cost);
    if (!Number.isFinite(qtyNum) || qtyNum < 1) return;
    if (!Number.isFinite(costNum) || costNum < 0) return;
    const todayIso = new Date().toISOString().slice(0, 10);
    const { file: current } = loadPortfolioSafe();
    const next = addEntry(
      current,
      { cardId: selected.cardId, qty: qtyNum, costValue: costNum, costCurrency: currency },
      rates,
      todayIso,
    );
    savePortfolio(next);
    setFile(next);
    // Reset form.
    setSelected(null);
    setQuery('');
    setQty('1');
    setCost('');
  }

  const renderAddForm = () => (
    <div class="portfolio-add">
      <div class="add-row">
        <div class="search-wrap">
          <input
            type="search"
            placeholder="Find a card…"
            value={query}
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              if (selected) setSelected(null);  // user is typing again
            }}
          />
          {suggestions.length > 0 && (
            <ul class="suggestions">
              {suggestions.map((r) => (
                <li key={r.id} onClick={() => selectSuggestion(r)}>
                  {r.meta.thumb && <img src={r.meta.thumb} alt="" loading="lazy" />}
                  <span class="nm">
                    <strong>{r.meta.title ?? r.url}</strong>
                    {r.meta.subtitle && <small>{r.meta.subtitle}</small>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input
          name="qty"
          type="number"
          min="1"
          placeholder="Qty"
          value={qty}
          disabled={selected === null}
          onInput={(e) => setQty((e.target as HTMLInputElement).value)}
        />
        <input
          name="cost"
          type="number"
          min="0"
          step="0.01"
          placeholder={`Cost ${CURRENCY_GLYPH[currency]}`}
          value={cost}
          disabled={selected === null}
          onInput={(e) => setCost((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if ((e as KeyboardEvent).key === 'Enter') handleAdd(); }}
        />
        <button type="button" data-action="add" disabled={selected === null} onClick={handleAdd}>Add</button>
      </div>
    </div>
  );

  if (file === null) return null;

  if (file.entries.length === 0) {
    return (
      <div>
        {renderAddForm()}
        <div class="portfolio-empty">
          <p>You haven't added any cards yet.</p>
          <p class="sub">Start by searching above, or paste an exported collection.</p>
        </div>
        <style>{`
          .portfolio-empty {
            background: var(--paper);
            border: 1px solid #d9c9a3;
            border-radius: 10px;
            padding: 2rem 1.5rem;
            text-align: center;
            color: var(--ink);
          }
          .portfolio-empty p { margin: 0.25rem 0; }
          .portfolio-empty .sub { color: var(--muted); font-size: 0.9rem; }
          ${ADD_FORM_STYLES}
        `}</style>
      </div>
    );
  }

  const summary: PortfolioSummary | null = dump
    ? computeSummary(file.entries, dump, rates, currency)
    : null;
  const trend = dump ? computeTrendSeries(file.entries, dump, rates, currency) : [];

  return (
    <div class="portfolio-populated">
      <div class="portfolio-dashboard">
        <div class="portfolio-stats">
          <div class="stat">
            <div class="lbl">Cards</div>
            <div class="val" data-stat="cards">{summary === null ? '—' : summary.cards}</div>
          </div>
          <div class="stat">
            <div class="lbl">Paid</div>
            <div class="val" data-stat="paid">{summary === null ? '—' : formatCurrencyValue(summary.paidInDisplay, currency)}</div>
          </div>
          <div class="stat">
            <div class="lbl">Now</div>
            <div class="val" data-stat="value">{summary === null ? '—' : formatCurrencyValue(summary.valueInDisplay, currency)}</div>
          </div>
          <div class="stat">
            <div class="lbl">P&amp;L</div>
            <div class={`val ${summary !== null && summary.pnlValue >= 0 ? 'up' : 'dn'}`} data-stat="pnl">
              {summary === null ? '—' : `${formatCurrencyValue(summary.pnlValue, currency, true)} (${formatPct(summary.pnlPct)})`}
            </div>
          </div>
        </div>

        <div class="portfolio-trend">
          <div class="trend-lbl">30-day value ({currency})</div>
          <svg viewBox="0 0 100 48" preserveAspectRatio="none">
            <polyline
              points={buildSparklinePoints(trend)}
              fill="none"
              stroke={trend.length > 1 && trend[trend.length - 1].valueInDisplay >= trend[0].valueInDisplay ? '#2d7d47' : '#b23a3a'}
              stroke-width="1.5"
            />
          </svg>
        </div>
      </div>

      {renderAddForm()}

      <style>{`
        .portfolio-dashboard {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
          gap: 1rem;
          margin-bottom: 1.25rem;
        }
        .portfolio-stats {
          background: var(--paper);
          border: 1px solid #d9c9a3;
          border-radius: 10px;
          padding: 1rem 1.25rem;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.75rem 1rem;
        }
        .portfolio-stats .stat { text-align: center; }
        .portfolio-stats .lbl {
          font-size: 0.7rem; letter-spacing: 1.5px;
          text-transform: uppercase; color: var(--muted);
        }
        .portfolio-stats .val { font-size: 1.3rem; font-weight: 700; margin-top: 0.25rem; font-variant-numeric: tabular-nums; }
        .portfolio-stats .val.up { color: #2d7d47; }
        .portfolio-stats .val.dn { color: #b23a3a; }

        .portfolio-trend {
          background: var(--paper);
          border: 1px solid #d9c9a3;
          border-radius: 10px;
          padding: 1rem 1.25rem;
          display: flex;
          flex-direction: column;
        }
        .portfolio-trend .trend-lbl {
          font-size: 0.7rem; letter-spacing: 1.5px;
          text-transform: uppercase; color: var(--muted);
          margin-bottom: 0.5rem;
        }
        .portfolio-trend svg {
          width: 100%;
          flex: 1;
          min-height: 120px;
          background: linear-gradient(180deg, #fffdf6, #f5efe2);
          border-radius: 4px;
          border: 1px solid #ebdfc2;
        }
        ${ADD_FORM_STYLES}
      `}</style>
    </div>
  );
}
