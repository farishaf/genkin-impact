import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { AddAccountForm } from "../components/AddAccountForm";

interface Currency {
  code: string;
  name: string;
}

export function OnboardingPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: currencies } = useQuery({
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
        <h1 className="auth-title">Genkin-Impact</h1>
        {step === 1 && (
          <>
            <p className="auth-sub">Step 1 of 2 — pick your main currency.</p>
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
            {error && <p className="field-error">{error}</p>}
            <button className="btn-primary" onClick={onPickCurrency} disabled={setCurrency.isPending}>
              {setCurrency.isPending ? "Saving…" : "Continue"}
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <p className="auth-sub">Step 2 of 2 — add your first account.</p>
            <AddAccountForm onCreated={() => navigate("/app/transactions")} />
          </>
        )}
      </div>
    </div>
  );
}
