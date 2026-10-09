import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Only allow safe, internal redirect paths.
  const destination =
    next && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=missing_auth_code`);
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/?error=auth_callback_failed`,
    );
  }

  return NextResponse.redirect(`${origin}${destination}`);
}