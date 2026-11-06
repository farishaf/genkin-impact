import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useRegister } from "../hooks/useAuth";
import { ApiError } from "../lib/api";
import { PasswordField } from "./PasswordField";

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
    <form className="mi-login__fields" onSubmit={onSubmit}>
      <div className="mi-login__live" role="alert">
        {error && (
          <div className="mi-login__alert">
            <strong>Couldn’t create your account</strong>
            <span>{error}</span>
          </div>
        )}
      </div>
      <label className="mi-login__field">
        <span>Name</span>
        <input
          className="mi-login__input"
          autoComplete="name"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </label>
      <label className="mi-login__field">
        <span>Email</span>
        <input
          className="mi-login__input"
          type="email"
          autoComplete="email"
          required
          aria-invalid={error ? true : undefined}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <PasswordField
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        minLength={10}
        hint="At least 10 characters."
        invalid={!!error}
      />
      <button className="mi-solid mi-login__submit" type="submit" disabled={register.isPending}>
        {register.isPending ? "Creating account…" : "Create account"}
      </button>
      <p className="mi-login__footer">
        Already have an account? <Link className="mi-link" to="/login" state={location.state}>Sign in</Link>
      </p>
    </form>
  );
}
