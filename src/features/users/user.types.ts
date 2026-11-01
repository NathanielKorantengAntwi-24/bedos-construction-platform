export const USER_ROLES = ["administrator", "content_manager", "finance", "sales_customer_service", "customer"] as const;
export const ACCOUNT_STATUSES = ["active", "suspended", "inactive"] as const;

export type UserRole = typeof USER_ROLES[number];
export type AccountStatus = typeof ACCOUNT_STATUSES[number];
export type UserListInput = {
  page: number;
  limit: number;
  role: UserRole | null;
  accountStatus: AccountStatus | null;
  q: string | null;
};
export type ManagedUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  account_status: AccountStatus;
  role: { id: string; name: UserRole } | null;
  created_at: string;
  updated_at: string;
};
export type UserDetail = ManagedUser & {
  invitation: {
    status: "pending" | "activated" | "revoked";
    created_at: string;
    activated_at: string | null;
    revoked_at: string | null;
  } | null;
};
export type UserListResult = { users: ManagedUser[]; page: number; limit: number; total: number };

export type UpdateUserStatusInput = {
  account_status: "active" | "suspended";
  expected_account_status: AccountStatus;
  reason: string;
};
export type UpdateUserStatusResult = {
  user_id: string;
  account_status: "active" | "suspended";
};
