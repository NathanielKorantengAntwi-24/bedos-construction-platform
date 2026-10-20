import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/server/auth/get-user-context";

export async function GET() {
  const context = await getUserContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (context.profile.account_status !== "active") {
    return NextResponse.json(
      { error: "Account is not active" },
      { status: 403 },
    );
  }

  return NextResponse.json({
    user: {
      id: context.user.id,
      email: context.user.email,
    },
    profile: {
      id: context.profile.id,
      full_name: context.profile.full_name,
      phone: context.profile.phone,
      account_status: context.profile.account_status,
    },
    role: context.role,
  });
}

export async function PATCH(request: Request) {
  try {
    const context = await getUserContext();

    if (!context) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    if (context.profile.account_status !== "active") {
      return NextResponse.json(
        { error: "Account is not active" },
        { status: 403 },
      );
    }

    let rawBody: unknown;

    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (
      typeof rawBody !== "object" ||
      rawBody === null ||
      Array.isArray(rawBody)
    ) {
      return NextResponse.json(
        { error: "Request body must be an object" },
        { status: 400 },
      );
    }

    const body = rawBody as Record<string, unknown>;
    const keys = Object.keys(body);

    if (
      keys.length === 0 ||
      keys.some(
        (key) => key !== "full_name" && key !== "phone",
      )
    ) {
      return NextResponse.json(
        { error: "Only full_name and phone may be updated" },
        { status: 400 },
      );
    }

    const changes: {
      full_name?: string;
      phone?: string | null;
    } = {};

    if (Object.prototype.hasOwnProperty.call(body, "full_name")) {
      if (
        typeof body.full_name !== "string" ||
        body.full_name.trim().length < 2 ||
        body.full_name.trim().length > 100
      ) {
        return NextResponse.json(
          { error: "Full name must contain 2 to 100 characters" },
          { status: 400 },
        );
      }

      changes.full_name = body.full_name.trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, "phone")) {
      if (body.phone === null || body.phone === "") {
        changes.phone = null;
      } else if (
        typeof body.phone === "string" &&
        body.phone.trim().length >= 3 &&
        body.phone.trim().length <= 32
      ) {
        changes.phone = body.phone.trim();
      } else {
        return NextResponse.json(
          { error: "Invalid phone number" },
          { status: 400 },
        );
      }
    }

    const supabase = await createClient();

    const { data: profile, error } = await supabase
      .from("profiles")
      .update(changes)
      .eq("id", context.user.id)
      .eq("account_status", "active")
      .select("id, full_name, phone, account_status")
      .maybeSingle();

    if (error) {
      console.error("Profile update failed", error);

      return NextResponse.json(
        { error: "Unable to update profile" },
        { status: 500 },
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: "Active profile not found" },
        { status: 403 },
      );
    }

    return NextResponse.json({ profile });
  } catch (error) {
    console.error("Profile update request failed", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}