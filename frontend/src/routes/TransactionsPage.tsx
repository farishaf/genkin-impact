import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { api } from "../lib/api";
import { formatAmount } from "../lib/formatAmount";
import { AddTransactionForm, type EditingTxn } from "../components/AddTransactionForm";

gsap.registerPlugin(useGSAP);

interface Summary {
  income_minor: string;
  expenditure_minor: string;
  balance_minor: string;
  count: number;
  main_currency_code: string;
}

interface TxnItem {
  id: string;
  type: "expense" | "income" | "transfer";
  account_id: string;
  to_account_id: string | null;
  category_id: string | null;
  member_id: string | null;
  amount: string;
  currency_code: string;
  occurred_at: string;
  note: string | null;
  category_name: string | null;
  account_name: string;
  member_name: string | null;
  tags: { id: string; name: string }[];
}
interface Member {
  id: string;
  name: string;
}
interface Tag {
  id: string;
  name: string;
}
interface Category {
  id: string;
  name: string;
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function TransactionsPage() {
  const [showForm, setShowForm] = useState(false);
  const [editingTxn, setEditingTxn] = useState<EditingTxn | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [memberFilter, setMemberFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const qc = useQueryClient();

  const { data: summary, isError: isSummaryError } = useQuery({
    queryKey: ["transactions", "summary"],
    queryFn: () => api.get<{ summary: Summary }>("/transactions/summary").then((r) => r.summary),
  });

  const { data: members } = useQuery({
    queryKey: ["members"],
    queryFn: () => api.get<{ members: Member[] }>("/members").then((r) => r.members),
  });
  const { data: tags } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.get<{ tags: Tag[] }>("/tags").then((r) => r.tags),
  });
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<{ categories: Category[] }>("/categories").then((r) => r.categories),
  });

  const { data: items, isLoading, isError: isItemsError } = useQuery({
    queryKey: ["transactions", "list", typeFilter, memberFilter, tagFilter, categoryFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (memberFilter) params.set("member_id", memberFilter);
      if (tagFilter) params.set("tag_id", tagFilter);
      if (categoryFilter) params.set("category_id", categoryFilter);
      const qs = params.toString();
      return api.get<{ items: TxnItem[] }>(`/transactions${qs ? `?${qs}` : ""}`).then((r) => r.items);
    },
  });

  const deleteTxn = useMutation({
    mutationFn: (id: string) => api.del(`/transactions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const { contextSafe } = useGSAP({ scope: listRef });

  const handleDelete = contextSafe((t: TxnItem) => {
    if (!confirm(`Delete this ${t.type === "expense" ? "-" : "+"}${formatAmount(t.amount, t.currency_code)} ${t.category_name ?? "transfer"}?`)) return;
    const el = rowRefs.current[t.id];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduced) {
      deleteTxn.mutate(t.id);
      return;
    }
    gsap.to(el, { opacity: 0, x: 8, duration: 0.2, ease: "power2.out", onComplete: () => deleteTxn.mutate(t.id) });
  });

  function openCreate() {
    setEditingTxn(null);
    setShowForm(true);
  }
  function openEdit(t: TxnItem) {
    setEditingTxn({
      id: t.id,
      type: t.type,
      account_id: t.account_id,
      to_account_id: t.to_account_id,
      category_id: t.category_id,
      member_id: t.member_id,
      amount: t.amount,
      currency_code: t.currency_code,
      note: t.note,
      tags: t.tags,
    });
    setShowForm(true);
  }
  function closeForm() {
    setShowForm(false);
    setEditingTxn(null);
  }

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
        <select className="seg" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)}>
          <option value="">All members</option>
          {(members ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select className="seg" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">All tags</option>
          {(tags ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="seg" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="btn-primary" type="button" onClick={() => (showForm ? closeForm() : openCreate())}>
          {showForm ? "Cancel" : "+ New"}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ margin: "0 var(--space-xl) var(--space-lg)", padding: "var(--space-lg)" }}>
          <AddTransactionForm key={editingTxn?.id ?? "new"} editing={editingTxn} onDone={closeForm} />
        </div>
      )}

      {isSummaryError && <p className="field-error" style={{ margin: "0 var(--space-xl) var(--space-lg)" }}>Failed to load summary. Try refreshing.</p>}

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

      <div className="card txn-card" style={{ margin: "0 var(--space-xl) var(--space-2xl)" }} ref={listRef}>
        {isItemsError && <p className="field-error">Failed to load transactions. Try refreshing.</p>}
        {isLoading && <p className="muted">Loading…</p>}
        {items?.map((t) => (
          <div
            className="txn-row"
            key={t.id}
            ref={(el) => {
              rowRefs.current[t.id] = el;
            }}
          >
            <span className="cat-badge">{(t.category_name ?? t.account_name).charAt(0).toUpperCase()}</span>
            <div className="txn-row__body">
              <div className="txn-row__top">
                <span className="txn-row__cat">{t.category_name ?? "Transfer"}</span>
                <span className="txn-row__time">{new Date(t.occurred_at).toLocaleString()}</span>
              </div>
              {t.note && <div className="txn-row__note">{t.note}</div>}
              {(t.member_name || t.tags.length > 0) && (
                <div className="txn-row__meta">
                  {t.member_name && <span className="tag-chip tag-chip--static">{t.member_name}</span>}
                  {t.tags.map((tag) => (
                    <span key={tag.id} className="tag-chip tag-chip--static">
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <span className={`amount amount--${t.type === "expense" ? "neg" : "pos"}`}>
              {t.type === "expense" ? "-" : "+"}
              {formatAmount(t.amount, t.currency_code)}
            </span>
            <div className="txn-row__actions">
              <button type="button" className="icon-btn" aria-label="Edit transaction" onClick={() => openEdit(t)}>
                <EditIcon />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                aria-label="Delete transaction"
                disabled={deleteTxn.isPending && deleteTxn.variables === t.id}
                onClick={() => handleDelete(t)}
              >
                <DeleteIcon />
              </button>
            </div>
          </div>
        ))}
        {items?.length === 0 && <p className="muted">No transactions yet.</p>}
      </div>
    </div>
  );
}
