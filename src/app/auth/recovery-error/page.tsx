export default function RecoveryErrorPage() {
  return (
    <main>
      <section>
        <h1>Recovery link unavailable</h1>

        <p>
          This invitation or password-reset link is missing,
          invalid, or has expired.
        </p>

        <p>
          Password-reset links can expire or become invalid
          after they have been used.
        </p>

        <p>
          <a href="/auth/forgot-password">
            Request a new password-reset link
          </a>
        </p>

        <p>
          <a href="/">Return to homepage</a>
        </p>
      </section>
    </main>
  );
}