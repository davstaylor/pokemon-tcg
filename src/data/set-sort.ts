// Numeric-aware collation for card collector numbers.
//
// TCGdex's `localId` is a string that is either a pure integer ("4", "10")
// or contains letters ("SWSH01", "TG1", "H1"). Sorting by string would put
// "10" before "2"; sorting by parseInt would lose the alpha suffix. This
// comparator does the expected thing: pure numeric ascending, then alpha,
// with both sections ordered predictably.
export function compareLocalIds(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  const aNumeric = Number.isFinite(na) && String(na) === a;
  const bNumeric = Number.isFinite(nb) && String(nb) === b;
  if (aNumeric && bNumeric) return na - nb;
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a.localeCompare(b);
}
