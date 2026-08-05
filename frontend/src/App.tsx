import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./routes/LoginPage";
import { RegisterPage } from "./routes/RegisterPage";
import { VerifyEmailPage } from "./routes/VerifyEmailPage";
import { OnboardingPage } from "./routes/OnboardingPage";
import { AppShell } from "./layout/AppShell";
import { AssetsPage } from "./routes/AssetsPage";
import { TransactionsPage } from "./routes/TransactionsPage";
import { RequireAuth, RequireOnboarded } from "./routes/RequireAuth";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        }
      />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <RequireOnboarded>
              <AppShell />
            </RequireOnboarded>
          </RequireAuth>
        }
      >
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route index element={<Navigate to="transactions" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/app/transactions" replace />} />
    </Routes>
  );
}
