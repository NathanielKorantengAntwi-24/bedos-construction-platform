"use client";

import { type FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading) return;

    const normalizedEmail = email.trim().toLowerCase();

    if (
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      setMessage("Enter a valid email address.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const redirectUrl = new URL(
        "/auth/callback",
        window.location.origin,
      );

      redirectUrl.searchParams.set(
        "next",
        "/auth/set-password",
      );

      const supabase = createClient();

      const { error } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        { redirectTo: redirectUrl.toString() },
      );

      if (error) {
        setMessage(
          "Unable to send a recovery email right now. Please try again later.",
        );
        return;
      }

      setMessage(
        "If an account exists for this email, you will receive a password-reset link.",
      );
    } catch {
      setMessage(
        "Unable to send a recovery email right now. Please try again later.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section>
        <h1>Forgot your password?</h1>
        <p>
          Enter your account email to request a password-reset link.
        </p>

        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              maxLength={254}
              required
            />
          </div>

          <button type="submit" disabled={loading}>
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        {message && <p role="status">{message}</p>}

        <p>
          <a href="/">Return to homepage</a>
        </p>
      </section>
    </main>
  );
}