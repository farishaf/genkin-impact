import { useState, useEffect, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { formatAmount } from "../lib/formatAmount";

interface Account {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  kind: "expense" | "income";
}

interface RecurringRule {
  id: string;
  name: string;
  txn_type: "expense" | "income" | "transfer";
  account_name: string;
  to_account_name: string | null;
  category_name: string | null;
  amount: string;
  currency_code: string;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval_count: number;
  next_run_at: string;
  auto_post: boolean;
  is_active: boolean;
  pending_transaction: { id: string; amount: string; occurred_at: string } | null;
}

function AddRecurringRuleForm({ onCreated }: { onCreated: () => void }) {
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Account[] }>("/accounts").then((r) => r.accounts),
  });

  const [txnType, setTxnType] = useState<"expense" | "income" | "transfer">("expense");
  const { data: categories } = useQuery({
    queryKey: ["categories", txnType],
    queryFn: () => api.get<{ categories: Category[] }>(`/categories?kind=${txnType}`).then((r) => r.categories),
    enabled: txnType !== "transfer",
  });

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<RecurringRule["frequency"]>("monthly");
  const [intervalCount, setIntervalCount] = useState("1");
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState("");
  const [autoPost, setAutoPost] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => setCategoryId(""), [txnType]);

  const create = useMutation({
    mutationFn: () => {
      const body =
        txnType === "transfer"
          ? { name, txn_type: txnType, account_id: accountId, to_account_id: toAccountId, amount, frequency, interval_count: Number(intervalCount), starts_on: startsOn, ends_on: endsOn || null, auto_post: autoPost }
          : { name, txn_type: txnType, account_id: accountId, category_id: categoryId, amount, frequency, interval_count: Number(intervalCount), starts_on: startsOn, ends_on: endsOn || null, auto_post: autoPost };
      return api.post("/recurring-rules", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring-rules"] });
      onCreated();
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label className="field">
        <span>Name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Rent" />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={txnType} onChange={(e) => setTxnType(e.target.value as typeof txnType)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer</option>
        </select>
      </label>
      <label className="field">
        <span>{txnType === "transfer" ? "From account" : "Account"}</span>
        <select required value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="" disabled>
            Select an account
          </option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {txnType === "transfer" ? (
        <label className="field">
          <span>To account</span>
          <select required value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            <option value="" disabled>
              Select an account
            </option>
            {(accounts ?? []).filter((a) => a.id !== accountId).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="field">
          <span>Category</span>
          <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="" disabled>
              Select a category
            </option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Amount</span>
        <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </label>
      <label className="field">
        <span>Frequency</span>
        <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <label className="field">
        <span>Every N periods</span>
        <input type="number" min={1} value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} />
      </label>
      <label className="field">
        <span>Starts on</span>
        <input type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
      </label>
      <label className="field">
        <span>Ends on (optional)</span>
        <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
      </label>
      <label className="field field--checkbox">
        <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} />
        <span>Post automatically (uncheck to confirm each occurrence)</span>
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={create.isPending}>
        {create.isPending ? "Saving…" : "Save rule"}
      </button>
    </form>
  );
}

function RecurringRuleCard({ rule }: { rule: RecurringRule }) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["recurring-rules"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };
  const confirm = useMutation({ mutationFn: () => api.post(`/recurring-rules/${rule.id}/confirm`), onSuccess: invalidate });
  const dismiss = useMutation({ mutationFn: () => api.post(`/recurring-rules/${rule.id}/dismiss`), onSuccess: invalidate });
  const toggleActive = useMutation({
    mutationFn: () => api.patch(`/recurring-rules/${rule.id}`, { is_active: !rule.is_active }),
    onSuccess: invalidate,
  });

  return (
    <div className="card plan-card">
      <div className="plan-card__head">
        <div>
          <div className="plan-card__name">{rule.name}</div>
          <div className="plan-card__meta">
            {rule.txn_type === "transfer" ? `${rule.account_name} → ${rule.to_account_name}` : `${rule.account_name} · ${rule.category_name}`}
          </div>
        </div>
        <button className="btn-outline btn-outline--sm" type="button" onClick={() => toggleActive.mutate()}>
          {rule.is_active ? "Pause" : "Resume"}
        </button>
      </div>
      <div className="plan-card__figures">
        <span>{formatAmount(rule.amount, rule.currency_code)}</span>
        <span className="muted-inline">
          every {rule.interval_count > 1 ? `${rule.interval_count} ` : ""}
          {rule.frequency} · next {new Date(rule.next_run_at).toLocaleDateString()}
        </span>
      </div>
      {rule.pending_transaction && (
        <div className="plan-card__pending">
          <span>Awaiting confirmation: {formatAmount(rule.pending_transaction.amount, rule.currency_code)}</span>
          <div className="plan-card__pending-actions">
            <button className="btn-primary btn-outline--sm" type="button" onClick={() => confirm.mutate()}>
              Confirm
            </button>
            <button className="btn-outline btn-outline--sm" type="button" onClick={() => dismiss.mutate()}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RecurringTab() {
  const [showForm, setShowForm] = useState(false);
  const { data: rules, isLoading } = useQuery({
    queryKey: ["recurring-rules"],
    queryFn: () => api.get<{ recurring_rules: RecurringRule[] }>("/recurring-rules").then((r) => r.recurring_rules),
  });

  return (
    <div>
      <div className="plans-tab-head">
        <button className="btn-primary" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New rule"}
        </button>
      </div>
      {showForm && (
        <div className="card" style={{ margin: "0 0 var(--space-lg)", padding: "var(--space-lg)" }}>
          <AddRecurringRuleForm onCreated={() => setShowForm(false)} />
        </div>
      )}
      <div className="plan-list">
        {isLoading && <p className="muted">Loading…</p>}
        {rules?.map((r) => (
          <RecurringRuleCard key={r.id} rule={r} />
        ))}
        {rules?.length === 0 && <p className="muted">No recurring rules yet.</p>}
      </div>
    </div>
  );
}
