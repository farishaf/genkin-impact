import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    // qc.clear() alone doesn't notify mounted observers, so RequireAuth kept the old user and never redirected.
    // Leave first, then drop the cache. onSettled: a failed request (expired session, offline) still signs out here.
    onSettled: () => {
      navigate("/login", { replace: true });
      qc.clear();
    },
  });
}
