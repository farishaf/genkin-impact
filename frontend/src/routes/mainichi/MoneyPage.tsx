import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { decimalDigits, formatMoney } from "../../lib/formatAmount";
import { newItemId, toKey, todayKey } from "../../lib/planner";
import { Icon } from "./parts";

// Money in Mainichi is a thin view over Genkin-Impact: purchases are written as ordinary expense
// transactions, so budgets, analytics and balances there stay the single source of truth.

interface Account { id: string; name: string; currency_code: string }
interface Category { id: string; name: string; emoji: string | null }
interface Txn {
  id: string;
  amount: string;
  currency_code: string;
  occurred_at: string;
  note: string | null;
  category_name: string | null;
  category_emoji: string | null;
  account_name: string;
}
interface Summary { expenditure_minor: string; count: number; main_currency_code: string }
interface Line { id: string; name: string; qty: string; price: string; category_id: string }

const monthRange = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${ym}-01`, to: toKey(new Date(y, m, 0)) };
};

function PurchaseForm({ accounts, categories }: { accounts: Account[]; categories: Category[] }) {
  const qc = useQueryClient();
  const blankLine = (): Line => ({ id: newItemId(), name: "", qty: "1", price: "", category_id: categories[0]?.id ?? "" });
  const [store, setStore] = useState("");
  const [date, setDate] = useState(todayKey());
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const digits = decimalDigits(account?.currency_code ?? "IDR");
  const lineTotal = (l: Line) => (parseFloat(l.qty) || 0) * (parseFloat(l.price) || 0);
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const valid = lines.filter((l) => lineTotal(l) > 0);
  const updLine = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const send = useMutation({
    mutationFn: async () => {
      // One expense per category, so Genkin-Impact's category budgets and reports stay accurate.
      const groups = new Map<string, Line[]>();
      for (const l of valid) groups.set(l.category_id, [...(groups.get(l.category_id) ?? []), l]);
      const occurred = date === todayKey() ? new Date() : new Date(`${date}T12:00:00`);
      const ids: string[] = [];
      for (const [categoryId, items] of groups) {
        const amount = items.reduce((s, l) => s + lineTotal(l), 0).toFixed(digits);
        const list = items.map((l) => `${l.name || "Item"}${parseFloat(l.qty) !== 1 ? ` ×${l.qty}` : ""}`).join(", ");
        const note = `${store ? `${store}: ` : ""}${list}`.slice(0, 500);
        const res = await api.post<{ transaction: { id: string } }>("/transactions", {
          type: "expense",
          account_id: accountId,
          category_id: categoryId,
          amount,
          occurred_at: occurred.toISOString(),
          note,
        });
        ids.push(res.transaction.id);
      }
      if (receipt && ids[0]) {
        const fd = new FormData();
        fd.append("file", receipt);
        await api.postForm(`/transactions/${ids[0]}/attachments`, fd);
      }
      return ids.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["mainichi-money"] });
      setSent(`Logged ${count} expense${count === 1 ? "" : "s"}.`);
      setStore("");
      setLines([blankLine()]);
      setReceipt(null);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSent(null);
    if (valid.length && accountId) send.mutate();
  }

  return (
    <form className="mi-receipt" onSubmit={submit}>
      <div className="mi-receipt__meta">
        <input className="mi-receipt__store" value={store} placeholder="Store, e.g. Superindo" aria-label="Store" maxLength={120} onChange={(e) => setStore(e.target.value)} />
        <input type="date" className="mi-receipt__date" value={date} aria-label="Date" onChange={(e) => setDate(e.target.value || todayKey())} />
        <select className="mi-receipt__acct" value={accountId} aria-label="Paid from" onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency_code})</option>)}
        </select>
      </div>

      <div className="mi-lines">
        <div className="mi-lines__row mi-lines__row--head">
          <span>Item</span>
          <span>Qty</span>
          <span>Price</span>
          <span>Category</span>
          <span />
        </div>
        {lines.map((l, i) => (
          <div key={l.id} className="mi-lines__row">
            <input value={l.name} placeholder="Item" aria-label={`Item ${i + 1} name`} onChange={(e) => updLine(l.id, { name: e.target.value })} />
            <input value={l.qty} inputMode="decimal" aria-label={`Item ${i + 1} quantity`} onChange={(e) => updLine(l.id, { qty: e.target.value })} />
            <input
              value={l.price}
              inputMode="decimal"
              placeholder="0"
              aria-label={`Item ${i + 1} price`}
              onChange={(e) => updLine(l.id, { price: e.target.value.replace(/[^\d.]/g, "") })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && i === lines.length - 1) {
                  e.preventDefault();
                  setLines((ls) => [...ls, { ...blankLine(), category_id: l.category_id }]);
                }
              }}
            />
            <select value={l.category_id} aria-label={`Item ${i + 1} category`} onChange={(e) => updLine(l.id, { category_id: e.target.value })}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ""}{c.name}</option>)}
            </select>
            <button type="button" className="icon-btn icon-btn--danger" aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>
              <Icon name="x" />
            </button>
          </div>
        ))}
        <button type="button" className="mi-textbtn mi-lines__add" onClick={() => setLines((ls) => [...ls, { ...blankLine(), category_id: ls[ls.length - 1]?.category_id ?? "" }])}>
          + Add line
        </button>
      </div>

      <div className="mi-receipt__foot">
        <label className="mi-pill mi-receipt__file">
          <Icon name="file" />
          {receipt ? receipt.name : "Attach receipt photo"}
          <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
        </label>
        <div className="mi-top__spacer" />
        <div className="mi-receipt__total">
          <span>Total</span>
          <strong>{formatMoney(String(Math.round(total * 10 ** digits)), account?.currency_code ?? "IDR")}</strong>
        </div>
      </div>

      {send.error && <p className="field-error">{send.error.message}</p>}
      {sent && <p className="mi-sent"><Icon name="check" /> {sent}</p>}

      <button type="submit" className="mi-solid mi-receipt__send" disabled={!valid.length || !accountId || send.isPending}>
        {send.isPending ? "Logging…" : "Log purchase"}
      </button>
    </form>
  );
}

export function MoneyPage() {
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month")! : todayKey().slice(0, 7);
  const { from, to } = monthRange(month);
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const next = toKey(new Date(y, m - 1 + n, 1)).slice(0, 7);
    setParams(next === todayKey().slice(0, 7) ? {} : { month: next }, { replace: true });
  };
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const summary = useQuery({
    queryKey: ["mainichi-money", "summary", month],
    queryFn: () => api.get<{ summary: Summary }>(`/transactions/summary?type=expense&from=${from}&to=${to}`).then((r) => r.summary),
    retry: false,
  });
  const recent = useQuery({
    queryKey: ["mainichi-money", "recent", month],
    queryFn: () => api.get<{ items: Txn[] }>(`/transactions?type=expense&from=${from}&to=${to}&limit=12`).then((r) => r.items),
  });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: () => api.get<{ accounts: Account[] }>("/accounts").then((r) => r.accounts) });
  const categories = useQuery({
    queryKey: ["categories", "expense"],
    queryFn: () => api.get<{ categories: Category[] }>("/categories?kind=expense").then((r) => r.categories),
  });

  const notSetUp = summary.error instanceof ApiError && summary.error.code === "no_main_currency";

  return (
    <div className="mi-cols mi-money">
      <div className="mi-cols__main mi-money__main">
        <section className="mi-sheet mi-monthsheet" aria-label="Spending this month">
          <div className="mi-dayhead">
            <div className="mi-dayhead__titles">
              <span className="mi-monthsheet__name">Spending in {monthName}</span>
              <span className="mi-money__total">
                {summary.data ? formatMoney(summary.data.expenditure_minor, summary.data.main_currency_code) : notSetUp ? "Not set up yet" : "…"}
              </span>
              <span className="mi-monthsheet__name">
                {summary.data ? `${summary.data.count} expense${summary.data.count === 1 ? "" : "s"} this month` : ""}
              </span>
            </div>
            <button type="button" className="mi-iconbtn" aria-label="Previous month" onClick={() => shift(-1)}><Icon name="back" /></button>
            <button type="button" className="mi-iconbtn" aria-label="Next month" onClick={() => shift(1)}><Icon name="chevron" /></button>
          </div>
        </section>

        <section className="card mi-card">
          <div className="mi-sechead">
            <h2 className="mi-h2">Log a purchase</h2>
            <span className="mi-count">Lines are grouped per category into expenses</span>
          </div>
          {notSetUp || (accounts.data && accounts.data.length === 0) ? (
            <p className="mi-empty">
              Set up your money first (main currency and at least one account).{" "}
              <Link to={notSetUp ? "/onboarding" : "/mainichi/money/assets"} className="mi-link">Set up</Link>
            </p>
          ) : accounts.data && categories.data ? (
            <PurchaseForm accounts={accounts.data} categories={categories.data} />
          ) : (
            <p className="mi-empty">Loading…</p>
          )}
        </section>
      </div>

      <section className="card mi-card mi-cols__side">
        <div className="mi-sechead">
          <h2 className="mi-h2">Recent purchases</h2>
          <Link to="/mainichi/money/transactions" className="mi-textbtn">All transactions</Link>
        </div>
        {recent.data?.length ? (
          <div className="mi-list mi-list--tight">
            {recent.data.map((t) => (
              <div key={t.id} className="mi-pagerow mi-txn">
                <span className="mi-tile">{t.category_emoji || <Icon name="receipt" />}</span>
                <span className="mi-pagerow__text">
                  <span className="mi-pagerow__title">{t.note || t.category_name || "Expense"}</span>
                  <span className="mi-pagerow__sub">
                    {new Date(t.occurred_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}, {t.account_name}
                  </span>
                </span>
                <span className="mi-txn__amt">−{formatMoney(t.amount, t.currency_code)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mi-empty">{recent.isLoading ? "Loading…" : "No purchases this month."}</p>
        )}
      </section>
    </div>
  );
}
