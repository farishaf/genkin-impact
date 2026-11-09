import { useState } from "react";
import { formatMoney } from "../lib/formatAmount";
import { groupByCategory, lineMinor, type ReceiptLine } from "../lib/receiptLines";

interface Category {
  id: string;
  name: string;
  emoji?: string | null;
}

export function ReceiptItems({
  store,
  onStore,
  date,
  lines,
  onLines,
  categories,
  currency,
  digits,
  printedTotal,
}: {
  store: string;
  onStore: (s: string) => void;
  date: string;
  lines: ReceiptLine[];
  onLines: (l: ReceiptLine[]) => void;
  categories: Category[];
  currency: string;
  digits: number;
  printedTotal: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const money = (minor: number) => formatMoney(String(minor), currency);
  const catLabel = (id: string) => {
    const c = categories.find((x) => x.id === id);
    return c ? `${c.emoji ? `${c.emoji} ` : ""}${c.name}` : "No category";
  };
  const upd = (id: string, patch: Partial<ReceiptLine>) => onLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const groups = groupByCategory(lines, digits);
  const total = groups.reduce((s, [, g]) => s + g.minor, 0);
  const printedMinor = printedTotal == null ? null : Math.round(printedTotal * 10 ** digits);
  const off = printedMinor == null ? 0 : total - printedMinor;
  const when = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  return (
    <>
      <section className="receipt-card" aria-label="Recognized items">
        <header className="receipt-card__head">
          {editing ? (
            <input className="receipt-card__store-input" value={store} maxLength={120} aria-label="Store" placeholder="Store" onChange={(e) => onStore(e.target.value)} />
          ) : (
            <h3 className="receipt-card__store">{store || "Receipt"}</h3>
          )}
          <p className="receipt-card__sub">Scanned · {when}</p>
        </header>

        <div className="receipt-card__bar">
          <span>Items</span>
          <button type="button" className="btn--ghost" onClick={() => setEditing((e) => !e)}>
            {editing ? "Done" : "Edit items"}
          </button>
        </div>

        {editing ? (
          <ul className="receipt-card__edit">
            {lines.map((l) => (
              <li key={l.id}>
                <input value={l.name} aria-label="Item name" placeholder="Item" maxLength={200} onChange={(e) => upd(l.id, { name: e.target.value })} />
                <input value={l.qty} aria-label="Quantity" inputMode="decimal" onChange={(e) => upd(l.id, { qty: e.target.value })} />
                <input value={l.price} aria-label="Unit price" inputMode="decimal" onChange={(e) => upd(l.id, { price: e.target.value })} />
                <select value={l.category_id} aria-label="Category" onChange={(e) => upd(l.id, { category_id: e.target.value })}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {catLabel(c.id)}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn icon-btn--danger" aria-label={`Remove ${l.name || "item"}`} onClick={() => onLines(lines.filter((x) => x.id !== l.id))}>
                  ×
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="btn--ghost"
                onClick={() => onLines([...lines, { id: crypto.randomUUID(), name: "", qty: "1", price: "", category_id: lines.at(-1)?.category_id ?? categories[0]?.id ?? "" }])}
              >
                + Add item
              </button>
            </li>
          </ul>
        ) : (
          <ul className="receipt-card__items">
            {lines.map((l) => (
              <li key={l.id}>
                <span className="receipt-card__name">
                  {l.name || "Item"}
                  <small>{catLabel(l.category_id)}</small>
                </span>
                <span className="receipt-card__qty">{l.qty}×</span>
                <span className="receipt-card__amt">{money(lineMinor(l, digits))}</span>
              </li>
            ))}
          </ul>
        )}

        <dl className="receipt-card__totals">
          <div className="receipt-card__total">
            <dt>Total</dt>
            <dd>{money(total)}</dd>
          </div>
          {printedMinor != null && (
            <div className={off ? "receipt-card__check receipt-card__check--off" : "receipt-card__check"}>
              <dt>Receipt says</dt>
              <dd>{off ? `${money(printedMinor)} · off by ${money(Math.abs(off))}` : `${money(printedMinor)} · matches`}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="receipt-card" aria-label="By category">
        <div className="receipt-card__bar">
          <span>By category</span>
          <span className="muted-inline">
            {groups.length} expense{groups.length === 1 ? "" : "s"}
          </span>
        </div>
        <ul className="receipt-card__cats">
          {groups
            .slice()
            .sort((a, b) => b[1].minor - a[1].minor)
            .map(([id, g]) => (
              <li key={id}>
                <span className="receipt-card__name">
                  {catLabel(id)}
                  <small>
                    {g.lines.length} item{g.lines.length === 1 ? "" : "s"}
                  </small>
                </span>
                <span className="receipt-card__amt">{money(g.minor)}</span>
                <span className="receipt-card__meter" aria-hidden="true">
                  <span style={{ width: `${total ? (g.minor / total) * 100 : 0}%` }} />
                </span>
              </li>
            ))}
        </ul>
      </section>
    </>
  );
}
