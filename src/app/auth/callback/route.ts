import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Reject protocol-relative and backslash-based redirects.
  const requestedPath =
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\")
      ? next
      : "/";

  const candidateUrl = new URL(requestedPath, origin);

  const destination =
    candidateUrl.origin === origin
      ? candidateUrl.pathname + candidateUrl.search + candidateUrl.hash
      : "/";

  const isRecoveryCallback = next === "/auth/set-password";
  const recoveryErrorUrl = new URL("/auth/recovery-error", origin);

  if (!code) {
    return NextResponse.redirect(
      isRecoveryCallback
        ? recoveryErrorUrl
        : `${origin}/?error=missing_auth_code`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      isRecoveryCallback
        ? recoveryErrorUrl
        : `${origin}/?error=auth_callback_failed`,
    );
  }

  return NextResponse.redirect(`${origin}${destination}`);
}