"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;

    async function verifySession() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.getUser();

        if (!mounted) return;

        if (error || !data.user) {
          setHasSession(false);
          setMessage(
            "Your session is missing or expired. Open your invitation or password-reset link again.",
          );
          return;
        }

        setHasSession(true);
      } catch {
        if (!mounted) return;
        setHasSession(false);
        setMessage("Unable to verify your session. Please try again.");
      }
    }

    void verifySession();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (hasSession !== true || loading) {
      setMessage("An authenticated session is required.");
      return;
    }

    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const supabase = createClient();

      const { data, error: sessionError } =
        await supabase.auth.getUser();

      if (sessionError || !data.user) {
        setHasSession(false);
        setMessage(
          "Your session has expired. Open your invitation or password-reset link again.",
        );
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setPassword("");
      setConfirmPassword("");
      setMessage("Password set successfully.");
    } catch {
      setMessage("Unable to set your password. Please try again.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main>
      <section>
        <h1>Set your password</h1>

        <p>Create a password for your account.</p>

        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>

          <div>
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>

          <button type="submit" disabled={loading || hasSession !== true}>
            {loading ? "Saving..." : "Set password"}
          </button>
        </form>

        {hasSession === null && <p>Checking your session...</p>}
        {message && <p>{message}</p>}
      </section>
    </main>
  );
}