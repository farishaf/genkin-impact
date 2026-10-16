import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { AddAccountForm } from "../components/AddAccountForm";
import { BrandMark } from "../components/TxnIcons";

interface Currency {
  code: string;
  name: string;
}

export function OnboardingPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: currencies, isError: isCurrenciesError } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => api.get<{ currencies: Currency[] }>("/currencies").then((r) => r.currencies),
  });

  const [mainCurrency, setMainCurrency] = useState("USD");
  const setCurrency = useMutation({
    mutationFn: () => api.patch("/users/me", { main_currency_code: mainCurrency }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      setStep(2);
    },
  });

  async function onPickCurrency() {
    setError(null);
    try {
      await setCurrency.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark size={30} />
          Genkin
        </div>
        <div className="steps" aria-label={`Step ${step} of 2`}>
          <i data-done="true" />
          <i data-done={step === 2} />
        </div>
        {step === 1 && (
          <>
            <h1 className="auth-title">What do you spend in?</h1>
            <p className="auth-sub">Your main currency. Totals and reports are shown in it.</p>
            <label className="field">
              <span>Main currency</span>
              <select value={mainCurrency} onChange={(e) => setMainCurrency(e.target.value)}>
                {(currencies ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>
            {isCurrenciesError && <p className="field-error">Failed to load currencies. Try refreshing.</p>}
            {error && <p className="field-error">{error}</p>}
            <button className="btn-primary btn-cta--block" onClick={onPickCurrency} disabled={setCurrency.isPending}>
              {setCurrency.isPending ? "Saving…" : "Continue"}
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <h1 className="auth-title">Where does it live?</h1>
            <p className="auth-sub">Add your first account — a bank, an e-wallet, or cash. You can add more later.</p>
            <AddAccountForm onCreated={() => navigate("/app/transactions")} defaultCurrency={mainCurrency} />
          </>
        )}
      </div>
    </div>
  );
}
