import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "../lib/api";

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");

  useEffect(() => {
    const token = params.get("token");
    const result = token
      ? api.post("/auth/verify", { token }).then(
          () => "ok" as const,
          () => "error" as const,
        )
      : Promise.resolve("error" as const);
    result.then(setStatus);
  }, [params]);

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Genkin-Impact</h1>
        {status === "checking" && <p>Verifying…</p>}
        {status === "ok" && <p>Your email is verified.</p>}
        {status === "error" && <p>This verification link is invalid or expired.</p>}
        <p className="auth-switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
