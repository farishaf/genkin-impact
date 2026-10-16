import { Link } from "react-router-dom";
import { ForgotPasswordForm } from "../components/ForgotPasswordForm";
import { BrandMark } from "../components/TxnIcons";

// Full-page fallback for direct navigation to /forgot-password. From the landing page the same
// form opens in AuthModal instead — see App.tsx's background-location routing.
export function ForgotPasswordPage() {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <Link to="/" className="auth-brand">
          <BrandMark size={30} />
          Genkin
        </Link>
        <h1 className="auth-title">Forgot your password?</h1>
        <p className="auth-sub">Enter your email and we'll send you a link to choose a new one.</p>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
