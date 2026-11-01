BEGIN;
-- Apply only after the property RPC migration and application deployment are verified.
DO $prerequisite$ BEGIN
  IF pg_catalog.to_regprocedure('public.bedos_mutate_property(uuid,text,uuid,jsonb)') IS NULL OR
    pg_catalog.to_regprocedure('public.bedos_read_properties(uuid,uuid,jsonb)') IS NULL OR
    NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.viewing_requests'::regclass AND tgname='viewing_property_publication_guard' AND tgenabled='O') OR
    NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.enquiries'::regclass AND tgname='enquiry_property_publication_guard' AND tgenabled='O') THEN
    RAISE EXCEPTION 'Guarded property operations must be installed first';
  END IF;
END;$prerequisite$;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.properties FROM PUBLIC,anon,authenticated,service_role;
DO $guard$
DECLARE role_name text; privilege_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(role_name,'public.properties',privilege_name) THEN RAISE EXCEPTION 'Unexpected property write grant';END IF;
    END LOOP;
    FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
      IF pg_catalog.has_any_column_privilege(role_name,'public.properties',privilege_name) THEN RAISE EXCEPTION 'Unexpected property column write grant';END IF;
    END LOOP;
  END LOOP;
END;$guard$;
NOTIFY pgrst,'reload schema';
COMMIT;
