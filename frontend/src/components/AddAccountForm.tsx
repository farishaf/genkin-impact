import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

interface Currency {
  code: string;
  name: string;
}

const ACCOUNT_TYPES = [
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank" },
  { value: "credit_card", label: "Credit card" },
  { value: "e_wallet", label: "E-wallet" },
  { value: "investment", label: "Investment" },
  { value: "liability", label: "Liability" },
];

export function AddAccountForm({
  onCreated,
  defaultCurrency,
}: {
  onCreated: () => void;
  defaultCurrency?: string;
}) {
  const { data: currencies, isError: isCurrenciesError } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => api.get<{ currencies: Currency[] }>("/currencies").then((r) => r.currencies),
  });
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [type, setType] = useState("bank");
  const [currencyCode, setCurrencyCode] = useState(defaultCurrency ?? "USD");
  const [openingBalance, setOpeningBalance] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createAccount = useMutation({
    mutationFn: () => api.post("/accounts", { name, type, currency_code: currencyCode, opening_balance: openingBalance || "0" }),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      await qc.invalidateQueries({ queryKey: ["me"] });
      onCreated();
    },
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createAccount.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <form className="account-form" onSubmit={onSubmit}>
      <label className="field">
        <span>Account name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Checking" />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
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
      {isCurrenciesError && <p className="field-error">Failed to load currencies. Try refreshing.</p>}
      <label className="field">
        <span>Current balance</span>
        <input required inputMode="decimal" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="0.00" />
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={createAccount.isPending}>
        {createAccount.isPending ? "Saving…" : "Save account"}
      </button>
    </form>
  );
}
