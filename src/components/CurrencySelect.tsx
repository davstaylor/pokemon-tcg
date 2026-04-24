import { useEffect, useState } from 'preact/hooks';
import { SUPPORTED_CURRENCIES, CURRENCY_GLYPH, CURRENCY_DECIMALS, type SupportedCurrency } from '@/data/currency-schema';
import { CURRENCY_STORAGE_KEY, detectDisplayCurrency } from '@/data/currency-storage';

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
  const [current, setCurrent] = useState<SupportedCurrency>('GBP');

  useEffect(() => {
    const detected = detectDisplayCurrency();
    setCurrent(detected);
    if (detected !== 'EUR') applyCurrencyToDOM(detected, rates);
    window.dispatchEvent(new CustomEvent('currencychange', { detail: { currency: detected } }));
  }, []);

  function onChange(e: Event) {
    const next = (e.target as HTMLSelectElement).value as SupportedCurrency;
    setCurrent(next);
    try { localStorage.setItem(CURRENCY_STORAGE_KEY, next); } catch {}
    applyCurrencyToDOM(next, rates);
    window.dispatchEvent(new CustomEvent('currencychange', { detail: { currency: next } }));
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
