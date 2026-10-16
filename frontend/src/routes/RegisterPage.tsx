import { Link } from "react-router-dom";
import { RegisterForm } from "../components/RegisterForm";
import { BrandMark } from "../components/TxnIcons";

// Full-page fallback for direct navigation / bookmarks / refresh on /register.
// When reached from the landing page instead, AuthModal renders this same
// form as an overlay — see App.tsx's background-location routing.
export function RegisterPage() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <Link to="/" className="auth-brand">
          <BrandMark size={30} />
          Genkin
        </Link>
        <h1 className="auth-title">Start your ledger.</h1>
        <p className="auth-sub">Free, private, and no bank login — ever.</p>
        <RegisterForm />
      </div>
    </div>
  );
}
