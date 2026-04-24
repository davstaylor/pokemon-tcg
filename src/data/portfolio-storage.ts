import type { ExchangeRates } from './currency-schema';
import { convertBetween } from './currency';
import type { PortfolioEntry, PortfolioFile, NewEntryInput } from './portfolio-schema';
import { PortfolioFileSchema } from './portfolio-schema';

export const PORTFOLIO_STORAGE_KEY = 'pokemon-tcg:portfolio';

export function loadPortfolio(): PortfolioFile {
  return loadPortfolioSafe().file;
}

export function loadPortfolioSafe(): { file: PortfolioFile; corrupted: boolean } {
  try {
    const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
    if (raw === null) return { file: { version: 1, entries: [] }, corrupted: false };
    const parsed = JSON.parse(raw);
    const validated = PortfolioFileSchema.parse(parsed);
    return { file: validated, corrupted: false };
  } catch {
    return { file: { version: 1, entries: [] }, corrupted: true };
  }
}

export function savePortfolio(file: PortfolioFile): void {
  localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(file));
}

// Pure function: merge a new add into the existing file. See Task 2 tests for
// the dedup + cross-currency merging semantics.
export function addEntry(
  file: PortfolioFile,
  input: NewEntryInput,
  rates: ExchangeRates,
  todayIso: string,
): PortfolioFile {
  const existingIdx = file.entries.findIndex((e) => e.cardId === input.cardId);
  if (existingIdx === -1) {
    const entry: PortfolioEntry = {
      cardId: input.cardId,
      qty: input.qty,
      costValue: input.costValue,
      costCurrency: input.costCurrency,
      addedAt: todayIso,
    };
    return { ...file, entries: [...file.entries, entry] };
  }
  const existing = file.entries[existingIdx];
  const convertedNewCost =
    input.costCurrency === existing.costCurrency
      ? input.costValue
      : convertBetween(input.costValue, input.costCurrency, existing.costCurrency, rates);
  const merged: PortfolioEntry = {
    ...existing,
    qty: existing.qty + input.qty,
    costValue: existing.costValue + convertedNewCost,
  };
  const entries = [...file.entries];
  entries[existingIdx] = merged;
  return { ...file, entries };
}

export function removeEntry(file: PortfolioFile, cardId: string): PortfolioFile {
  const filtered = file.entries.filter((e) => e.cardId !== cardId);
  if (filtered.length === file.entries.length) return file;  // no-op
  return { ...file, entries: filtered };
}

export function updateEntry(
  file: PortfolioFile,
  cardId: string,
  patch: { qty?: number; costValue?: number },
): PortfolioFile {
  if (patch.qty !== undefined && patch.qty < 1) {
    throw new Error('updateEntry: qty must be ≥ 1 (use removeEntry to delete)');
  }
  const idx = file.entries.findIndex((e) => e.cardId === cardId);
  if (idx === -1) return file;
  const merged: PortfolioEntry = {
    ...file.entries[idx],
    ...(patch.qty !== undefined ? { qty: patch.qty } : {}),
    ...(patch.costValue !== undefined ? { costValue: patch.costValue } : {}),
  };
  const entries = [...file.entries];
  entries[idx] = merged;
  return { ...file, entries };
}
