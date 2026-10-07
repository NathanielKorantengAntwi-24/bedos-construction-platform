import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { listUserNotifications } from "@/features/notifications/notification.service";

export async function GET() {
  try {
    const userContext = await getUserContext();

    if (!userContext) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (userContext.profile.account_status !== "active") {
      return NextResponse.json(
        { error: "Account is not active" },
        { status: 403 }
      );
    }

    const notifications = await listUserNotifications(
      userContext.user.id
    );

    return NextResponse.json({
      data: notifications,
    });
  } catch (error) {
    console.error("GET /api/notifications failed:", error);

    return NextResponse.json(
      { error: "Failed to load notifications" },
      { status: 500 }
    );
  }
}
