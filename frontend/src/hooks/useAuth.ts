import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

export interface User {
  id: string;
  email: string;
  display_name: string;
  main_currency_code: string | null;
  onboarded_at: string | null;
  accent_color: string;
  show_cents: boolean;
  color_convention: string;
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: User }>("/auth/me").then((r) => r.user),
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) => api.post<{ user: User }>("/auth/login", input),
    onSuccess: (data) => qc.setQueryData(["me"], data.user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; display_name: string }) =>
      api.post<{ user: User }>("/auth/register", input),
    onSuccess: (data) => qc.setQueryData(["me"], data.user),
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      // Hard navigation, on purpose: it drops every cached query with the page. A router
      // navigate() runs in a transition, so clearing ["me"] alongside it let RequireAuth
      // redirect to /login first (and qc.clear() alone redirected nowhere).
      window.location.replace("/");
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: { email: string }) => api.post<{ ok: true }>("/auth/forgot-password", input),
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { token: string; password: string }) => api.post<{ user: User }>("/auth/reset-password", input),
    onSuccess: (data) => qc.setQueryData(["me"], data.user),
  });
}
