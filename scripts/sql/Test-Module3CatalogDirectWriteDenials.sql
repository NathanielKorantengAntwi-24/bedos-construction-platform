-- LOCAL LAB ONLY. Actual TRUNCATE denial probes must never run in production.
DO $local_probes$
DECLARE role_name text;table_name text;statement text;denied boolean;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH table_name IN ARRAY ARRAY['services','service_categories'] LOOP
   FOREACH statement IN ARRAY ARRAY['INSERT INTO public.'||table_name||' DEFAULT VALUES','UPDATE public.'||table_name||' SET name=name WHERE false','DELETE FROM public.'||table_name||' WHERE false','TRUNCATE public.'||table_name||' CASCADE'] LOOP
    denied:=false;
    BEGIN EXECUTE format('SET LOCAL ROLE %I',role_name);EXECUTE statement;EXECUTE 'RESET ROLE';EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
    EXECUTE 'RESET ROLE';PERFORM pg_temp.check_catalog(role_name||' actual denial '||statement,denied);
   END LOOP;
  END LOOP;
 END LOOP;
END;$local_probes$;
