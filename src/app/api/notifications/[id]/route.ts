import { NextResponse } from "next/server";
import { getUserContext } from "@/server/auth/get-user-context";
import { markNotificationAsRead } from "@/features/notifications/notification.service";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(
  _request: Request,
  context: RouteContext
) {
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

    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        { error: "Notification ID is required" },
        { status: 400 }
      );
    }

    const notification = await markNotificationAsRead(
      id,
      userContext.user.id
    );

    return NextResponse.json({
      data: notification,
    });
  } catch (error) {
    console.error("PATCH /api/notifications/[id] failed:", error);

    return NextResponse.json(
      { error: "Notification not found" },
      { status: 404 }
    );
  }
}
