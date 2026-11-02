BEGIN;
LOCK TABLE public.viewing_requests IN ACCESS EXCLUSIVE MODE;
DO $preflight$ BEGIN IF EXISTS(SELECT 1 FROM public.viewing_requests) THEN RAISE EXCEPTION 'Existing viewings require explicit provenance review before this zero-baseline release';END IF;END;$preflight$;
ALTER TABLE public.viewing_requests ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE public.viewing_requests DROP CONSTRAINT viewing_requests_status_check;
-- Additive compatibility window. Phase two removes the old writer's in_progress value.
ALTER TABLE public.viewing_requests ADD CONSTRAINT viewing_requests_status_check CHECK(status IN('new','contacted','in_progress','scheduled','completed','cancelled'));
CREATE INDEX viewing_requests_customer_page_idx ON public.viewing_requests(customer_id,created_at DESC,id DESC);
CREATE INDEX viewing_requests_property_page_idx ON public.viewing_requests(property_id,created_at DESC,id DESC);
CREATE INDEX viewing_requests_assignment_page_idx ON public.viewing_requests(assigned_to,created_at DESC,id DESC);
CREATE INDEX viewing_requests_status_page_idx ON public.viewing_requests(status,created_at DESC,id DESC);
CREATE TABLE public.viewing_notification_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),viewing_id uuid NOT NULL,viewing_version integer NOT NULL CHECK(viewing_version>0),
 created_by uuid NOT NULL,recipient_id uuid NOT NULL,event_type text NOT NULL CHECK(event_type IN('customer_new','staff_new','assigned','customer_status','staff_status','customer_schedule','staff_schedule')),
 expected_status text NOT NULL,expected_assigned_to uuid,preferred_date date,preferred_time time,
 notification_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','processing','recorded','suppressed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),version integer NOT NULL DEFAULT 1 CHECK(version>0),lease_token uuid,lease_until timestamptz,last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(viewing_id,viewing_version,event_type,recipient_id)
);
ALTER TABLE public.viewing_notification_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.viewing_notification_events FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX viewing_notification_queue_idx ON public.viewing_notification_events((CASE WHEN state IN('pending','processing') THEN 0 ELSE 1 END),created_at,id);
CREATE INDEX viewing_notification_request_idx ON public.viewing_notification_events(viewing_id);
CREATE UNIQUE INDEX notifications_one_viewing_event_recipient ON public.notifications((metadata->>'viewing_event_id'),recipient_id)
 WHERE related_entity_type='viewing_request' AND metadata ? 'viewing_event_id';

CREATE FUNCTION public.bedos_viewing_actor(p_actor uuid,p_permission text,p_admin boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE role_name text;
BEGIN
 SELECT r.name INTO role_name FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=p_actor AND p.account_status='active';
 IF role_name IS NULL OR role_name NOT IN('customer','administrator','sales_customer_service') OR (p_admin AND role_name<>'administrator') THEN RAISE EXCEPTION 'Viewing authorization denied' USING ERRCODE='42501';END IF;
 IF role_name<>'customer' AND NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.role_permissions rp ON rp.role_id=p.role_id JOIN public.permissions pm ON pm.id=rp.permission_id WHERE p.id=p_actor AND pm.name=p_permission) THEN RAISE EXCEPTION 'Viewing permission denied' USING ERRCODE='42501';END IF;
 RETURN role_name;
END;$function$;

CREATE FUNCTION public.bedos_viewing_project(v public.viewing_requests)
RETURNS jsonb LANGUAGE sql SET search_path='' AS $function$
 SELECT jsonb_build_object('id',v.id,'property_id',v.property_id,'customer_id',v.customer_id,'preferred_date',v.preferred_date,'preferred_time',v.preferred_time,'message',v.message,'status',v.status,'assigned_to',v.assigned_to,'created_at',v.created_at,'updated_at',v.updated_at,'version',v.version);
$function$;

CREATE FUNCTION public.bedos_viewing_validate(p_input jsonb,p_create boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $function$
DECLARE k text;s text;v jsonb:=p_input;allowed text[];
BEGIN
 allowed:=ARRAY['preferred_date','preferred_time','message']||CASE WHEN p_create THEN ARRAY[]::text[] ELSE ARRAY['status','assigned_to'] END;
 IF p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) key WHERE NOT key=ANY(allowed)) OR (NOT p_create AND p_input='{}'::jsonb) THEN RAISE EXCEPTION 'Invalid viewing fields' USING ERRCODE='22023';END IF;
 FOR k IN SELECT jsonb_object_keys(p_input) LOOP
  IF p_input->k='null'::jsonb AND k<>'status' THEN CONTINUE;END IF;
  IF jsonb_typeof(p_input->k)<>'string' THEN RAISE EXCEPTION 'Invalid viewing field type' USING ERRCODE='22023';END IF;
  s:=p_input->>k;
  IF k='message' THEN
   s:=regexp_replace(s,'^[[:space:]]+|[[:space:]]+$','','g');IF char_length(s)>2000 THEN RAISE EXCEPTION 'Viewing message too long' USING ERRCODE='22023';END IF;
   v:=jsonb_set(v,ARRAY[k],CASE WHEN s='' THEN 'null'::jsonb ELSE to_jsonb(s) END);
  ELSIF k='preferred_date' THEN
   IF s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(s,4)='0000' THEN RAISE EXCEPTION 'Invalid viewing date' USING ERRCODE='22023';END IF;
   BEGIN PERFORM s::date;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid viewing date' USING ERRCODE='22023';END;
  ELSIF k='preferred_time' THEN
   IF s !~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN RAISE EXCEPTION 'Invalid viewing time' USING ERRCODE='22023';END IF;
   v:=jsonb_set(v,ARRAY[k],to_jsonb((s::time)::text));
  ELSIF k='status' THEN
   IF s NOT IN('new','contacted','scheduled','completed','cancelled') THEN RAISE EXCEPTION 'Invalid viewing status' USING ERRCODE='22023';END IF;
  ELSIF k='assigned_to' THEN
   IF s !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid viewing assignee' USING ERRCODE='22023';END IF;
  END IF;
 END LOOP;RETURN v;
END;$function$;

CREATE FUNCTION public.bedos_viewing_version()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $function$
BEGIN
 IF OLD.version=2147483647 THEN RAISE EXCEPTION 'Viewing version limit reached' USING ERRCODE='P0001';END IF;
 NEW.version:=OLD.version+1;RETURN NEW;
END;$function$;
CREATE TRIGGER viewing_requests_version BEFORE UPDATE ON public.viewing_requests FOR EACH ROW EXECUTE FUNCTION public.bedos_viewing_version();

CREATE FUNCTION public.bedos_queue_viewing_event(p_actor uuid,v public.viewing_requests,p_type text,p_recipient uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE event_id uuid;
BEGIN
 INSERT INTO public.viewing_notification_events(viewing_id,viewing_version,created_by,recipient_id,event_type,expected_status,expected_assigned_to,preferred_date,preferred_time)
 VALUES(v.id,v.version,p_actor,p_recipient,p_type,v.status,v.assigned_to,v.preferred_date,v.preferred_time)
 ON CONFLICT(viewing_id,viewing_version,event_type,recipient_id) DO NOTHING RETURNING id INTO event_id;
 IF event_id IS NULL THEN SELECT id INTO event_id FROM public.viewing_notification_events WHERE viewing_id=v.id AND viewing_version=v.version AND event_type=p_type AND recipient_id=p_recipient;END IF;
 RETURN event_id;
END;$function$;

CREATE FUNCTION public.bedos_read_viewings(p_actor uuid,p_property uuid DEFAULT NULL,p_id uuid DEFAULT NULL,p_status text DEFAULT NULL,p_customer uuid DEFAULT NULL,p_assigned uuid DEFAULT NULL,p_page integer DEFAULT 1,p_limit integer DEFAULT 25,p_property_list boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor_role text;total bigint;records jsonb;record public.viewing_requests;
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=p_actor FOR SHARE;actor_role:=public.bedos_viewing_actor(p_actor,'viewings.view');
 IF p_page IS NULL OR p_page<1 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_status IS NOT NULL AND p_status NOT IN('new','contacted','scheduled','completed','cancelled')) THEN RAISE EXCEPTION 'Invalid viewing query' USING ERRCODE='22023';END IF;
 IF actor_role='customer' AND (p_customer IS NOT NULL OR p_assigned IS NOT NULL OR p_property_list) THEN RAISE EXCEPTION 'Staff viewing query denied' USING ERRCODE='42501';END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO record FROM public.viewing_requests WHERE id=p_id AND property_id=p_property AND (actor_role<>'customer' OR customer_id=p_actor);
  IF NOT FOUND THEN RAISE EXCEPTION 'Viewing not found' USING ERRCODE='P0002';END IF;RETURN public.bedos_viewing_project(record);
 END IF;
 IF p_property_list AND (p_property IS NULL OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property)) THEN RAISE EXCEPTION 'Property not found' USING ERRCODE='P0002';END IF;
 SELECT count(*) INTO total FROM public.viewing_requests v WHERE (actor_role<>'customer' OR v.customer_id=p_actor) AND (p_property IS NULL OR v.property_id=p_property) AND (p_status IS NULL OR v.status=p_status) AND (p_customer IS NULL OR v.customer_id=p_customer) AND (p_assigned IS NULL OR v.assigned_to=p_assigned);
 SELECT coalesce(jsonb_agg(x.record ORDER BY x.created_at DESC,x.id DESC),'[]'::jsonb) INTO records FROM
 (SELECT id,created_at,public.bedos_viewing_project(v) record FROM public.viewing_requests v WHERE (actor_role<>'customer' OR v.customer_id=p_actor) AND (p_property IS NULL OR v.property_id=p_property) AND (p_status IS NULL OR v.status=p_status) AND (p_customer IS NULL OR v.customer_id=p_customer) AND (p_assigned IS NULL OR v.assigned_to=p_assigned) ORDER BY created_at DESC,id DESC LIMIT p_limit OFFSET (p_page::bigint-1)*p_limit) x;
 RETURN jsonb_build_object('data',records,'pagination',jsonb_build_object('page',p_page,'limit',p_limit,'total',total));
END;$function$;

CREATE FUNCTION public.bedos_mutate_viewing(p_actor uuid,p_action text,p_property uuid,p_id uuid DEFAULT NULL,p_input jsonb DEFAULT '{}'::jsonb,p_expected_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE actor_role text;old_row public.viewing_requests;next_row public.viewing_requests;normalized jsonb;new_assignee uuid;recipient uuid;events jsonb:='[]';scheduled_change boolean;status_change boolean;assignment_change boolean;
BEGIN
 actor_role:=public.bedos_viewing_actor(p_actor,'viewings.manage',p_action='delete');
 IF p_action IS NULL OR p_action NOT IN('create','update','delete') OR p_property IS NULL OR (p_action='create' AND (p_id IS NOT NULL OR p_expected_version IS NOT NULL)) OR (p_action<>'create' AND (p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1)) THEN RAISE EXCEPTION 'Invalid viewing operation' USING ERRCODE='22023';END IF;
 IF p_action='create' AND actor_role<>'customer' THEN RAISE EXCEPTION 'Only customers submit viewings' USING ERRCODE='42501';END IF;
 IF p_action='delete' THEN
  IF p_input IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'Invalid deletion input' USING ERRCODE='22023';END IF;normalized:='{}';
 ELSE normalized:=public.bedos_viewing_validate(p_input,p_action='create');END IF;
 IF p_action<>'create' THEN
  SELECT * INTO old_row FROM public.viewing_requests WHERE id=p_id AND property_id=p_property AND (actor_role<>'customer' OR customer_id=p_actor);
  IF NOT FOUND THEN RAISE EXCEPTION 'Viewing not found' USING ERRCODE='P0002';END IF;
 END IF;
 new_assignee:=CASE WHEN normalized ? 'assigned_to' THEN (normalized->>'assigned_to')::uuid ELSE old_row.assigned_to END;
 -- Same sorted profile lock order for actor, old assignee and proposed assignee. Account/role changes wait.
 PERFORM 1 FROM public.profiles WHERE id IN(p_actor,old_row.assigned_to,new_assignee) ORDER BY id FOR SHARE;
 actor_role:=public.bedos_viewing_actor(p_actor,'viewings.manage',p_action='delete');
 IF p_action='create' AND actor_role<>'customer' THEN RAISE EXCEPTION 'Only customers submit viewings' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.properties WHERE id=p_property FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Property not found' USING ERRCODE='P0002';END IF;
 IF p_action='create' THEN
  IF NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property AND status='published') THEN RAISE EXCEPTION 'Property is no longer available for this request' USING ERRCODE='P0409';END IF;
  SELECT * INTO next_row FROM jsonb_populate_record(NULL::public.viewing_requests,normalized);
  INSERT INTO public.viewing_requests(property_id,customer_id,preferred_date,preferred_time,message) VALUES(p_property,p_actor,next_row.preferred_date,next_row.preferred_time,next_row.message) RETURNING * INTO next_row;
  events:=events||jsonb_build_array(public.bedos_queue_viewing_event(p_actor,next_row,'customer_new',p_actor));
  FOR recipient IN SELECT p.id FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.account_status='active' AND r.name IN('administrator','sales_customer_service') AND EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions pm ON pm.id=rp.permission_id WHERE rp.role_id=p.role_id AND pm.name='viewings.view') ORDER BY p.id LOOP
   events:=events||jsonb_build_array(public.bedos_queue_viewing_event(p_actor,next_row,'staff_new',recipient));
  END LOOP;
 ELSE
  SELECT * INTO old_row FROM public.viewing_requests WHERE id=p_id AND property_id=p_property AND (actor_role<>'customer' OR customer_id=p_actor) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Viewing not found' USING ERRCODE='P0002';END IF;
  IF old_row.version<>p_expected_version THEN RAISE EXCEPTION 'Stale viewing request' USING ERRCODE='P0001';END IF;
  IF p_action='delete' THEN
   DELETE FROM public.viewing_requests WHERE id=p_id;
   PERFORM public.bedos_catalog_audit(p_actor,'viewing_request_deleted','viewing_request',p_id,to_jsonb(old_row),NULL);
   RETURN jsonb_build_object('record',jsonb_build_object('id',p_id),'notification_events',events);
  END IF;
  IF old_row.status IN('completed','cancelled','in_progress') THEN RAISE EXCEPTION 'Viewing is not editable' USING ERRCODE='P0001';END IF;
  IF actor_role='customer' THEN
   IF old_row.status<>'new' THEN RAISE EXCEPTION 'Customer editing has ended' USING ERRCODE='42501';END IF;
   IF normalized ? 'assigned_to' OR (normalized ? 'status' AND (normalized->>'status'<>'cancelled' OR (normalized-'status')<>'{}'::jsonb)) THEN RAISE EXCEPTION 'Customer editing denied' USING ERRCODE='42501';END IF;
  END IF;
  SELECT * INTO next_row FROM jsonb_populate_record(old_row,normalized);
  status_change:=next_row.status<>old_row.status;assignment_change:=next_row.assigned_to IS DISTINCT FROM old_row.assigned_to;
  IF status_change AND NOT (CASE old_row.status WHEN 'new' THEN next_row.status IN('contacted','cancelled') WHEN 'contacted' THEN next_row.status IN('scheduled','cancelled') WHEN 'scheduled' THEN next_row.status IN('completed','cancelled') ELSE false END) THEN RAISE EXCEPTION 'Invalid viewing transition' USING ERRCODE='P0001';END IF;
  IF (to_jsonb(next_row)-'version'-'updated_at')=(to_jsonb(old_row)-'version'-'updated_at') THEN RAISE EXCEPTION 'No viewing changes' USING ERRCODE='P0001';END IF;
  scheduled_change:=next_row.status='scheduled' AND (status_change OR assignment_change OR next_row.preferred_date IS DISTINCT FROM old_row.preferred_date OR next_row.preferred_time IS DISTINCT FROM old_row.preferred_time);
  IF scheduled_change AND (next_row.preferred_date IS NULL OR next_row.preferred_time IS NULL OR next_row.assigned_to IS NULL) THEN RAISE EXCEPTION 'Scheduled viewing requires date time and assignee' USING ERRCODE='22023';END IF;
  IF (assignment_change OR scheduled_change) AND next_row.assigned_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=next_row.assigned_to AND p.account_status='active' AND r.name IN('administrator','sales_customer_service') AND EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions pm ON pm.id=rp.permission_id WHERE rp.role_id=p.role_id AND pm.name='viewings.manage')) THEN RAISE EXCEPTION 'Assignee is not eligible' USING ERRCODE='22023';END IF;
  UPDATE public.viewing_requests SET preferred_date=next_row.preferred_date,preferred_time=next_row.preferred_time,message=next_row.message,status=next_row.status,assigned_to=next_row.assigned_to WHERE id=p_id RETURNING * INTO next_row;
  IF assignment_change AND next_row.assigned_to IS NOT NULL THEN events:=events||jsonb_build_array(public.bedos_queue_viewing_event(p_actor,next_row,'assigned',next_row.assigned_to));END IF;
  IF status_change THEN
   events:=events||jsonb_build_array(public.bedos_queue_viewing_event(p_actor,next_row,'customer_status',next_row.customer_id));
   IF next_row.assigned_to IS NOT NULL THEN events:=events||jsonb_build_array(public.bedos_queue_viewing_event(p_actor,next_row,'staff_status',next_row.assigned_to));END IF;
  END IF;
  IF scheduled_change THEN
   events:=events||jsonb_build_array(public.bedos_queue_viewing_event(p_actor,next_row,'customer_schedule',next_row.customer_id),public.bedos_queue_viewing_event(p_actor,next_row,'staff_schedule',next_row.assigned_to));
  END IF;
 END IF;
 PERFORM public.bedos_catalog_audit(p_actor,CASE WHEN p_action='create' THEN 'viewing_request_created' ELSE 'viewing_request_updated' END,'viewing_request',next_row.id,CASE WHEN p_action='create' THEN NULL ELSE to_jsonb(old_row) END,to_jsonb(next_row),jsonb_build_object('notification_event_count',jsonb_array_length(events)));
 RETURN jsonb_build_object('record',public.bedos_viewing_project(next_row),'notification_events',events);
END;$function$;

CREATE FUNCTION public.bedos_viewing_events(p_actor uuid,p_page integer DEFAULT 1,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE total bigint;records jsonb;
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=p_actor FOR SHARE;PERFORM public.bedos_viewing_actor(p_actor,'viewings.manage',true);
 IF p_page IS NULL OR p_page<1 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid event query' USING ERRCODE='22023';END IF;
 SELECT count(*) INTO total FROM public.viewing_notification_events;
 SELECT coalesce(jsonb_agg(x.record ORDER BY x.priority,x.created_at,x.id),'[]'::jsonb) INTO records FROM
 (SELECT id,created_at,CASE WHEN state IN('pending','processing') THEN 0 ELSE 1 END priority,jsonb_build_object('id',id,'viewing_id',viewing_id,'event_type',event_type,'state',state,'attempts',attempts,'version',version,'lease_until',lease_until,'created_at',created_at) record FROM public.viewing_notification_events ORDER BY priority,created_at,id LIMIT p_limit OFFSET (p_page::bigint-1)*p_limit) x;
 RETURN jsonb_build_object('events',records,'pagination',jsonb_build_object('page',p_page,'limit',p_limit,'total',total));
END;$function$;

CREATE FUNCTION public.bedos_deliver_viewing_event(p_actor uuid,p_event uuid,p_retry boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $function$
DECLARE e public.viewing_notification_events;v public.viewing_requests;actor_role text;recipient_role text;eligible boolean;obsolete boolean;notification_type text;title text;message text;failure_code text;
BEGIN
 actor_role:=public.bedos_viewing_actor(p_actor,'viewings.manage',p_retry);
 IF p_retry IS NULL THEN RAISE EXCEPTION 'Invalid retry' USING ERRCODE='22023';END IF;
 SELECT * INTO e FROM public.viewing_notification_events WHERE id=p_event;
 IF NOT FOUND THEN RAISE EXCEPTION 'Viewing event not found' USING ERRCODE='P0002';END IF;
 IF actor_role<>'administrator' AND e.created_by<>p_actor THEN RAISE EXCEPTION 'Viewing event denied' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.profiles WHERE id IN(p_actor,e.recipient_id) ORDER BY id FOR SHARE;
 actor_role:=public.bedos_viewing_actor(p_actor,'viewings.manage',p_retry);
 SELECT * INTO v FROM public.viewing_requests WHERE id=e.viewing_id FOR SHARE;
 SELECT * INTO e FROM public.viewing_notification_events WHERE id=p_event FOR UPDATE NOWAIT;
 IF e.state IN('recorded','suppressed') THEN RETURN jsonb_build_object('id',e.id,'state',e.state);END IF;
 IF e.lease_until>clock_timestamp() THEN RAISE EXCEPTION 'Viewing event cooldown' USING ERRCODE='P0001';END IF;
 IF NOT p_retry AND e.attempts>0 THEN RETURN jsonb_build_object('id',e.id,'state','pending');END IF;
 SELECT r.name INTO recipient_role FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=e.recipient_id AND p.account_status='active';
 eligible:=CASE WHEN e.event_type LIKE 'customer_%' THEN recipient_role='customer' AND v.customer_id=e.recipient_id ELSE recipient_role IN('administrator','sales_customer_service') AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.role_permissions rp ON rp.role_id=p.role_id JOIN public.permissions pm ON pm.id=rp.permission_id WHERE p.id=e.recipient_id AND pm.name='viewings.view') END;
 obsolete:=v.id IS NULL OR NOT coalesce(eligible,false);
 IF e.event_type IN('customer_new','staff_new') AND v.status IN('completed','cancelled') THEN obsolete:=true;END IF;
 IF e.event_type IN('assigned','staff_status','staff_schedule') AND v.assigned_to IS DISTINCT FROM e.recipient_id THEN obsolete:=true;END IF;
 IF e.event_type='assigned' AND v.status IN('completed','cancelled') THEN obsolete:=true;END IF;
 IF e.event_type IN('customer_status','staff_status','customer_schedule','staff_schedule') AND v.status<>e.expected_status THEN obsolete:=true;END IF;
 IF e.event_type IN('customer_schedule','staff_schedule') AND (v.status<>'scheduled' OR v.preferred_date IS DISTINCT FROM e.preferred_date OR v.preferred_time IS DISTINCT FROM e.preferred_time OR v.assigned_to IS DISTINCT FROM e.expected_assigned_to) THEN obsolete:=true;END IF;
 IF obsolete THEN
  UPDATE public.viewing_notification_events SET state='suppressed',version=version+1,lease_until=now(),updated_at=now() WHERE id=e.id;
  PERFORM public.bedos_catalog_audit(p_actor,'viewing_notification_suppressed','viewing_notification_event',e.id,NULL,jsonb_build_object('state','suppressed'));
  RETURN jsonb_build_object('id',e.id,'state','suppressed');
 END IF;
 UPDATE public.viewing_notification_events SET state='processing',attempts=attempts+1,version=version+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',updated_at=now() WHERE id=e.id;
 notification_type:=CASE WHEN e.event_type IN('customer_new','staff_new') THEN 'viewing_created' WHEN e.event_type='assigned' THEN 'viewing_assigned' WHEN e.event_type IN('customer_schedule','staff_schedule') THEN 'viewing_scheduled' ELSE 'viewing_updated' END;
 title:=CASE notification_type WHEN 'viewing_created' THEN 'Viewing request received' WHEN 'viewing_assigned' THEN 'Viewing request assigned' WHEN 'viewing_scheduled' THEN 'Viewing scheduled' ELSE 'Viewing request updated' END;
 message:=CASE WHEN e.event_type='customer_new' THEN 'Your property viewing request has been received and is awaiting processing.' WHEN e.event_type='staff_new' THEN 'A new property viewing request is awaiting processing.' WHEN e.event_type='assigned' THEN 'A property viewing request has been assigned to you.' WHEN notification_type='viewing_scheduled' THEN 'The property viewing is scheduled for '||e.preferred_date||' at '||e.preferred_time||'.' ELSE 'The property viewing request status is '||e.expected_status||'.' END;
 BEGIN
  INSERT INTO public.notifications(id,recipient_id,notification_type,title,message,channel,status,related_entity_type,related_entity_id,metadata)
  VALUES(e.notification_id,e.recipient_id,notification_type,title,message,'in_app','pending','viewing_request',e.viewing_id,jsonb_build_object('viewing_event_id',e.id,'viewing_version',e.viewing_version));
  UPDATE public.viewing_notification_events SET state='recorded',version=version+1,lease_until=now(),last_error_code=NULL,updated_at=now() WHERE id=e.id;
  PERFORM public.bedos_catalog_audit(p_actor,'viewing_notification_recorded','viewing_notification_event',e.id,NULL,jsonb_build_object('state','recorded','notification_id',e.notification_id));
  RETURN jsonb_build_object('id',e.id,'state','recorded');
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS failure_code=RETURNED_SQLSTATE;
  UPDATE public.viewing_notification_events SET state='pending',version=version+1,lease_until=clock_timestamp()+interval '30 seconds',last_error_code=failure_code,updated_at=now() WHERE id=e.id;
  PERFORM public.bedos_catalog_audit(p_actor,'viewing_notification_retry_failed','viewing_notification_event',e.id,NULL,jsonb_build_object('state','pending','code',failure_code));
  RETURN jsonb_build_object('id',e.id,'state','pending');
 END;
END;$function$;
REVOKE ALL ON FUNCTION public.bedos_viewing_actor(uuid,text,boolean),public.bedos_viewing_project(public.viewing_requests),public.bedos_viewing_validate(jsonb,boolean),public.bedos_viewing_version(),public.bedos_queue_viewing_event(uuid,public.viewing_requests,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.bedos_read_viewings(uuid,uuid,uuid,text,uuid,uuid,integer,integer,boolean),public.bedos_mutate_viewing(uuid,text,uuid,uuid,jsonb,integer),public.bedos_viewing_events(uuid,integer,integer),public.bedos_deliver_viewing_event(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_read_viewings(uuid,uuid,uuid,text,uuid,uuid,integer,integer,boolean),public.bedos_mutate_viewing(uuid,text,uuid,uuid,jsonb,integer),public.bedos_viewing_events(uuid,integer,integer),public.bedos_deliver_viewing_event(uuid,uuid,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
