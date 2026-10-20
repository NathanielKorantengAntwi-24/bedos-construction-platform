import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { errorResponse } from "@/server/http/api-error";
import { parseJson } from "@/server/http/parse-json";

type SignupRequest = {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
};

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

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signUp({
      email: body.email,
      password: body.password,
      options: {
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
        message: "Account created successfully",
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}