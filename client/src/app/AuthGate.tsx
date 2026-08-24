import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../lib/api.js";
import { AppRouter } from "./AppRouter.js";
import type { User } from "./types.js";

export function AuthGate() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User }>("/api/v2/auth/me"),
    retry: false,
  });
  if (me.isLoading)
    return (
      <main className="boot" aria-live="polite">
        <div className="brand-mark">H</div>
        <p>Opening Homix Marketing…</p>
      </main>
    );
  if (me.isError) return <LocalLogin onSuccess={() => void me.refetch()} />;
  return <AppRouter user={me.data!.user} />;
}

function LocalLogin({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("admin@homixny.com");
  const login = useMutation({
    mutationFn: () =>
      api("/api/v2/auth/dev-login", { method: "POST", body: JSON.stringify({ email }) }),
    onSuccess,
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate();
  }
  return (
    <main className="login-simple">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark">H</div>
        <p className="eyebrow">Homix Marketing</p>
        <h1>Sign in</h1>
        <p>Production uses your Microsoft account.</p>
        <label>
          Development email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        {login.error ? <p className="form-error">{login.error.message}</p> : null}
        <button className="button primary" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
