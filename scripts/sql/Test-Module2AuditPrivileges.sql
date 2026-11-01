-- LOCAL LAB ONLY: execute inside a rollback transaction. Never run in production.
CREATE TEMP TABLE audit_privilege_checks(name text PRIMARY KEY);
DO $test$
DECLARE r text; privilege text; statement text; denied boolean; entry_id uuid;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(r,'public.audit_logs',privilege)
         IS DISTINCT FROM (r='service_role' AND privilege IN ('SELECT','INSERT')) THEN
        RAISE EXCEPTION 'Unexpected effective privilege: % %',r,privilege;
      END IF;
      INSERT INTO audit_privilege_checks VALUES(r||' effective '||privilege);
    END LOOP;
    -- Actual statements run under the application role, including BYPASSRLS service.
    FOREACH statement IN ARRAY ARRAY[
      'UPDATE public.audit_logs SET action=action WHERE false',
      'DELETE FROM public.audit_logs WHERE false',
      'TRUNCATE TABLE public.audit_logs'
    ] LOOP
      denied:=false;
      BEGIN
        EXECUTE format('SET LOCAL ROLE %I',r);
        EXECUTE statement;
        EXECUTE 'RESET ROLE';
      EXCEPTION WHEN insufficient_privilege THEN
        denied:=true;
      END;
      EXECUTE 'RESET ROLE';
      IF NOT denied THEN RAISE EXCEPTION 'Forbidden audit operation succeeded: % %',r,statement;END IF;
      INSERT INTO audit_privilege_checks VALUES(r||' denied '||statement);
    END LOOP;
    IF r<>'service_role' THEN
      FOREACH statement IN ARRAY ARRAY[
        'SELECT * FROM public.audit_logs LIMIT 1',
        'INSERT INTO public.audit_logs SELECT * FROM public.audit_logs WHERE false'
      ] LOOP
        denied:=false;
        BEGIN
          EXECUTE format('SET LOCAL ROLE %I',r);
          EXECUTE statement;
          EXECUTE 'RESET ROLE';
        EXCEPTION WHEN insufficient_privilege THEN denied:=true;
        END;
        EXECUTE 'RESET ROLE';
        IF NOT denied THEN RAISE EXCEPTION 'Ordinary audit access succeeded: %',r;END IF;
        INSERT INTO audit_privilege_checks VALUES(r||' denied '||statement);
      END LOOP;
    END IF;
  END LOOP;
  SET LOCAL ROLE service_role;
  PERFORM 1 FROM public.audit_logs LIMIT 1;
  INSERT INTO public.audit_logs(action,entity_type,description)
    VALUES('bedos_local_audit_privilege_probe','verification','Rollback-only local service insert')
    RETURNING id INTO entry_id;
  IF NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE id=entry_id) THEN
    RAISE EXCEPTION 'Service insert/read failed';
  END IF;
  RESET ROLE;
  INSERT INTO audit_privilege_checks VALUES('service SELECT and INSERT permitted');
END;
$test$;
SELECT json_build_object('audit_privilege_assertions',count(*)) FROM audit_privilege_checks;
