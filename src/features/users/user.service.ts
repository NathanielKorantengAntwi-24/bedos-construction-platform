import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError } from "@/server/http/api-error";
import { ACCOUNT_STATUSES, USER_ROLES, STAFF_ROLES, type UserListInput, type UserListResult, type UserDetail } from "./user.types";
import type { UpdateUserStatusInput, UpdateUserStatusResult, UpdateUserRoleInput, UpdateUserRoleResult } from "./user.types";

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function validateUserId(id: string) {
  if (!UUID_PATTERN.test(id)) {
    throw new ApiError("Invalid user ID.", 400);
  }
}

export function parseUserListQuery(params: URLSearchParams): UserListInput {
  const allowed = ["page", "limit", "role", "account_status", "q"];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) {
      throw new ApiError("Unknown or repeated user query parameter.", 400);
    }
  }
  function integer(key: string, fallback: number, maximum: number) {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > maximum) {
      throw new ApiError(`Invalid ${key}.`, 400);
    }
    return Number(raw);
  }
  const role = params.get("role");
  const accountStatus = params.get("account_status");
  if (role !== null && !USER_ROLES.some(value => value === role)) throw new ApiError("Invalid role filter.", 400);
  if (accountStatus !== null && !ACCOUNT_STATUSES.some(value => value === accountStatus)) throw new ApiError("Invalid account status filter.", 400);
  const q = params.get("q")?.trim() || null;
  if (q && (q.length > 100 || q.includes("\0"))) throw new ApiError("Invalid search query.", 400);
  return { page: integer("page", 1, 2147483647), limit: integer("limit", 25, 100), role: role as UserListInput["role"], accountStatus: accountStatus as UserListInput["accountStatus"], q };
}

async function readUsers(actorId: string, args: Record<string, unknown>) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("bedos_read_users", { p_actor_id: actorId, ...args });
  if (error) {
    if (error.code === "42501") throw new ApiError("Forbidden", 403);
    if (error.code === "22023") throw new ApiError("Invalid user query.", 400);
    console.error("User administration read failed", { code: error.code });
    throw new ApiError("Unable to retrieve users.", 500);
  }
  return data;
}

export async function listUsers(actorId: string, input: UserListInput): Promise<UserListResult> {
  const data = await readUsers(actorId, { p_page: input.page, p_limit: input.limit, p_role: input.role, p_account_status: input.accountStatus, p_q: input.q });
  if (!data) throw new ApiError("Unable to retrieve users.", 500);
  return data as UserListResult;
}

export async function getUserById(actorId: string, id: string): Promise<UserDetail> {
  validateUserId(id);
  const data = await readUsers(actorId, { p_user_id: id });
  if (!data) throw new ApiError("User not found", 404);
  return data as UserDetail;
}

function parseAuditReason(reason: unknown): string {
  if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 500 || reason.includes("\0")) {
    throw new ApiError("A reason between 1 and 500 characters is required.", 400);
  }
  return reason.trim();
}

export function parseUserStatusInput(body: unknown): UpdateUserStatusInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("Request body must be an object.", 400);
  }
  const input = body as Record<string, unknown>;
  const keys = ["account_status", "expected_account_status", "reason"];
  if (Object.keys(input).some(key => !keys.includes(key))) {
    throw new ApiError("Unknown account status field.", 400);
  }
  if (input.account_status !== "active" && input.account_status !== "suspended") {
    throw new ApiError("Invalid requested account status.", 400);
  }
  if (!ACCOUNT_STATUSES.some(status => status === input.expected_account_status)) {
    throw new ApiError("Invalid expected account status.", 400);
  }
  return {
    account_status: input.account_status,
    expected_account_status: input.expected_account_status as UpdateUserStatusInput["expected_account_status"],
    reason: parseAuditReason(input.reason),
  };
}

export async function updateUserStatus(
  actorId: string,
  id: string,
  input: UpdateUserStatusInput,
): Promise<UpdateUserStatusResult> {
  validateUserId(id);
  const targetId = id.toLowerCase();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("bedos_update_user_status", {
    p_actor_id: actorId,
    p_user_id: targetId,
    p_account_status: input.account_status,
    p_expected_account_status: input.expected_account_status,
    p_reason: input.reason,
  });
  if (error) {
    if (error.code === "42501") throw new ApiError("Forbidden", 403);
    if (error.code === "22023") throw new ApiError("Invalid account status request.", 400);
    if (error.code === "P0002") throw new ApiError("User not found", 404);
    if (error.code === "P0001") throw new ApiError("Account status transition requirements not satisfied.", 409);
    console.error("Account status update failed", { code: error.code });
    throw new ApiError("Unable to update account status.", 500);
  }
  if (data?.user_id !== targetId || data.account_status !== input.account_status) {
    throw new ApiError("Unable to update account status.", 500);
  }
  return { user_id: data.user_id, account_status: data.account_status };
}

export function parseUserRoleInput(body: unknown): UpdateUserRoleInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("Request body must be an object.", 400);
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !["role_id", "expected_role_id", "reason"].includes(key))) {
    throw new ApiError("Unknown account role field.", 400);
  }
  if (typeof input.role_id !== "string" || !UUID_PATTERN.test(input.role_id) ||
      typeof input.expected_role_id !== "string" || !UUID_PATTERN.test(input.expected_role_id)) {
    throw new ApiError("Valid requested and expected role IDs are required.", 400);
  }
  return {
    role_id: input.role_id.toLowerCase(),
    expected_role_id: input.expected_role_id.toLowerCase(),
    reason: parseAuditReason(input.reason),
  };
}

export async function updateUserRole(
  actorId: string,
  id: string,
  input: UpdateUserRoleInput,
): Promise<UpdateUserRoleResult> {
  validateUserId(id);
  const targetId = id.toLowerCase();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("bedos_update_user_role", {
    p_actor_id: actorId,
    p_user_id: targetId,
    p_role_id: input.role_id,
    p_expected_role_id: input.expected_role_id,
    p_reason: input.reason,
  });
  if (error) {
    if (error.code === "42501") throw new ApiError("Forbidden", 403);
    if (error.code === "22023") throw new ApiError("Invalid account role request.", 400);
    if (error.code === "P0002") throw new ApiError("User not found", 404);
    if (error.code === "P0001") throw new ApiError("Account role transition requirements not satisfied.", 409);
    console.error("Account role update failed", { code: error.code });
    throw new ApiError("Unable to update account role.", 500);
  }
  if (data?.user_id !== targetId || data.role?.id !== input.role_id ||
      !STAFF_ROLES.some(name => name === data.role?.name)) {
    throw new ApiError("Unable to update account role.", 500);
  }
  return { user_id: data.user_id, role: { id: data.role.id, name: data.role.name } };
}
