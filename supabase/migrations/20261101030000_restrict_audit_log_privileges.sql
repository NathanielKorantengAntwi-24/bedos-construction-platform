BEGIN;

-- Application users access audit-producing operations through guarded RPCs.
-- Preserve service append/read access and owner-managed SECURITY DEFINER writes.
REVOKE ALL PRIVILEGES ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.audit_logs FROM service_role;

-- Fail closed if inherited or column-specific grants defeat the intended result.
DO $guard$
DECLARE role_name text; privilege_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
            IF has_table_privilege(role_name,'public.audit_logs',privilege_name)
               IS DISTINCT FROM (role_name='service_role' AND privilege_name IN ('SELECT','INSERT')) THEN
                RAISE EXCEPTION 'Unexpected effective audit table privilege: % %',role_name,privilege_name;
            END IF;
        END LOOP;
        FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
            IF has_any_column_privilege(role_name,'public.audit_logs',privilege_name)
               IS DISTINCT FROM (role_name='service_role' AND privilege_name IN ('SELECT','INSERT')) THEN
                RAISE EXCEPTION 'Unexpected effective audit column privilege: % %',role_name,privilege_name;
            END IF;
        END LOOP;
    END LOOP;
END;
$guard$;

COMMIT;
