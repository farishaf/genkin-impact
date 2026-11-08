import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { formatMoney, minorToInputValue } from "../lib/formatAmount";
import { AddAccountForm } from "../components/AddAccountForm";
import { confirmDialog } from "../components/ConfirmDialog";

interface Account {
  id: string;
  name: string;
  type: string;
  currency_code: string;
  balance_display: string;
  exclude_from_net_worth: boolean;
  is_archived: boolean;
  credit_limit: string | null;
  statement_day: number | null;
}

interface AccountsResponse {
  accounts: Account[];
  net_worth_minor: string | null;
  main_currency_code: string | null;
}

export function AssetsPage() {
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["accounts", showArchived],
    queryFn: () =>
      api.get<AccountsResponse>(`/accounts${showArchived ? "?include_archived=true" : ""}`),
  });

  const patchAccount = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/accounts/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setEditingId(null);
    },
  });

  const deleteAccount = useMutation({
    mutationFn: (id: string) => api.del(`/accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
  });

  const accounts = data?.accounts;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Assets</h1>
        <div className="head-spacer" />
        <label className="field field--checkbox" style={{ margin: 0 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          <span>Show archived</span>
        </label>
        <button className="btn-primary" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ Add account"}
        </button>
      </div>

      {data?.net_worth_minor != null && data.main_currency_code && (
        <div className="summary-grid">
          <div className="card stat-card">
            <div className="stat-card__head">
              <span className="stat-card__label">Net worth</span>
            </div>
            <div className="stat-card__figure" data-tone="balance">
              {formatMoney(data.net_worth_minor, data.main_currency_code)}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="card mi-card">
          <AddAccountForm onCreated={() => setShowForm(false)} />
        </div>
      )}

      <div className="account-list">
        {isError && <p className="field-error">Failed to load accounts. Try refreshing.</p>}
        {isLoading && <p className="muted">Loading…</p>}
        {accounts?.map((a) => (
          <div className="card account-card" key={a.id}>
            {editingId === a.id ? (
              <form
                className="account-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const creditLimit = String(fd.get("credit_limit") ?? "").trim();
                  const statementDay = String(fd.get("statement_day") ?? "").trim();
                  patchAccount.mutate({
                    id: a.id,
                    body: {
                      name: String(fd.get("name") ?? a.name),
                      exclude_from_net_worth: fd.get("exclude_from_net_worth") === "on",
                      ...(a.type === "credit_card"
                        ? {
                            credit_limit: creditLimit ? creditLimit : null,
                            statement_day: statementDay ? Number(statementDay) : null,
                          }
                        : {}),
                    },
                  });
                }}
              >
                <label className="field">
                  <span>Account name</span>
                  <input name="name" required defaultValue={a.name} />
                </label>
                <label className="field field--checkbox">
                  <input type="checkbox" name="exclude_from_net_worth" defaultChecked={a.exclude_from_net_worth} />
                  <span>Exclude from net worth</span>
                </label>
                {a.type === "credit_card" && (
                  <>
                    <label className="field">
                      <span>Credit limit</span>
                      <input
                        name="credit_limit"
                        inputMode="decimal"
                        defaultValue={a.credit_limit ? minorToInputValue(a.credit_limit, a.currency_code) : ""}
                        placeholder="0.00"
                      />
                    </label>
                    <label className="field">
                      <span>Statement day</span>
                      <input name="statement_day" type="number" min={1} max={31} defaultValue={a.statement_day ?? ""} />
                    </label>
                  </>
                )}
                {patchAccount.isError && (
                  <p className="field-error">
                    {patchAccount.error instanceof ApiError ? patchAccount.error.message : "Something went wrong."}
                  </p>
                )}
                <div className="account-card__actions">
                  <button className="btn-primary btn-outline--sm" type="submit" disabled={patchAccount.isPending}>
                    {patchAccount.isPending ? "Saving…" : "Save"}
                  </button>
                  <button className="btn-outline btn-outline--sm" type="button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="account-card__name">{a.name}</div>
                <div className="account-card__type">{a.type.replace("_", " ")}</div>
                <div className="account-card__balance">{a.balance_display}</div>
                {a.is_archived && <div className="muted-inline">Archived</div>}
                <div className="account-card__actions">
                  <button className="btn-outline btn-outline--sm" type="button" onClick={() => setEditingId(a.id)}>
                    Edit
                  </button>
                  <button
                    className="btn-outline btn-outline--sm"
                    type="button"
                    onClick={() => patchAccount.mutate({ id: a.id, body: { is_archived: !a.is_archived } })}
                  >
                    {a.is_archived ? "Unarchive" : "Archive"}
                  </button>
                  <button
                    className="btn-outline btn-outline--sm"
                    type="button"
                    onClick={() => {
                      confirmDialog({ title: `Delete "${a.name}"?`, body: "This can't be undone.", confirmLabel: "Delete account", danger: true }).then(
                        (ok) => ok && deleteAccount.mutate(a.id),
                      );
                    }}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {accounts?.length === 0 && <p className="muted">No accounts yet.</p>}
      </div>
    </div>
  );
}
