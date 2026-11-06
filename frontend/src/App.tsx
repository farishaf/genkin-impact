import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { LoginPage } from "./routes/LoginPage";
import { VerifyEmailPage } from "./routes/VerifyEmailPage";
import { ForgotPasswordPage } from "./routes/ForgotPasswordPage";
import { ResetPasswordPage } from "./routes/ResetPasswordPage";
import { OnboardingPage } from "./routes/OnboardingPage";
import { AssetsPage } from "./routes/AssetsPage";
import { TransactionsPage } from "./routes/TransactionsPage";
import { PlansPage } from "./routes/PlansPage";
import { AnalyticsPage } from "./routes/AnalyticsPage";
import { RequireAuth, RequireOnboarded, RequireNotOnboarded } from "./routes/RequireAuth";
import { MainichiShell, MoneyLayout } from "./routes/mainichi/MainichiShell";
import { TodayPage } from "./routes/mainichi/TodayPage";
import { CalendarPage } from "./routes/mainichi/CalendarPage";
import { WorkoutEventPage, RoutinePage } from "./routes/mainichi/WorkoutPage";
import { PageView } from "./routes/mainichi/PageView";
import { MoneyPage } from "./routes/mainichi/MoneyPage";

export function App() {
  return (
    <Routes>
        <Route path="/" element={<Navigate to="/mainichi" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<LoginPage mode="register" />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
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
        {/* Old Genkin-Impact URLs now live under Mainichi's Money tab. */}
        <Route path="/app/:page?" element={<LegacyAppRedirect />} />
        <Route
          path="/mainichi"
          element={
            <RequireAuth>
              <RequireOnboarded>
                <MainichiShell />
              </RequireOnboarded>
            </RequireAuth>
          }
        >
          <Route index element={<TodayPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="workout/:id" element={<WorkoutEventPage />} />
          <Route path="routines/:id" element={<RoutinePage />} />
          <Route path="pages/:id" element={<PageView />} />
          <Route path="money" element={<MoneyLayout />}>
            <Route index element={<MoneyPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="assets" element={<AssetsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="plans" element={<PlansPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
  );
}

function LegacyAppRedirect() {
  const { page } = useParams();
  return <Navigate to={`/mainichi/money${page ? `/${page}` : ""}`} replace />;
}
