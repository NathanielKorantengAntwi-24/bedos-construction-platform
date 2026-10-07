import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "./get-user-context";
import { ApiError } from "@/server/http/api-error";

export async function requirePermission(permissionName: string) {
  const context = await getUserContext();

  if (!context) {
    throw new ApiError("Unauthorized", 401);
  }

  if (context.profile.account_status !== "active") {
    throw new ApiError("Account is not active", 403);
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("role_permissions")
    .select(`
      permissions (
        name
      )
    `)
    .eq("role_id", context.profile.role_id);

  if (error) {
    throw new ApiError("Unable to verify permission", 500);
  }

  const hasPermission = data?.some((item) => {
    const permission = Array.isArray(item.permissions)
      ? item.permissions[0]
      : item.permissions;

    return permission?.name === permissionName;
  });

  if (!hasPermission) {
    throw new ApiError("Forbidden", 403);
  }

  return context;
}