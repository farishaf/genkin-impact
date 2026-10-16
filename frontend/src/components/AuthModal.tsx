import { useLocation, useNavigate } from "react-router-dom";
import { Modal } from "./Modal";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

const MODES = {
  "/login": { title: "Sign in", Form: LoginForm },
  "/register": { title: "Create account", Form: RegisterForm },
  "/forgot-password": { title: "Reset password", Form: ForgotPasswordForm },
} as const;

// Rendered over the landing page (background-location route pattern) when
// Sign in / Sign up is clicked there. Direct navigation to /login,
// /register or /forgot-password (no background state) falls back to the full-page routes instead.
export function AuthModal() {
  const location = useLocation();
  const navigate = useNavigate();
  const { title, Form } = MODES[location.pathname as keyof typeof MODES] ?? MODES["/login"];

  return (
    <Modal open onClose={() => navigate("/")} title={title}>
      <Form />
    </Modal>
  );
}
