import { useLocation, useNavigate } from "react-router-dom";
import { Modal } from "./Modal";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";

// Rendered over the landing page (background-location route pattern) when
// Sign in / Sign up is clicked there. Direct navigation to /login or
// /register (no background state) falls back to the full-page routes instead.
export function AuthModal() {
  const location = useLocation();
  const navigate = useNavigate();
  const mode = location.pathname === "/register" ? "register" : "login";

  return (
    <Modal open onClose={() => navigate("/")} title={mode === "login" ? "Sign in" : "Create account"}>
      {mode === "login" ? <LoginForm /> : <RegisterForm />}
    </Modal>
  );
}
