import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "pending">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("This reset link is invalid or expired.");
      return;
    }
    setStatus("pending");
    try {
      await api.post("/auth/reset-password", { token, password });
      navigate("/login");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Genkin-Impact</h1>
        {!token ? (
          <p>This reset link is invalid or expired.</p>
        ) : (
          <>
            <p className="auth-sub">Choose a new password.</p>
            <form onSubmit={onSubmit}>
              <label className="field">
                <span>New password</span>
                <input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              {error && <p className="field-error">{error}</p>}
              <button className="btn-primary" type="submit" disabled={status === "pending"}>
                {status === "pending" ? "Saving…" : "Reset password"}
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
