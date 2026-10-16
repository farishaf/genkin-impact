import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useResetPassword } from "../hooks/useAuth";
import { ApiError } from "../lib/api";
import { PasswordInput } from "../components/PasswordInput";
import { BrandMark } from "../components/TxnIcons";

const MIN_PASSWORD_LENGTH = 10;

/** Landing spot for the emailed link: choose a new password, then go straight into the app. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reset = useResetPassword();
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    try {
      await reset.mutateAsync({ token, password });
      navigate("/app/transactions", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <Link to="/" className="auth-brand">
          <BrandMark size={30} />
          Genkin
        </Link>
        {token ? (
          <>
            <h1 className="auth-title">Choose a new password.</h1>
            <p className="auth-sub">You'll be signed out everywhere else once it's saved.</p>
            <form onSubmit={onSubmit}>
              <label className="field">
                <span>New password</span>
                <PasswordInput
                  label="New password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <span className="field-hint">At least {MIN_PASSWORD_LENGTH} characters.</span>
              </label>
              <label className="field">
                <span>Confirm password</span>
                <PasswordInput
                  label="Confirm password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              {error && <p className="field-error" role="alert">{error}</p>}
              <button className="btn-primary" type="submit" disabled={reset.isPending}>
                {reset.isPending ? "Saving…" : "Save and sign in"}
              </button>
            </form>
            {reset.isError && (
              <p className="auth-switch">
                Link not working? <Link to="/forgot-password">Request a new one</Link>
              </p>
            )}
          </>
        ) : (
          <>
            <h1 className="auth-title">This link is incomplete.</h1>
            <p className="auth-sub">Open the reset link from your email again, or request a fresh one.</p>
            <Link className="btn-primary btn-cta--block" to="/forgot-password">
              Request a new link
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
