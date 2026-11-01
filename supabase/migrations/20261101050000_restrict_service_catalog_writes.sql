-- Apply only AFTER the guarded catalog app release is live and verified.
BEGIN;
DO $prerequisite$
BEGIN
 IF pg_catalog.to_regprocedure('public.bedos_mutate_service(uuid,text,uuid,jsonb)') IS NULL
 OR pg_catalog.to_regprocedure('public.bedos_mutate_service_category(uuid,text,uuid,jsonb)') IS NULL
 OR pg_catalog.to_regprocedure('public.bedos_read_service_catalog(uuid,boolean,text,uuid,text,integer,integer,uuid,boolean,text,text)') IS NULL THEN
  RAISE EXCEPTION 'Guarded catalog operations must be installed first';
 END IF;
END;$prerequisite$;

-- Existing SELECT grants and RLS reads are preserved. All writes use audited RPCs.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.services,public.service_categories FROM PUBLIC,anon,authenticated,service_role;
DO $guard$
DECLARE v_role text;v_table text;v_privilege text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH v_table IN ARRAY ARRAY['public.services','public.service_categories'] LOOP
      FOREACH v_privilege IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege(v_role,v_table,v_privilege) THEN RAISE EXCEPTION 'Unexpected catalog write grant';END IF;
      END LOOP;
      FOREACH v_privilege IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
        IF pg_catalog.has_any_column_privilege(v_role,v_table,v_privilege) THEN RAISE EXCEPTION 'Unexpected catalog column write grant';END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;$guard$;
NOTIFY pgrst,'reload schema';
COMMIT;
