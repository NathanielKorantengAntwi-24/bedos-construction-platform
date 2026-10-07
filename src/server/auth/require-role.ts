import { getUserContext } from "./get-user-context";
import { ApiError } from "@/server/http/api-error";

export async function requireRole(allowedRoles: string[]) {
  const context = await getUserContext();

  if (!context) {
    throw new ApiError("Unauthorized", 401);
  }

  if (context.profile.account_status !== "active") {
    throw new ApiError("Account is not active", 403);
  }

  if (!context.role?.name || !allowedRoles.includes(context.role.name)) {
    throw new ApiError("Forbidden", 403);
  }

  return context;
}