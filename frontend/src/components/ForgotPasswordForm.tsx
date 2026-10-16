import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useForgotPassword } from "../hooks/useAuth";
import { ApiError } from "../lib/api";

/** Asks for an email and confirms neutrally — the backend never reveals whether an account exists. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const forgot = useForgotPassword();
  const location = useLocation();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await forgot.mutateAsync({ email });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  if (forgot.isSuccess) {
    return (
      <div>
        <div className="auth-success" role="status">
          <b>Check your inbox.</b>
          <span>If an account exists for {email}, a reset link is on its way. It works for one hour.</span>
        </div>
        <p className="auth-switch">
          <Link to="/login" state={location.state}>
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <label className="field">
        <span>Email</span>
        <input type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="btn-primary" type="submit" disabled={forgot.isPending}>
        {forgot.isPending ? "Sending…" : "Send reset link"}
      </button>
      <p className="auth-switch">
        Remembered it? <Link to="/login" state={location.state}>Sign in</Link>
      </p>
    </form>
  );
}
