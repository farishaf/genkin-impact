import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useRegister } from "../hooks/useAuth";
import { ApiError } from "../lib/api";

export function RegisterForm() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const register = useRegister();
  const navigate = useNavigate();
  const location = useLocation();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register.mutateAsync({ email, password, display_name: displayName });
      navigate("/onboarding");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label className="field">
        <span>Name</span>
        <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="field">
        <span>Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="field-error">{error}</p>}
      <button className="btn-primary" type="submit" disabled={register.isPending}>
        {register.isPending ? "Creating account…" : "Create account"}
      </button>
      <p className="auth-switch">
        Already have an account? <Link to="/login" state={location.state}>Sign in</Link>
      </p>
    </form>
  );
}
