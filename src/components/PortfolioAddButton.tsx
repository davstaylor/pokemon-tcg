import { useEffect, useState } from 'preact/hooks';
import { loadPortfolioSafe, savePortfolio, addEntry, removeEntry, updateEntry } from '@/data/portfolio-storage';
import type { PortfolioEntry } from '@/data/portfolio-schema';
import { type SupportedCurrency, CURRENCY_GLYPH } from '@/data/currency-schema';
import type { ExchangeRates } from '@/data/currency-schema';
import { detectDisplayCurrency } from '@/data/currency-storage';

interface Props {
  cardId: string;
  cardName: string;
  rates: ExchangeRates;
}

export default function PortfolioAddButton({ cardId, cardName, rates }: Props) {
  const [mode, setMode] = useState<'idle' | 'editing' | 'justSaved'>('idle');
  const [existing, setExisting] = useState<PortfolioEntry | null>(null);
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState<SupportedCurrency>('GBP');
  const [priorEntry, setPriorEntry] = useState<PortfolioEntry | null>(null);
  const [justSavedKind, setJustSavedKind] = useState<'added' | 'updated'>('added');

  useEffect(() => {
    setCurrency(detectDisplayCurrency());

    const { file } = loadPortfolioSafe();
    const found = file.entries.find((e) => e.cardId === cardId) ?? null;
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

  useEffect(() => {
    if (mode !== 'justSaved') return;
    const t = window.setTimeout(() => {
      setMode('idle');
      setPriorEntry(null);
    }, 5000);
    return () => window.clearTimeout(t);
  }, [mode]);

  function handleSave() {
    const qtyNum = Number(qty);
    const costNum = Number(cost);
    if (!Number.isFinite(qtyNum) || qtyNum < 1) return;
    if (!Number.isFinite(costNum) || costNum < 0) return;
    const { file: current } = loadPortfolioSafe();
    const todayIso = new Date().toISOString().slice(0, 10);

    // Capture the pre-save snapshot so Undo can restore.
    const prior = current.entries.find((e) => e.cardId === cardId) ?? null;

    let next;
    if (existing !== null) {
      // Update in place (qty + cost only).
      next = updateEntry(current, cardId, { qty: qtyNum, costValue: costNum });
      setJustSavedKind('updated');
    } else {
      next = addEntry(current, { cardId, qty: qtyNum, costValue: costNum, costCurrency: currency }, rates, todayIso);
      setJustSavedKind('added');
    }
    savePortfolio(next);
    const found = next.entries.find((e) => e.cardId === cardId) ?? null;
    setExisting(found);
    setPriorEntry(prior);
    setMode('justSaved');
  }

  function handleRemove() {
    const { file: current } = loadPortfolioSafe();
    const next = removeEntry(current, cardId);
    savePortfolio(next);
    setExisting(null);
    setMode('idle');
    setQty('1');
    setCost('');
  }

  function handleUndo() {
    const { file: current } = loadPortfolioSafe();
    let next;
    if (priorEntry === null) {
      // Fresh add → remove the entry.
      next = removeEntry(current, cardId);
    } else {
      // Update → restore prior qty + costValue (currency doesn't change on update).
      next = updateEntry(current, cardId, { qty: priorEntry.qty, costValue: priorEntry.costValue });
    }
    savePortfolio(next);
    const found = next.entries.find((e) => e.cardId === cardId) ?? null;
    setExisting(found);
    if (found) {
      setQty(String(found.qty));
      setCost(String(found.costValue));
    } else {
      setQty('1');
      setCost('');
    }
    setPriorEntry(null);
    setMode('idle');
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

  if (mode === 'justSaved' && existing !== null) {
    const kindLabel = justSavedKind === 'added' ? 'Added' : 'Updated';
    return (
      <div class="portfolio-add-btn">
        <div class="just-saved-row">
          <span class="just-saved-text">✓ {kindLabel} (×{existing.qty})</span>
          <button type="button" class="undo-btn" data-action="undo" onClick={handleUndo}>Undo</button>
        </div>
        <Styles />
      </div>
    );
  }

  return (
    <div class="portfolio-add-btn">
      {existing === null ? (
        <button type="button" onClick={() => setMode('editing')}>+ Add to my cards</button>
      ) : (
        <button type="button" onClick={() => setMode('editing')}>✓ Owned (×{existing.qty}) — Update</button>
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
      .portfolio-add-btn .just-saved-row {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.4rem 1rem;
        border: 1px solid var(--accent);
        border-radius: 999px;
        background: rgba(200, 111, 61, 0.08);
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--accent);
      }
      .portfolio-add-btn .just-saved-row .undo-btn {
        padding: 0.1rem 0.5rem;
        border: 1px solid var(--accent);
        border-radius: 999px;
        background: var(--accent);
        color: white;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
      }
      .portfolio-add-btn .just-saved-row .undo-btn:hover {
        background: transparent;
        color: var(--accent);
      }
    `}</style>
  );
}
