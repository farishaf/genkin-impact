import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useCurrentUser } from "../hooks/useAuth";
import { ProgressBar } from "./ProgressBar";

interface Category {
  id: string;
  name: string;
  emoji: string | null;
}

interface Currency {
  code: string;
  name: string;
}

interface Budget {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  period: "weekly" | "monthly" | "quarterly" | "yearly";
  rollover_unused: boolean;
  pct: number;
  limit_display: string;
  spent_display: string;
}

function AddBudgetForm({ onCreated }: { onCreated: () => void }) {
  const { data: user } = useCurrentUser();
  const { data: categories } = useQuery({
    queryKey: ["categories", "expense"],
    queryFn: () => api.get<{ categories: Category[] }>("/categories?kind=expense").then((r) => r.categories),
  });
  const { data: currencies } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => api.get<{ currencies: Currency[] }>("/currencies").then((r) => r.currencies),
  });
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [limitAmount, setLimitAmount] = useState("");
  const [currencyCode, setCurrencyCode] = useState(user?.main_currency_code ?? "USD");
  const [period, setPeriod] = useState<Budget["period"]>("monthly");
  const [rollover, setRollover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post("/budgets", {
        name,
        category_id: categoryId || null,
        limit_amount: limitAmount,
        currency_code: currencyCode,
        period,
        start_date: new Date().toISOString().slice(0, 10),
        rollover_unused: rollover,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
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
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Groceries" />
      </label>
      <label className="field">
        <span>Category</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Overall (all expenses)</option>
          {(categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji ? `${c.emoji} ` : ""}
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Limit</span>
        <input required inputMode="decimal" value={limitAmount} onChange={(e) => setLimitAmount(e.target.value)} placeholder="300.00" />
      </label>
      <label className="field">
        <span>Currency</span>
        <select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
          {(currencies ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Period</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value as Budget["period"])}>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
        </select>
      </label>
      <label className="field field--checkbox">
        <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} />
        <span>Roll over unused amount into the next period</span>
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={create.isPending}>
        {create.isPending ? "Saving…" : "Save budget"}
      </button>
    </form>
  );
}

function BudgetCard({ budget }: { budget: Budget }) {
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: () => api.del(`/budgets/${budget.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgets"] }),
  });

  const tone = budget.pct >= 100 ? "negative" : budget.pct >= 80 ? "negative" : "positive";

  return (
    <div className="card plan-card">
      <div className="plan-card__head">
        <div>
          <div className="plan-card__name">{budget.name}</div>
          <div className="plan-card__meta">
            {budget.category_name ?? "Overall"} · {budget.period}
          </div>
        </div>
        <button className="btn-outline btn-outline--sm" type="button" onClick={() => archive.mutate()}>
          Archive
        </button>
      </div>
      <ProgressBar pct={budget.pct} tone={tone} />
      <div className="plan-card__figures">
        <span>{budget.spent_display} spent</span>
        <span className="muted-inline">of {budget.limit_display}</span>
      </div>
    </div>
  );
}

export function BudgetsTab() {
  const [showForm, setShowForm] = useState(false);
  const { data: budgets, isLoading } = useQuery({
    queryKey: ["budgets"],
    queryFn: () => api.get<{ budgets: Budget[] }>("/budgets").then((r) => r.budgets),
  });

  return (
    <div>
      <div className="plans-tab-head">
        <button className="btn-primary" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New budget"}
        </button>
      </div>
      {showForm && (
        <div className="card" style={{ margin: "0 0 var(--space-lg)", padding: "var(--space-lg)" }}>
          <AddBudgetForm onCreated={() => setShowForm(false)} />
        </div>
      )}
      <div className="plan-list">
        {isLoading && <p className="muted">Loading…</p>}
        {budgets?.map((b) => (
          <BudgetCard key={b.id} budget={b} />
        ))}
        {budgets?.length === 0 && <p className="muted">No budgets yet.</p>}
      </div>
    </div>
  );
}
