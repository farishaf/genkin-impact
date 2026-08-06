import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

interface Account {
  id: string;
  name: string;
}
interface Category {
  id: string;
  name: string;
  kind: "expense" | "income";
}

export function AddTransactionForm({ onCreated }: { onCreated: () => void }) {
  const { data: accounts, isError: isAccountsError } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<{ accounts: Account[] }>("/accounts").then((r) => r.accounts),
  });

  const [type, setType] = useState<"expense" | "income" | "transfer">("expense");

  const { data: categories, isError: isCategoriesError } = useQuery({
    queryKey: ["categories", type],
    queryFn: () => api.get<{ categories: Category[] }>(`/categories?kind=${type}`).then((r) => r.categories),
    enabled: type !== "transfer",
  });

  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const [prevType, setPrevType] = useState(type);
  if (type !== prevType) {
    setPrevType(type);
    setCategoryId("");
  }

  const createTxn = useMutation({
    mutationFn: () => {
      const body =
        type === "transfer"
          ? { type, account_id: accountId, to_account_id: toAccountId, amount, occurred_at: new Date().toISOString(), note: note || undefined }
          : { type, account_id: accountId, category_id: categoryId, amount, occurred_at: new Date().toISOString(), note: note || undefined };
      return api.post("/transactions", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      onCreated();
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createTxn.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <form className="txn-form" onSubmit={onSubmit}>
      <label className="field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer</option>
        </select>
      </label>
      <label className="field">
        <span>From account</span>
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
      {isAccountsError && <p className="field-error">Failed to load accounts. Try refreshing.</p>}
      {type === "transfer" ? (
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
          {isCategoriesError && <p className="field-error">Failed to load categories. Try refreshing.</p>}
        </label>
      )}
      <label className="field">
        <span>Amount</span>
        <input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </label>
      <label className="field">
        <span>Note</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={createTxn.isPending}>
        {createTxn.isPending ? "Saving…" : "Save transaction"}
      </button>
    </form>
  );
}
