import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatAmount } from "../lib/formatAmount";
import { AddTransactionForm } from "../components/AddTransactionForm";

interface Summary {
  income_minor: string;
  expenditure_minor: string;
  balance_minor: string;
  count: number;
  main_currency_code: string;
}

interface TxnItem {
  id: string;
  type: string;
  amount: string;
  currency_code: string;
  occurred_at: string;
  note: string | null;
  category_name: string | null;
  account_name: string;
}

export function TransactionsPage() {
  const [showForm, setShowForm] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("");

  const { data: summary } = useQuery({
    queryKey: ["transactions", "summary"],
    queryFn: () => api.get<{ summary: Summary }>("/transactions/summary").then((r) => r.summary),
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ["transactions", "list", typeFilter],
    queryFn: () => api.get<{ items: TxnItem[] }>(`/transactions${typeFilter ? `?type=${typeFilter}` : ""}`).then((r) => r.items),
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Transactions</h1>
        <span className="count-badge">{summary?.count ?? 0}</span>
        <div className="head-spacer" />
        <select className="seg" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </select>
        <button className="btn-primary" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New"}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ margin: "0 var(--space-xl) var(--space-lg)", padding: "var(--space-lg)" }}>
          <AddTransactionForm onCreated={() => setShowForm(false)} />
        </div>
      )}

      {summary && (
        <div className="summary-grid">
          <div className="card stat-card">
            <div className="stat-card__label">Income</div>
            <div className="stat-card__figure stat-card__figure--positive">
              {summary.main_currency_code} {formatAmount(summary.income_minor, summary.main_currency_code)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-card__label">Expenditure</div>
            <div className="stat-card__figure stat-card__figure--negative">
              {summary.main_currency_code} {formatAmount(summary.expenditure_minor, summary.main_currency_code)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-card__label">Balance</div>
            <div className="stat-card__figure">
              {summary.main_currency_code} {formatAmount(summary.balance_minor, summary.main_currency_code)}
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-card__label">Transactions</div>
            <div className="stat-card__figure">{summary.count}</div>
          </div>
        </div>
      )}

      <div className="card txn-card" style={{ margin: "0 var(--space-xl) var(--space-2xl)" }}>
        {isLoading && <p className="muted">Loading…</p>}
        {items?.map((t) => (
          <div className="txn-row" key={t.id}>
            <span className="cat-badge">{(t.category_name ?? t.account_name).charAt(0).toUpperCase()}</span>
            <div className="txn-row__body">
              <div className="txn-row__top">
                <span className="txn-row__cat">{t.category_name ?? "Transfer"}</span>
                <span className="txn-row__time">{new Date(t.occurred_at).toLocaleString()}</span>
              </div>
              {t.note && <div className="txn-row__note">{t.note}</div>}
            </div>
            <span className={`amount amount--${t.type === "expense" ? "neg" : "pos"}`}>
              {t.type === "expense" ? "-" : "+"}
              {formatAmount(t.amount, t.currency_code)}
            </span>
          </div>
        ))}
        {items?.length === 0 && <p className="muted">No transactions yet.</p>}
      </div>
    </div>
  );
}
