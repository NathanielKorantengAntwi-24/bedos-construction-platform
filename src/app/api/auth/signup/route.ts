import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ApiError, errorResponse } from "@/server/http/api-error";
import { parseJson } from "@/server/http/parse-json";

type SignupRequest = {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
};

function confirmationRedirectUrl(): string {
  const production = process.env.NODE_ENV === "production";
  const configured = process.env.BEDOS_APP_ORIGIN ||
    (production
      ? "https://bedos-construction-platform.vercel.app"
      : "http://localhost:3000");

  let origin: URL;
  try {
    origin = new URL(configured);
  } catch {
    throw new ApiError("Registration confirmation is not configured.", 503);
  }

  const localHttp = !production && origin.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !localHttp) ||
      origin.username || origin.password || origin.pathname !== "/" ||
      origin.search || origin.hash) {
    throw new ApiError("Registration confirmation is not configured.", 503);
  }

  // Use a trusted deployment origin, never request Host or forwarded headers.
  return new URL("/auth/callback", origin).toString();
}

export async function POST(request: Request) {
  try {
    const parsed = await parseJson<unknown>(request);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return NextResponse.json(
        { error: "Request body must be an object" },
        { status: 400 },
      );
    }

    const body = parsed as SignupRequest;

    if (
      typeof body.email !== "string" ||
      typeof body.password !== "string" ||
      typeof body.full_name !== "string" ||
      !body.email.trim() ||
      !body.password ||
      !body.full_name.trim()
    ) {
      return NextResponse.json(
        {
          error: "Email, password, and full name are required",
        },
        { status: 400 },
      );
    }

    if (
      body.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
      body.full_name.trim().length > 200 ||
      (body.phone !== undefined &&
        (typeof body.phone !== "string" ||
          body.phone.trim().length > 40))
    ) {
      return NextResponse.json(
        { error: "Invalid registration details" },
        { status: 400 },
      );
    }

    if (body.password.length < 8) {
      return NextResponse.json(
        {
          error: "Password must be at least 8 characters",
        },
        { status: 400 },
      );
    }

    const emailRedirectTo = confirmationRedirectUrl();
    const supabase = await createClient();

    const { data, error } = await supabase.auth.signUp({
      email: body.email,
      password: body.password,
      options: {
        emailRedirectTo,
        data: {
          full_name: body.full_name,
          phone: body.phone ?? null,
        },
      },
    });

    if (error) {
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        user: data.user
          ? {
              id: data.user.id,
              email: data.user.email,
            }
          : null,
      confirmation_required: !data.session,
      message: data.session
        ? "Account created successfully"
        : "Check your email to confirm your account before signing in.",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
