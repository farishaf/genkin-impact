import { LoginForm } from "../components/LoginForm";

// Full-page fallback for direct navigation / bookmarks / refresh on /login.
// When reached from the landing page instead, AuthModal renders this same
// form as an overlay — see App.tsx's background-location routing.
export function LoginPage() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Genkin-Impact</h1>
        <p className="auth-sub">Sign in to your ledger.</p>
        <LoginForm />
      </div>
    </div>
  );
}
