import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("pending");
    try {
      await api.post("/auth/forgot-password", { email });
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Genkin-Impact</h1>
        {status === "sent" ? (
          <p>If an account exists for that email, a reset link is on its way.</p>
        ) : (
          <>
            <p className="auth-sub">Enter your email and we'll send a reset link.</p>
            <form onSubmit={onSubmit}>
              <label className="field">
                <span>Email</span>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              {error && <p className="field-error">{error}</p>}
              <button className="btn-primary" type="submit" disabled={status === "pending"}>
                {status === "pending" ? "Sending…" : "Send reset link"}
              </button>
            </form>
          </>
        )}
        <p className="auth-switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
