import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseJson } from "@/server/http/parse-json";

type LoginRequest = {
  email: string;
  password: string;
};

export async function POST(request: Request) {
  try {
    const body = await parseJson<LoginRequest>(request);

    if (!body.email || !body.password) {
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
    console.error(error);

    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}