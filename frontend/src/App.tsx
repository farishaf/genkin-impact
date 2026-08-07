import { Routes, Route, Navigate, useLocation, type Location } from "react-router-dom";
import { LandingPage } from "./routes/LandingPage";
import { LoginPage } from "./routes/LoginPage";
import { RegisterPage } from "./routes/RegisterPage";
import { VerifyEmailPage } from "./routes/VerifyEmailPage";
import { OnboardingPage } from "./routes/OnboardingPage";
import { AppShell } from "./layout/AppShell";
import { AssetsPage } from "./routes/AssetsPage";
import { TransactionsPage } from "./routes/TransactionsPage";
import { PlansPage } from "./routes/PlansPage";
import { AnalyticsPage } from "./routes/AnalyticsPage";
import { RequireAuth, RequireOnboarded, RequireNotOnboarded } from "./routes/RequireAuth";
import { AuthModal } from "./components/AuthModal";

export function App() {
  const location = useLocation();
  // Set by LandingPage's Sign in / Sign up links: render /login and /register
  // as a modal over the landing page instead of navigating away from it.
  // Direct navigation (no background state) falls through to the full-page routes.
  const background = (location.state as { background?: Location } | null)?.background;

  return (
    <>
      <Routes location={background ?? location}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <RequireNotOnboarded>
                <OnboardingPage />
              </RequireNotOnboarded>
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
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route index element={<Navigate to="transactions" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {background && (
        <Routes>
          <Route path="/login" element={<AuthModal />} />
          <Route path="/register" element={<AuthModal />} />
        </Routes>
      )}
    </>
  );
}
