import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseJson } from "@/server/http/parse-json";
import { errorResponse } from "@/server/http/api-error";

type LoginRequest = {
  email: string;
  password: string;
};

export async function POST(request: Request) {
  try {
    const body = await parseJson<LoginRequest>(request);

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { error: "Request body must be an object" },
        { status: 400 },
      );
    }

    if (
      typeof body.email !== "string" ||
      typeof body.password !== "string" ||
      !body.email.trim() ||
      !body.password
    ) {
      return NextResponse.json(
        {
          error: "Email and password are required",
        },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (error) {
      return NextResponse.json(
        {
          error: "Invalid email or password",
        },
        { status: 401 },
      );
    }

    const userId = data.user?.id;

    let lookupFailed = !userId;
    let accountStatus: string | null = null;

    if (userId) {
      try {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("account_status")
          .eq("id", userId)
          .single();

        if (profileError || !profile) {
          lookupFailed = true;
        } else {
          accountStatus = profile.account_status;
        }
      } catch (lookupError) {
        console.error("Login account-status lookup failed", lookupError);
        lookupFailed = true;
      }
    }

    if (lookupFailed || accountStatus !== "active") {
      try {
        const { error: signOutError } = await supabase.auth.signOut();

        if (signOutError) {
          console.error("Rejected login session cleanup failed", signOutError);

          return NextResponse.json(
            { error: "Unable to complete login securely" },
            { status: 500 },
          );
        }
      } catch (signOutError) {
        console.error("Rejected login session cleanup threw", signOutError);

        return NextResponse.json(
          { error: "Unable to complete login securely" },
          { status: 500 },
        );
      }

      return NextResponse.json(
        {
          error: lookupFailed
            ? "Unable to verify account status"
            : "Account is not active",
        },
        { status: lookupFailed ? 503 : 403 },
      );
    }
    return NextResponse.json({
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email,
          }
        : null,
      message: "Login successful",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
