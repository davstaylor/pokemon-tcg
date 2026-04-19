import { useEffect, useState } from 'preact/hooks';
import { SUPPORTED_CURRENCIES, CURRENCY_GLYPH, CURRENCY_DECIMALS, type SupportedCurrency } from '@/data/currency-schema';

const STORAGE_KEY = 'pokemon-tcg-currency';
const DEFAULT: SupportedCurrency = 'EUR';

function detectDefault(): SupportedCurrency {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_CURRENCIES as readonly string[]).includes(saved)) {
      return saved as SupportedCurrency;
    }
  } catch {}
  try {
    const locale = Intl.NumberFormat().resolvedOptions().locale;
    const region = locale.split('-')[1]?.toUpperCase();
    if (region === 'US') return 'USD';
    if (region === 'GB') return 'GBP';
    if (region === 'JP') return 'JPY';
  } catch {}
  return DEFAULT;
}

function applyCurrencyToDOM(next: SupportedCurrency, rates: { USD: number; GBP: number; JPY: number }) {
  document.querySelectorAll<HTMLElement>('[data-price-currency-field]').forEach((el) => {
    const eur = el.getAttribute('data-eur');
    if (eur === null || eur === '') return;
    const eurNum = Number(eur);
    if (!Number.isFinite(eurNum)) return;
    const value = next === 'EUR' ? eurNum : eurNum * rates[next];
    const decimals = CURRENCY_DECIMALS[next];
    const formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    el.textContent = `${CURRENCY_GLYPH[next]}${formatter.format(Math.abs(value))}`;
  });
}

export default function CurrencySelect({ rates }: { rates: { USD: number; GBP: number; JPY: number } }) {
  const [current, setCurrent] = useState<SupportedCurrency>(DEFAULT);

  useEffect(() => {
    const detected = detectDefault();
    setCurrent(detected);
    if (detected !== DEFAULT) applyCurrencyToDOM(detected, rates);
  }, []);

  function onChange(e: Event) {
    const next = (e.target as HTMLSelectElement).value as SupportedCurrency;
    setCurrent(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    applyCurrencyToDOM(next, rates);
  }

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '10px', color: '#7a5e3a', letterSpacing: '1px', textTransform: 'uppercase' }}>
        Currency
      </span>
      <select
        value={current}
        onChange={onChange}
        data-currency-select
        style={{
          padding: '4px 8px',
          border: '1px solid #d9c9a3',
          borderRadius: '16px',
          background: '#fffdf6',
          fontSize: '12px',
          color: '#3b2a1a',
          cursor: 'pointer',
        }}
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c} {CURRENCY_GLYPH[c]}
          </option>
        ))}
      </select>
    </label>
  );
}
