import { useEffect, useState } from 'preact/hooks';
import { loadPortfolioSafe } from '@/data/portfolio-storage';
import { fetchSparklineWithCache } from '@/data/sparkline-fetch';
import { type ExchangeRates, type SupportedCurrency, CURRENCY_GLYPH, CURRENCY_DECIMALS } from '@/data/currency-schema';
import { computeSummary, type PortfolioSummary } from '@/data/portfolio-aggregate';
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

  if (file === null) return null;

  if (file.entries.length === 0) {
    return (
      <div class="portfolio-empty">
        <p>You haven't added any cards yet.</p>
        <p class="sub">Start by searching above, or paste an exported collection.</p>
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
        `}</style>
      </div>
    );
  }

  const summary: PortfolioSummary | null = dump
    ? computeSummary(file.entries, dump, rates, currency)
    : null;

  return (
    <div class="portfolio-populated">
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

      <style>{`
        .portfolio-stats {
          background: var(--paper);
          border: 1px solid #d9c9a3;
          border-radius: 10px;
          padding: 1rem 1.25rem;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 1rem;
          margin-bottom: 1.25rem;
        }
        .portfolio-stats .stat { text-align: center; }
        .portfolio-stats .lbl {
          font-size: 0.7rem; letter-spacing: 1.5px;
          text-transform: uppercase; color: var(--muted);
        }
        .portfolio-stats .val { font-size: 1.4rem; font-weight: 700; margin-top: 0.25rem; font-variant-numeric: tabular-nums; }
        .portfolio-stats .val.up { color: #2d7d47; }
        .portfolio-stats .val.dn { color: #b23a3a; }
        @media (max-width: 520px) {
          .portfolio-stats { grid-template-columns: repeat(2, 1fr); }
        }
      `}</style>
    </div>
  );
}
