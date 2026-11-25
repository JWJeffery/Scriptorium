"use client";

import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password"), next })
    });
    const result = (await response.json()) as { ok?: boolean; next?: string; error?: string };
    if (response.ok && result.ok) {
      window.location.href = result.next ?? "/";
    } else {
      setError(result.error ?? "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>Dashboard</h1>
      <input name="username" placeholder="User name" autoComplete="username" required />
      <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
      <div className="error" role="alert">{error}</div>
      <button type="submit" disabled={busy}>Sign in</button>
    </form>
  );
}
