# Local test helper recovery decision

Resolution: user explicitly approved the snapshot restoration; it was executed against the guarded local container and verified. Subsequent corrected integration runs persist the pre-run definition and verify it restored exactly. No production helper was changed.

The first Module 7 integration run temporarily installed the active-account `get_user_role()` definition used by earlier local test harnesses. Its pre-run definition was read into process memory but was not saved before that process exited. The known local snapshot has the SQL below. Its equivalence to the lost pre-run definition cannot be independently established from the saved Module 7 evidence.

Proposed recovery, requiring approval: restore only this function in `supabase_db_bedos-supabase-lab`, preserving its existing identity, owner and grants. No hosted database is involved. The risk is restoring a historical definition rather than an independently verified pre-run definition. This helper is a local test dependency, not the Module 7 implementation.

```sql
CREATE OR REPLACE FUNCTION public.get_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select r.name
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid();
$$;
```

Source: `supabase/remote_schema_snapshot.sql`, existing get_user_role definition. Until approval, leave the current active-account helper unchanged and record that local restoration is incomplete. Future integration runs must persist their pre-run helper definition and all other restoration metadata before any mutation.
