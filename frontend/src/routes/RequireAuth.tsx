import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useCurrentUser } from "../hooks/useAuth";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isLoading, isError } = useCurrentUser();
  if (isLoading) return <div className="page-loading">Loading…</div>;
  if (isError || !user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function RequireOnboarded({ children }: { children: ReactNode }) {
  const { data: user } = useCurrentUser();
  if (user && !user.onboarded_at) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
