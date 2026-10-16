import { Link } from "react-router-dom";
import { LoginForm } from "../components/LoginForm";
import { BrandMark } from "../components/TxnIcons";

// Full-page fallback for direct navigation / bookmarks / refresh on /login.
// When reached from the landing page instead, AuthModal renders this same
// form as an overlay — see App.tsx's background-location routing.
export function LoginPage() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <Link to="/" className="auth-brand">
          <BrandMark size={30} />
          Genkin
        </Link>
        <h1 className="auth-title">Welcome back.</h1>
        <p className="auth-sub">Pick up where your ledger left off.</p>
        <LoginForm />
      </div>
    </div>
  );
}
