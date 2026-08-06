import { Fragment, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { api, ApiError } from "../lib/api";
import { formatAmount, minorToInputValue } from "../lib/formatAmount";
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
  refund_of_id: string | null;
  installment_plan_id: string | null;
  installment_seq: number | null;
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
interface FilterCriteria {
  type?: string;
  member_id?: string;
  tag_id?: string;
  category_id?: string;
  from?: string;
  to?: string;
}
interface SavedFilter {
  id: string;
  name: string;
  criteria: FilterCriteria;
}

function toDateOnly(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function quickRange(preset: "today" | "yesterday" | "this_week" | "last_week"): { from: string; to: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (preset === "today") {
    const d = startOfDay(now);
    return { from: toDateOnly(d), to: toDateOnly(d) };
  }
  if (preset === "yesterday") {
    const d = startOfDay(now);
    d.setDate(d.getDate() - 1);
    return { from: toDateOnly(d), to: toDateOnly(d) };
  }
  const dow = now.getDay();
  const mondayOffset = (dow + 6) % 7;
  const thisMonday = startOfDay(now);
  thisMonday.setDate(thisMonday.getDate() - mondayOffset);
  if (preset === "this_week") {
    const sunday = new Date(thisMonday);
    sunday.setDate(sunday.getDate() + 6);
    return { from: toDateOnly(thisMonday), to: toDateOnly(sunday) };
  }
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday);
  lastSunday.setDate(lastSunday.getDate() - 1);
  return { from: toDateOnly(lastMonday), to: toDateOnly(lastSunday) };
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

function RefundIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h13l-3-3M20 17H7l3 3" />
    </svg>
  );
}

function InstallmentsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18L18 6M8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM16 14a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
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
  const [fromFilter, setFromFilter] = useState<string>("");
  const [toFilter, setToFilter] = useState<string>("");
  const [activeRangePreset, setActiveRangePreset] = useState<string>("");

  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const qc = useQueryClient();

  function applyRangePreset(preset: "today" | "yesterday" | "this_week" | "last_week" | "") {
    setActiveRangePreset(preset);
    if (preset === "") {
      setFromFilter("");
      setToFilter("");
      return;
    }
    const { from, to } = quickRange(preset);
    setFromFilter(from);
    setToFilter(to);
  }

  function applySavedFilter(criteria: FilterCriteria) {
    setTypeFilter(criteria.type ?? "");
    setMemberFilter(criteria.member_id ?? "");
    setTagFilter(criteria.tag_id ?? "");
    setCategoryFilter(criteria.category_id ?? "");
    setFromFilter(criteria.from ?? "");
    setToFilter(criteria.to ?? "");
    setActiveRangePreset("");
  }

  const { data: savedFilters } = useQuery({
    queryKey: ["savedFilters"],
    queryFn: () => api.get<{ saved_filters: SavedFilter[] }>("/saved-filters").then((r) => r.saved_filters),
  });

  const saveFilter = useMutation({
    mutationFn: (body: { name: string; criteria: FilterCriteria }) => api.post("/saved-filters", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["savedFilters"] }),
  });

  const deleteSavedFilter = useMutation({
    mutationFn: (id: string) => api.del(`/saved-filters/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["savedFilters"] }),
  });

  function handleSaveCurrentFilter() {
    const name = window.prompt("Name this filter view:");
    if (!name) return;
    const criteria: FilterCriteria = {
      ...(typeFilter && { type: typeFilter }),
      ...(memberFilter && { member_id: memberFilter }),
      ...(tagFilter && { tag_id: tagFilter }),
      ...(categoryFilter && { category_id: categoryFilter }),
      ...(fromFilter && { from: fromFilter }),
      ...(toFilter && { to: toFilter }),
    };
    saveFilter.mutate({ name, criteria });
  }

  const { data: summary, isError: isSummaryError } = useQuery({
    queryKey: ["transactions", "summary", fromFilter, toFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (fromFilter) params.set("from", fromFilter);
      if (toFilter) params.set("to", toFilter);
      const qs = params.toString();
      return api.get<{ summary: Summary }>(`/transactions/summary${qs ? `?${qs}` : ""}`).then((r) => r.summary);
    },
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
    queryKey: ["transactions", "list", typeFilter, memberFilter, tagFilter, categoryFilter, fromFilter, toFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (memberFilter) params.set("member_id", memberFilter);
      if (tagFilter) params.set("tag_id", tagFilter);
      if (categoryFilter) params.set("category_id", categoryFilter);
      if (fromFilter) params.set("from", fromFilter);
      if (toFilter) params.set("to", toFilter);
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

  const [openAction, setOpenAction] = useState<{ id: string; kind: "refund" | "installments" } | null>(null);
  function toggleAction(id: string, kind: "refund" | "installments") {
    setOpenAction((cur) => (cur?.id === id && cur.kind === kind ? null : { id, kind }));
  }

  const refundTxn = useMutation({
    mutationFn: ({ id, amount, note }: { id: string; amount: string; note: string }) =>
      api.post(`/transactions/${id}/refund`, { amount, note: note || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setOpenAction(null);
    },
  });

  const installmentsTxn = useMutation({
    mutationFn: (body: { id: string; installment_count: number; interval_unit: "month" | "week"; fee_amount: string; first_due_date: string }) =>
      api.post(`/transactions/${body.id}/installments`, {
        installment_count: body.installment_count,
        interval_unit: body.interval_unit,
        fee_amount: body.fee_amount || undefined,
        first_due_date: body.first_due_date,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setOpenAction(null);
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

      <div className="tag-chips" style={{ margin: "0 var(--space-xl) var(--space-sm)" }}>
        {(["", "today", "yesterday", "this_week", "last_week"] as const).map((preset) => (
          <button
            key={preset || "all"}
            type="button"
            className={`tag-chip${activeRangePreset === preset ? " tag-chip--active" : ""}`}
            onClick={() => applyRangePreset(preset)}
          >
            {preset === "" ? "All time" : preset === "today" ? "Today" : preset === "yesterday" ? "Yesterday" : preset === "this_week" ? "This week" : "Last week"}
          </button>
        ))}
      </div>

      <div className="tag-chips" style={{ margin: "0 var(--space-xl) var(--space-lg)" }}>
        {(savedFilters ?? []).map((f) => (
          <button key={f.id} type="button" className="tag-chip" onClick={() => applySavedFilter(f.criteria)}>
            {f.name}
            <span
              className="tag-chip__remove"
              role="button"
              aria-label={`Delete saved filter ${f.name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete saved filter "${f.name}"?`)) deleteSavedFilter.mutate(f.id);
              }}
            >
              ×
            </span>
          </button>
        ))}
        <button type="button" className="tag-chip" onClick={handleSaveCurrentFilter} disabled={saveFilter.isPending}>
          + Save current filter
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
          <Fragment key={t.id}>
            <div
              className="txn-row"
              ref={(el) => {
                rowRefs.current[t.id] = el;
              }}
            >
              <span className="cat-badge">{(t.category_name ?? t.account_name).charAt(0).toUpperCase()}</span>
              <div className="txn-row__body">
                <div className="txn-row__top">
                  <span className="txn-row__cat">{t.type === "transfer" ? "Transfer" : (t.category_name ?? "Refund")}</span>
                  <span className="txn-row__time">{new Date(t.occurred_at).toLocaleString()}</span>
                </div>
                {t.note && <div className="txn-row__note">{t.note}</div>}
                {(t.member_name || t.tags.length > 0 || t.refund_of_id || t.installment_plan_id) && (
                  <div className="txn-row__meta">
                    {t.member_name && <span className="tag-chip tag-chip--static">{t.member_name}</span>}
                    {t.tags.map((tag) => (
                      <span key={tag.id} className="tag-chip tag-chip--static">
                        {tag.name}
                      </span>
                    ))}
                    {t.refund_of_id && <span className="tag-chip tag-chip--static">Refund</span>}
                    {t.installment_plan_id && t.installment_seq === null && <span className="tag-chip tag-chip--static">Installment plan</span>}
                    {t.installment_seq !== null && <span className="tag-chip tag-chip--static">Installment #{t.installment_seq}</span>}
                  </div>
                )}
              </div>
              <span className={`amount amount--${t.type === "expense" ? "neg" : "pos"}`}>
                {t.type === "expense" ? "-" : "+"}
                {formatAmount(t.amount, t.currency_code)}
              </span>
              <div className="txn-row__actions">
                {t.type !== "transfer" && (
                  <button type="button" className="icon-btn" aria-label="Refund transaction" onClick={() => toggleAction(t.id, "refund")}>
                    <RefundIcon />
                  </button>
                )}
                {t.type !== "transfer" && t.installment_plan_id === null && (
                  <button type="button" className="icon-btn" aria-label="Split into installments" onClick={() => toggleAction(t.id, "installments")}>
                    <InstallmentsIcon />
                  </button>
                )}
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

            {openAction?.id === t.id && openAction.kind === "refund" && (
              <div className="inline-action">
                <form
                  className="contribute-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    refundTxn.mutate({ id: t.id, amount: String(fd.get("amount") ?? ""), note: String(fd.get("note") ?? "") });
                  }}
                >
                  <input name="amount" inputMode="decimal" required defaultValue={minorToInputValue(t.amount, t.currency_code)} />
                  <input name="note" placeholder="Note (optional)" />
                  <button className="btn-primary btn-outline--sm" type="submit" disabled={refundTxn.isPending}>
                    {refundTxn.isPending ? "Refunding…" : "Refund"}
                  </button>
                  <button className="btn-outline btn-outline--sm" type="button" onClick={() => setOpenAction(null)}>
                    Cancel
                  </button>
                </form>
                {refundTxn.isError && <p className="field-error">{refundTxn.error instanceof ApiError ? refundTxn.error.message : "Something went wrong."}</p>}
              </div>
            )}

            {openAction?.id === t.id && openAction.kind === "installments" && (
              <div className="inline-action">
                <form
                  className="contribute-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    installmentsTxn.mutate({
                      id: t.id,
                      installment_count: Number(fd.get("installment_count")),
                      interval_unit: fd.get("interval_unit") === "week" ? "week" : "month",
                      fee_amount: String(fd.get("fee_amount") ?? ""),
                      first_due_date: String(fd.get("first_due_date")),
                    });
                  }}
                >
                  <input name="installment_count" type="number" min={2} max={60} defaultValue={3} required />
                  <select name="interval_unit" defaultValue="month">
                    <option value="month">Monthly</option>
                    <option value="week">Weekly</option>
                  </select>
                  <input name="fee_amount" inputMode="decimal" placeholder="Fee (optional)" />
                  <input name="first_due_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
                  <button className="btn-primary btn-outline--sm" type="submit" disabled={installmentsTxn.isPending}>
                    {installmentsTxn.isPending ? "Splitting…" : "Split"}
                  </button>
                  <button className="btn-outline btn-outline--sm" type="button" onClick={() => setOpenAction(null)}>
                    Cancel
                  </button>
                </form>
                {installmentsTxn.isError && (
                  <p className="field-error">{installmentsTxn.error instanceof ApiError ? installmentsTxn.error.message : "Something went wrong."}</p>
                )}
              </div>
            )}
          </Fragment>
        ))}
        {items?.length === 0 && <p className="muted">No transactions yet.</p>}
      </div>
    </div>
  );
}
