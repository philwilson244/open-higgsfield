"use client";
import { useState } from "react";
import { authenticate } from "../auth-actions";

export function LoginForm({
  confirmationError,
}: {
  confirmationError: boolean;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    confirmationError
      ? "The confirmation link expired or could not be verified. Try signing in after confirming your email."
      : "",
  );
  return (
    <form
      className="ads-card ads-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage("");
        const data = new FormData(e.currentTarget);
        try {
          const result = await authenticate({
            email: data.get("email"),
            password: data.get("password"),
            mode,
          });
          if (result.signedIn) window.location.assign("/ads");
          else setMessage(result.error ?? result.message ?? "Try again.");
        } catch {
          setMessage("Unable to connect. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={8}
          maxLength={128}
          required
        />
      </label>
      {message && <p role="status">{message}</p>}
      <button className="ads-primary" disabled={busy}>
        {busy ? "Connecting…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
      >
        {mode === "login"
          ? "Need an account? Sign up"
          : "Already registered? Sign in"}
      </button>
    </form>
  );
}
