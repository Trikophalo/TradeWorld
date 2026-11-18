/**
 * Many seats (ADR-218: up to 1.000): how many AI workers one hire offers, and how many seat rows a list draws before
 * it sums up the rest. Pure, tested in seats.test.ts.
 */

/** Hire sizes for the AI worker sheet: 1–3 for small companies, bigger steps up to every free seat for large ones. */
export function aiHireOptions(freeSlots: number): number[] {
  const free = Math.max(0, Math.floor(freeSlots));
  if (free <= 0) return [];
  if (free <= 3) return Array.from({ length: free }, (_, i) => i + 1);
  const steps = [1, 5, 10, 25, 50, 100, 250].filter((n) => n < free);
  const options = steps.length > 4 ? [1, ...steps.slice(-3)] : steps;
  return [...options, free];
}

/** Rows a seat list draws; the rest are summed up in one line ("… und 940 weitere"). */
export const SEAT_ROWS_MAX = 24;

export function visibleRows(count: number, max = SEAT_ROWS_MAX): { shown: number; more: number } {
  const n = Math.max(0, Math.floor(count));
  return n <= max ? { shown: n, more: 0 } : { shown: max, more: n - max };
}
