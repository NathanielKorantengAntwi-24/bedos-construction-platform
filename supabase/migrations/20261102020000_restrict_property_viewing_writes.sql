BEGIN;
LOCK TABLE public.viewing_requests IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF to_regprocedure('public.bedos_mutate_viewing(uuid,text,uuid,uuid,jsonb,integer)') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.viewing_requests'::regclass AND tgname='viewing_property_publication_guard' AND tgenabled='O') THEN RAISE EXCEPTION 'Expected guarded viewing dependencies';END IF;
 IF EXISTS(SELECT 1 FROM public.viewing_requests v WHERE NOT EXISTS(SELECT 1 FROM public.viewing_notification_events e WHERE e.viewing_id=v.id AND e.event_type='customer_new' AND e.recipient_id=v.customer_id AND e.created_by=v.customer_id AND e.viewing_version=1) OR NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.entity_type='viewing_request' AND a.entity_id=v.id AND a.action='viewing_request_created' AND a.actor_id=v.customer_id AND a.metadata->'after'->>'property_id'=v.property_id::text AND a.metadata->'after'->>'customer_id'=v.customer_id::text AND a.metadata->'after'->>'version'='1')) THEN RAISE EXCEPTION 'Untracked viewings appeared during cutover; explicit provenance review required';END IF;
 IF EXISTS(SELECT 1 FROM public.viewing_requests WHERE status='in_progress') THEN RAISE EXCEPTION 'Legacy viewing states require explicit provenance review';END IF;
END;$guard$;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.viewing_requests FROM PUBLIC,anon,authenticated,service_role;
DO $guard$ DECLARE r text;p text;BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF has_table_privilege(r,'public.viewing_requests',p) THEN RAISE EXCEPTION 'Residual viewing mutation privilege';END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
   IF has_any_column_privilege(r,'public.viewing_requests',p) THEN RAISE EXCEPTION 'Residual viewing column privilege';END IF;
  END LOOP;
 END LOOP;
END;$guard$;
-- Preserve existing policies and narrow direct reads to the approved active/permission boundary.
CREATE POLICY bedos_viewing_active_read ON public.viewing_requests AS RESTRICTIVE FOR SELECT TO anon,authenticated USING (
 EXISTS(SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id
 WHERE p.id=(SELECT auth.uid()) AND p.account_status='active' AND
 ((r.name='customer' AND customer_id=p.id) OR (r.name IN('administrator','sales_customer_service') AND
 EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions pm ON pm.id=rp.permission_id WHERE rp.role_id=p.role_id AND pm.name='viewings.view'))))
);
ALTER TABLE public.viewing_requests DROP CONSTRAINT viewing_requests_status_check;
ALTER TABLE public.viewing_requests ADD CONSTRAINT viewing_requests_status_check CHECK(status IN('new','contacted','scheduled','completed','cancelled'));
NOTIFY pgrst,'reload schema';
COMMIT;
