import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";

export async function GET() {
  const context = await getUserContext();

  if (!context) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
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