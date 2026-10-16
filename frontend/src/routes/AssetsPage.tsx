import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AddAccountForm } from "../components/AddAccountForm";
import { Modal } from "../components/Modal";
import { PlusIcon } from "../components/TxnIcons";

interface Account {
  id: string;
  name: string;
  type: string;
  currency_code: string;
  balance_display: string;
}

const TYPE_LABEL: Record<string, string> = {
  cash: "Cash",
  bank: "Bank",
  credit_card: "Credit card",
  e_wallet: "E-wallet",
  investment: "Investment",
  liability: "Liability",
};

export function AssetsPage() {
  const [showForm, setShowForm] = useState(false);
  const { data: accounts, isLoading, isError } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Account[] }>("/accounts").then((r) => r.accounts),
  });

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__titles">
          <span className="eyebrow eyebrow--accent">
            {accounts ? `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}` : "Wallet"}
          </span>
          <h1>Accounts</h1>
        </div>
        <div className="page-head__actions">
          <button className="btn-primary" type="button" onClick={() => setShowForm(true)}>
            <PlusIcon size={16} />
            Add account
          </button>
        </div>
      </header>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="New account">
        <AddAccountForm onCreated={() => setShowForm(false)} />
      </Modal>

      {isError && <p className="field-error">Failed to load accounts. Try refreshing.</p>}
      {isLoading && <p className="muted">Loading…</p>}

      <div className="account-list">
        {accounts?.map((a) => (
          <article className="account-card" key={a.id} data-type={a.type}>
            <div className="account-card__top">
              <span className="eyebrow">{TYPE_LABEL[a.type] ?? a.type.replace("_", " ")}</span>
              <span className="account-card__cur mono">{a.currency_code}</span>
            </div>
            <div className="account-card__name">{a.name}</div>
            <div className="account-card__balance num" data-negative={a.balance_display.trim().startsWith("-")}>
              {a.balance_display}
            </div>
          </article>
        ))}
        {accounts?.length === 0 && (
          <div className="empty-state">
            <span className="eyebrow eyebrow--accent">No accounts yet</span>
            <p>Add the places your money lives — a bank, an e-wallet, the cash in your pocket.</p>
          </div>
        )}
      </div>
    </div>
  );
}
