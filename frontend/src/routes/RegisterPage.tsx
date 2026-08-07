import { RegisterForm } from "../components/RegisterForm";

// Full-page fallback for direct navigation / bookmarks / refresh on /register.
// When reached from the landing page instead, AuthModal renders this same
// form as an overlay — see App.tsx's background-location routing.
export function RegisterPage() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Genkin-Impact</h1>
        <p className="auth-sub">Create your ledger.</p>
        <RegisterForm />
      </div>
    </div>
  );
}
