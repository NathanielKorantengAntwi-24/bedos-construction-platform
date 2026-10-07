import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();

  if (error) {
    return NextResponse.json(
      { error: "Failed to sign out." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Signed out successfully.",
  });
}