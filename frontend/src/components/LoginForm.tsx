import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLogin } from "../hooks/useAuth";
import { ApiError } from "../lib/api";
import { PasswordField } from "./PasswordField";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email, password });
      navigate("/mainichi");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <form className="mi-login__fields" onSubmit={onSubmit}>
      <div className="mi-login__live" role="alert">
        {error && (
          <div className="mi-login__alert">
            <strong>Couldn’t sign you in</strong>
            <span>{error}</span>
          </div>
        )}
      </div>
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
      <div className="mi-login__password">
        <PasswordField value={password} onChange={setPassword} autoComplete="current-password" invalid={!!error} />
        <Link className="mi-link mi-login__forgot" to="/forgot-password">Forgot password?</Link>
      </div>
      <button className="mi-solid mi-login__submit" type="submit" disabled={login.isPending}>
        {login.isPending ? "Signing in…" : "Sign in"}
      </button>
      <p className="mi-login__footer">
        New here? <Link className="mi-link" to="/register" state={location.state}>Create an account</Link>
      </p>
    </form>
  );
}
