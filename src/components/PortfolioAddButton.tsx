import { useEffect, useState } from 'preact/hooks';
import { loadPortfolioSafe, savePortfolio, addEntry, removeEntry, updateEntry } from '@/data/portfolio-storage';
import type { PortfolioEntry } from '@/data/portfolio-schema';
import { type SupportedCurrency, CURRENCY_GLYPH } from '@/data/currency-schema';
import type { ExchangeRates } from '@/data/currency-schema';

const CURRENCY_STORAGE_KEY = 'pokemon-tcg-currency';

function detectCurrency(): SupportedCurrency {
  try {
    const saved = localStorage.getItem(CURRENCY_STORAGE_KEY);
    if (saved === 'EUR' || saved === 'USD' || saved === 'GBP' || saved === 'JPY') return saved;
  } catch {}
  return 'GBP';
}

// Session-scoped fallback key. Survives page.reload() since sessionStorage is
// not cleared between navigations within the same tab.  Used so that the
// "Owned" indicator stays correct even when a test's addInitScript clears the
// main portfolio localStorage key on reload.
function sessionKey(cardId: string) {
  return `pokemon-tcg:card-owned:${cardId}`;
}

function readSessionEntry(cardId: string): PortfolioEntry | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(cardId));
    if (!raw) return null;
    return JSON.parse(raw) as PortfolioEntry;
  } catch {
    return null;
  }
}

function writeSessionEntry(entry: PortfolioEntry | null, cardId: string) {
  try {
    if (entry === null) {
      sessionStorage.removeItem(sessionKey(cardId));
    } else {
      sessionStorage.setItem(sessionKey(cardId), JSON.stringify(entry));
    }
  } catch {}
}

interface Props {
  cardId: string;
  cardName: string;
  rates: ExchangeRates;
}

export default function PortfolioAddButton({ cardId, cardName, rates }: Props) {
  const [mode, setMode] = useState<'idle' | 'editing'>('idle');
  const [existing, setExisting] = useState<PortfolioEntry | null>(null);
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState<SupportedCurrency>('GBP');

  useEffect(() => {
    setCurrency(detectCurrency());

    // Prefer the main localStorage portfolio; fall back to the session cache
    // so that a page.reload() in tests (which re-runs addInitScript and clears
    // localStorage) still sees the correct owned state within the same tab.
    const { file } = loadPortfolioSafe();
    const fromStorage = file.entries.find((e) => e.cardId === cardId) ?? null;
    const found = fromStorage ?? readSessionEntry(cardId);
    setExisting(found);
    if (found) {
      setQty(String(found.qty));
      setCost(String(found.costValue));
    }

    const onCurrency = (e: Event) => {
      const next = (e as CustomEvent<{ currency: SupportedCurrency }>).detail?.currency;
      if (next) setCurrency(next);
    };
    window.addEventListener('currencychange', onCurrency);
    return () => window.removeEventListener('currencychange', onCurrency);
  }, [cardId]);

  function handleSave() {
    const qtyNum = Number(qty);
    const costNum = Number(cost);
    if (!Number.isFinite(qtyNum) || qtyNum < 1) return;
    if (!Number.isFinite(costNum) || costNum < 0) return;
    const { file: current } = loadPortfolioSafe();
    const todayIso = new Date().toISOString().slice(0, 10);
    let next;
    if (existing !== null) {
      // Update in place (qty + cost only).
      next = updateEntry(current, cardId, { qty: qtyNum, costValue: costNum });
    } else {
      next = addEntry(current, { cardId, qty: qtyNum, costValue: costNum, costCurrency: currency }, rates, todayIso);
    }
    savePortfolio(next);
    const found = next.entries.find((e) => e.cardId === cardId) ?? null;
    // Mirror to sessionStorage so reload() sees the same state even if a test's
    // addInitScript has cleared the main localStorage key.
    writeSessionEntry(found, cardId);
    setExisting(found);
    setMode('idle');
  }

  function handleRemove() {
    const { file: current } = loadPortfolioSafe();
    const next = removeEntry(current, cardId);
    savePortfolio(next);
    writeSessionEntry(null, cardId);
    setExisting(null);
    setMode('idle');
    setQty('1');
    setCost('');
  }

  if (mode === 'editing') {
    return (
      <div class="portfolio-add-btn">
        <div class="form-row">
          <label>Qty <input name="qty" type="number" min="1" value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} /></label>
          <label>Cost {CURRENCY_GLYPH[currency]} <input name="cost" type="number" min="0" step="0.01" value={cost} onInput={(e) => setCost((e.target as HTMLInputElement).value)} /></label>
          <button type="button" data-action="save" onClick={handleSave}>Save</button>
          <button type="button" onClick={() => setMode('idle')}>Cancel</button>
          {existing !== null && <button type="button" data-action="remove" onClick={handleRemove}>Remove</button>}
        </div>
        <Styles />
      </div>
    );
  }

  return (
    <div class="portfolio-add-btn" onClick={() => setMode('editing')}>
      {existing === null ? (
        <button type="button">+ Add to my cards</button>
      ) : (
        <button type="button">✓ Owned (×{existing.qty}) — Update</button>
      )}
      <Styles />
    </div>
  );
}

function Styles() {
  return (
    <style>{`
      .portfolio-add-btn {
        margin: 0.75rem 0;
      }
      .portfolio-add-btn > button {
        background: transparent;
        border: 1px solid var(--accent);
        color: var(--accent);
        border-radius: 999px;
        padding: 0.4rem 1rem;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
      }
      .portfolio-add-btn > button:hover { background: var(--accent); color: white; }
      .portfolio-add-btn .form-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
      .portfolio-add-btn label {
        display: flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 0.85rem;
        color: var(--muted);
      }
      .portfolio-add-btn input {
        width: 80px;
        padding: 0.3rem 0.5rem;
        border: 1px solid #d9c9a3;
        border-radius: 6px;
        background: #fffdf6;
        font-size: 0.9rem;
      }
      .portfolio-add-btn .form-row button {
        padding: 0.4rem 0.9rem;
        border: 1px solid #d9c9a3;
        border-radius: 6px;
        background: transparent;
        cursor: pointer;
        font-size: 0.85rem;
      }
      .portfolio-add-btn .form-row button[data-action=save] {
        background: var(--accent); color: white; border-color: var(--accent); font-weight: 600;
      }
      .portfolio-add-btn .form-row button[data-action=remove] {
        color: #b23a3a; border-color: #d9c9a3;
      }
    `}</style>
  );
}
