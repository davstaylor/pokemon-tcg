import { useEffect, useState } from 'preact/hooks';
import { loadPortfolioSafe } from '@/data/portfolio-storage';
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
      `}</style>
    </div>
  );
}
