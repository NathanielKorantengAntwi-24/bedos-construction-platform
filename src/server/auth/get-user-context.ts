import { createClient } from "@/lib/supabase/server";

export async function getUserContext() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(`
      id,
      full_name,
      phone,
      account_status,
      role_id,
      roles (
        id,
        name
      )
    `)
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return null;
  }

  const role = Array.isArray(profile.roles)
    ? profile.roles[0]
    : profile.roles;

  return {
    user,
    profile,
    role,
  };
}