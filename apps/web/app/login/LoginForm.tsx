"use client";

import { FormEvent, useState } from "react";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, next }) });
      const body = (await response.json().catch(() => ({}))) as { error?: string; next?: string };
      if (!response.ok) { setMessage(body.error ?? "Could not sign in."); setBusy(false); return; }
      window.location.assign(body.next ?? "/");
    } catch {
      setMessage("The server could not be reached. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="loginForm">
      <label>User name<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required /></label>
      <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      {message ? <p className="loginMessage" role="alert">{message}</p> : null}
      <button type="submit" className="primaryButton" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
