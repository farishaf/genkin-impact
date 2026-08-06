import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { ProgressBar } from "./ProgressBar";

interface Account {
  id: string;
  name: string;
}

interface Currency {
  code: string;
  name: string;
}

interface SavingsGoal {
  id: string;
  name: string;
  emoji: string | null;
  account_id: string | null;
  account_name: string | null;
  target_date: string | null;
  status: "active" | "achieved" | "archived";
  pct: number;
  achieved: boolean;
  target_display: string;
  progress_display: string;
}

function AddSavingsGoalForm({ onCreated }: { onCreated: () => void }) {
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Account[] }>("/accounts").then((r) => r.accounts),
  });
  const { data: currencies } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => api.get<{ currencies: Currency[] }>("/currencies").then((r) => r.currencies),
  });
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post("/savings-goals", {
        name,
        account_id: accountId || null,
        target_amount: targetAmount,
        currency_code: currencyCode,
        target_date: targetDate || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["savings-goals"] });
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
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="New laptop" />
      </label>
      <label className="field">
        <span>Track against an account (optional)</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">Manual — I'll log contributions myself</option>
          {(accounts ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Target amount</span>
        <input required inputMode="decimal" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="1000.00" />
      </label>
      {!accountId && (
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
      )}
      <label className="field">
        <span>Target date (optional)</span>
        <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={create.isPending}>
        {create.isPending ? "Saving…" : "Save goal"}
      </button>
    </form>
  );
}

function ContributeForm({ goalId }: { goalId: string }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const contribute = useMutation({
    mutationFn: () => api.post(`/savings-goals/${goalId}/contribute`, { amount }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["savings-goals"] });
      setAmount("");
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await contribute.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <form className="contribute-form" onSubmit={onSubmit}>
      <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Add amount" required />
      <button className="btn-outline btn-outline--sm" type="submit" disabled={contribute.isPending}>
        Add
      </button>
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}

function SavingsGoalCard({ goal }: { goal: SavingsGoal }) {
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: () => api.del(`/savings-goals/${goal.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["savings-goals"] }),
  });

  return (
    <div className="card plan-card">
      <div className="plan-card__head">
        <div>
          <div className="plan-card__name">
            {goal.emoji ? `${goal.emoji} ` : ""}
            {goal.name}
          </div>
          <div className="plan-card__meta">
            {goal.account_id ? `Linked to ${goal.account_name}` : "Manual"}
            {goal.target_date ? ` · due ${goal.target_date}` : ""}
          </div>
        </div>
        <button className="btn-outline btn-outline--sm" type="button" onClick={() => archive.mutate()}>
          Archive
        </button>
      </div>
      <ProgressBar pct={goal.pct} tone={goal.achieved ? "positive" : "neutral"} />
      <div className="plan-card__figures">
        <span>{goal.progress_display} saved</span>
        <span className="muted-inline">of {goal.target_display}</span>
      </div>
      {goal.achieved && <div className="plan-card__badge">Achieved 🎉</div>}
      {!goal.account_id && !goal.achieved && <ContributeForm goalId={goal.id} />}
    </div>
  );
}

export function SavingsTab() {
  const [showForm, setShowForm] = useState(false);
  const { data: goals, isLoading } = useQuery({
    queryKey: ["savings-goals"],
    queryFn: () => api.get<{ savings_goals: SavingsGoal[] }>("/savings-goals").then((r) => r.savings_goals),
  });

  return (
    <div>
      <div className="plans-tab-head">
        <button className="btn-primary" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New goal"}
        </button>
      </div>
      {showForm && (
        <div className="card" style={{ margin: "0 0 var(--space-lg)", padding: "var(--space-lg)" }}>
          <AddSavingsGoalForm onCreated={() => setShowForm(false)} />
        </div>
      )}
      <div className="plan-list">
        {isLoading && <p className="muted">Loading…</p>}
        {goals?.map((g) => (
          <SavingsGoalCard key={g.id} goal={g} />
        ))}
        {goals?.length === 0 && <p className="muted">No savings goals yet.</p>}
      </div>
    </div>
  );
}
