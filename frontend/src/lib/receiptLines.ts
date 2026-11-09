export interface ReceiptLine {
  id: string;
  name: string;
  qty: string;
  price: string;
  category_id: string;
}

/** A line's total in minor units. Integer math, so per-category sums add up to the receipt total exactly. */
export const lineMinor = (l: ReceiptLine, digits: number) => Math.round((parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0) * 10 ** digits);

/** Lines with a positive total, grouped per category in first-seen order: one expense per group. */
export function groupByCategory(lines: ReceiptLine[], digits: number) {
  const groups = new Map<string, { lines: ReceiptLine[]; minor: number }>();
  for (const l of lines) {
    const m = lineMinor(l, digits);
    if (m <= 0) continue;
    const g = groups.get(l.category_id) ?? { lines: [], minor: 0 };
    g.lines.push(l);
    g.minor += m;
    groups.set(l.category_id, g);
  }
  return [...groups];
}
