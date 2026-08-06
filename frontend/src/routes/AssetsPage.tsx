import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AddAccountForm } from "../components/AddAccountForm";

interface Account {
  id: string;
  name: string;
  type: string;
  currency_code: string;
  balance_display: string;
}

export function AssetsPage() {
  const [showForm, setShowForm] = useState(false);
  const { data: accounts, isLoading, isError } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Account[] }>("/accounts").then((r) => r.accounts),
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Assets</h1>
        <div className="head-spacer" />
        <button className="btn-primary" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add account"}
        </button>
      </div>
      {showForm && (
        <div className="card" style={{ margin: "0 var(--space-xl) var(--space-lg)", padding: "var(--space-lg)" }}>
          <AddAccountForm onCreated={() => setShowForm(false)} />
        </div>
      )}
      <div className="account-list">
        {isError && <p className="field-error">Failed to load accounts. Try refreshing.</p>}
        {isLoading && <p className="muted">Loading…</p>}
        {accounts?.map((a) => (
          <div className="card account-card" key={a.id}>
            <div className="account-card__name">{a.name}</div>
            <div className="account-card__type">{a.type.replace("_", " ")}</div>
            <div className="account-card__balance">{a.balance_display}</div>
          </div>
        ))}
        {accounts?.length === 0 && <p className="muted">No accounts yet.</p>}
      </div>
    </div>
  );
}
