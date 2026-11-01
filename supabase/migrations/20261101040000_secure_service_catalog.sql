BEGIN;

CREATE FUNCTION public.bedos_require_catalog_permission(p_actor_id uuid,p_permission text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
  PERFORM 1 FROM public.profiles WHERE id=p_actor_id AND account_status='active' FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.profiles actor JOIN public.role_permissions rp ON rp.role_id=actor.role_id
    JOIN public.permissions permission ON permission.id=rp.permission_id
    WHERE actor.id=p_actor_id AND actor.account_status='active' AND permission.name=p_permission
  ) THEN RAISE EXCEPTION 'Catalog authorization denied' USING ERRCODE='42501';END IF;
END;$function$;

CREATE FUNCTION public.bedos_validate_catalog_input(p_input jsonb,p_category boolean,p_create boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE v_key text;v_value text;v_result jsonb:=p_input;v_allowed text[];
BEGIN
  v_allowed:=CASE WHEN p_category THEN ARRAY['name','slug','description'] ELSE ARRAY['name','slug','description','category_id','status','featured'] END;
  IF p_input IS NULL OR pg_catalog.jsonb_typeof(p_input)<>'object' THEN
    RAISE EXCEPTION 'Invalid catalog input' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_input) k WHERE NOT k=ANY(v_allowed))
     OR (NOT p_create AND p_input='{}'::jsonb)
     OR (p_create AND (NOT p_input ? 'name' OR NOT p_input ? 'slug')) THEN
    RAISE EXCEPTION 'Invalid catalog fields' USING ERRCODE='22023';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['name','slug','description'] LOOP
    IF NOT p_input ? v_key THEN CONTINUE;END IF;
    IF v_key='description' AND p_input->v_key='null'::jsonb THEN CONTINUE;END IF;
    IF pg_catalog.jsonb_typeof(p_input->v_key)<>'string' THEN
      RAISE EXCEPTION 'Invalid catalog text' USING ERRCODE='22023';
    END IF;
    v_value:=pg_catalog.regexp_replace(p_input->>v_key,'^[[:space:]]+|[[:space:]]+$','','g');
    IF (v_key<>'description' AND v_value='') OR pg_catalog.char_length(v_value)>(CASE WHEN v_key='description' THEN 10000 ELSE 200 END) THEN
      RAISE EXCEPTION 'Invalid catalog text length' USING ERRCODE='22023';
    END IF;
    v_result:=pg_catalog.jsonb_set(v_result,ARRAY[v_key],CASE WHEN v_key='description' AND v_value='' THEN 'null'::jsonb ELSE pg_catalog.to_jsonb(v_value) END);
  END LOOP;
  IF p_input ? 'category_id' AND p_input->'category_id'<>'null'::jsonb AND
     (pg_catalog.jsonb_typeof(p_input->'category_id')<>'string' OR (p_input->>'category_id') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'Invalid service category ID' USING ERRCODE='22023';
  END IF;
  IF p_input ? 'featured' AND pg_catalog.jsonb_typeof(p_input->'featured')<>'boolean' THEN
    RAISE EXCEPTION 'Invalid featured flag' USING ERRCODE='22023';
  END IF;
  IF p_input ? 'status' AND (pg_catalog.jsonb_typeof(p_input->'status')<>'string' OR (p_input->>'status') NOT IN ('draft','published','archived')) THEN
    RAISE EXCEPTION 'Invalid publication status' USING ERRCODE='22023';
  END IF;
  RETURN v_result;
END;$function$;

CREATE FUNCTION public.bedos_catalog_audit(p_actor_id uuid,p_action text,p_entity text,p_id uuid,p_before jsonb,p_after jsonb,p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SET search_path=''
AS $function$
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,description,metadata)
  VALUES(p_actor_id,p_action,p_entity,p_id,'Authorized catalog operation.',
    pg_catalog.jsonb_build_object('before',p_before,'after',p_after,'result','success')||p_extra);
$function$;

CREATE FUNCTION public.bedos_mutate_service(p_actor_id uuid,p_action text,p_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_input jsonb;v_before public.services%ROWTYPE;v_after public.services%ROWTYPE;v_category uuid;v_enquiry uuid;
BEGIN
  PERFORM public.bedos_require_catalog_permission(p_actor_id,'services.manage');
  IF p_action IS NULL OR p_action NOT IN ('create','update','delete') OR
    (p_action='create' AND p_id IS NOT NULL) OR (p_action<>'create' AND p_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid catalog operation' USING ERRCODE='22023';
  END IF;
  IF p_action='delete' THEN
    IF p_input IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'Invalid deletion input' USING ERRCODE='22023';END IF;
  ELSE
    v_input:=public.bedos_validate_catalog_input(p_input,false,p_action='create');
  END IF;
  -- Category precedes service in the lock order, matching category deletion.
  IF v_input ? 'category_id' AND v_input->'category_id'<>'null'::jsonb THEN
    v_category:=(v_input->>'category_id')::uuid;
    PERFORM 1 FROM public.service_categories WHERE id=v_category FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid service category' USING ERRCODE='22023';END IF;
  END IF;
  IF p_action<>'create' THEN
    SELECT * INTO v_before FROM public.services WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service not found' USING ERRCODE='P0002';END IF;
  END IF;
  IF p_action='create' THEN
    INSERT INTO public.services(category_id,name,slug,description,status,featured,created_by)
    VALUES(v_category,v_input->>'name',v_input->>'slug',v_input->>'description',COALESCE(v_input->>'status','draft'),COALESCE((v_input->>'featured')::boolean,false),p_actor_id)
    RETURNING * INTO v_after;
  ELSIF p_action='update' THEN
    UPDATE public.services SET
      category_id=CASE WHEN v_input ? 'category_id' THEN v_category ELSE v_before.category_id END,
      name=CASE WHEN v_input ? 'name' THEN v_input->>'name' ELSE v_before.name END,
      slug=CASE WHEN v_input ? 'slug' THEN v_input->>'slug' ELSE v_before.slug END,
      description=CASE WHEN v_input ? 'description' THEN v_input->>'description' ELSE v_before.description END,
      status=CASE WHEN v_input ? 'status' THEN v_input->>'status' ELSE v_before.status END,
      featured=CASE WHEN v_input ? 'featured' THEN (v_input->>'featured')::boolean ELSE v_before.featured END
    WHERE id=p_id RETURNING * INTO v_after;
  ELSE
    -- Preserve ON DELETE SET NULL and audit each affected reference atomically.
    FOR v_enquiry IN SELECT id FROM public.enquiries WHERE service_id=p_id ORDER BY id FOR UPDATE LOOP
      UPDATE public.enquiries SET service_id=NULL WHERE id=v_enquiry;
      PERFORM public.bedos_catalog_audit(p_actor_id,'enquiry_service_detached','enquiry',v_enquiry,
        pg_catalog.jsonb_build_object('service_id',p_id),pg_catalog.jsonb_build_object('service_id',NULL));
    END LOOP;
    DELETE FROM public.services WHERE id=p_id;
    PERFORM public.bedos_catalog_audit(p_actor_id,'service_deleted','service',p_id,pg_catalog.to_jsonb(v_before),NULL);
    RETURN pg_catalog.jsonb_build_object('id',p_id);
  END IF;
  PERFORM public.bedos_catalog_audit(p_actor_id,CASE WHEN p_action='create' THEN 'service_created' ELSE 'service_updated' END,
    'service',v_after.id,CASE WHEN p_action='create' THEN NULL ELSE pg_catalog.to_jsonb(v_before) END,pg_catalog.to_jsonb(v_after));
  RETURN pg_catalog.to_jsonb(v_after);
END;$function$;

CREATE FUNCTION public.bedos_mutate_service_category(p_actor_id uuid,p_action text,p_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_input jsonb;v_before public.service_categories%ROWTYPE;v_after public.service_categories%ROWTYPE;
v_service public.services%ROWTYPE;v_service_after public.services%ROWTYPE;
BEGIN
  PERFORM public.bedos_require_catalog_permission(p_actor_id,'services.manage');
  IF p_action IS NULL OR p_action NOT IN ('create','update','delete') OR
    (p_action='create' AND p_id IS NOT NULL) OR (p_action<>'create' AND p_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid catalog operation' USING ERRCODE='22023';
  END IF;
  IF p_action='delete' THEN
    IF p_input IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'Invalid deletion input' USING ERRCODE='22023';END IF;
  ELSE
    v_input:=public.bedos_validate_catalog_input(p_input,true,p_action='create');
  END IF;
  IF p_action<>'create' THEN
    SELECT * INTO v_before FROM public.service_categories WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Service category not found' USING ERRCODE='P0002';END IF;
  END IF;
  IF p_action='create' THEN
    INSERT INTO public.service_categories(name,slug,description)
    VALUES(v_input->>'name',v_input->>'slug',v_input->>'description') RETURNING * INTO v_after;
  ELSIF p_action='update' THEN
    UPDATE public.service_categories SET
      name=CASE WHEN v_input ? 'name' THEN v_input->>'name' ELSE v_before.name END,
      slug=CASE WHEN v_input ? 'slug' THEN v_input->>'slug' ELSE v_before.slug END,
      description=CASE WHEN v_input ? 'description' THEN v_input->>'description' ELSE v_before.description END
    WHERE id=p_id RETURNING * INTO v_after;
  ELSE
    FOR v_service IN SELECT * FROM public.services WHERE category_id=p_id ORDER BY id FOR UPDATE LOOP
      UPDATE public.services SET category_id=NULL WHERE id=v_service.id RETURNING * INTO v_service_after;
      PERFORM public.bedos_catalog_audit(p_actor_id,'service_category_detached','service',v_service.id,
        pg_catalog.to_jsonb(v_service),pg_catalog.to_jsonb(v_service_after));
    END LOOP;
    DELETE FROM public.service_categories WHERE id=p_id;
    PERFORM public.bedos_catalog_audit(p_actor_id,'service_category_deleted','service_category',p_id,pg_catalog.to_jsonb(v_before),NULL);
    RETURN pg_catalog.jsonb_build_object('id',p_id);
  END IF;
  PERFORM public.bedos_catalog_audit(p_actor_id,CASE WHEN p_action='create' THEN 'service_category_created' ELSE 'service_category_updated' END,
    'service_category',v_after.id,CASE WHEN p_action='create' THEN NULL ELSE pg_catalog.to_jsonb(v_before) END,pg_catalog.to_jsonb(v_after));
  RETURN pg_catalog.to_jsonb(v_after);
END;$function$;

CREATE FUNCTION public.bedos_read_service_catalog(
 p_actor_id uuid DEFAULT NULL,p_public boolean DEFAULT false,p_entity text DEFAULT 'services',
 p_id uuid DEFAULT NULL,p_slug text DEFAULT NULL,p_page integer DEFAULT 1,p_page_size integer DEFAULT 25,
 p_category_id uuid DEFAULT NULL,p_featured boolean DEFAULT NULL,p_status text DEFAULT NULL,p_q text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_result jsonb;v_role text;v_q text:=pg_catalog.regexp_replace(p_q,'^[[:space:]]+|[[:space:]]+$','','g');
BEGIN
  IF p_public IS NOT TRUE THEN PERFORM public.bedos_require_catalog_permission(p_actor_id,'services.view');
  ELSIF p_actor_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid public actor' USING ERRCODE='22023';END IF;
  IF NOT p_public THEN
    SELECT r.name INTO v_role FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=p_actor_id;
  END IF;
  IF p_public IS NULL OR p_entity IS NULL OR p_entity NOT IN ('services','categories') OR p_page IS NULL OR p_page<1 OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>100
    OR pg_catalog.char_length(v_q)>100 OR (p_status IS NOT NULL AND p_status NOT IN ('draft','published','archived'))
    OR (p_public AND (p_status IS NOT NULL OR p_id IS NOT NULL))
    OR (p_entity='categories' AND (p_slug IS NOT NULL OR p_category_id IS NOT NULL OR p_featured IS NOT NULL OR p_status IS NOT NULL))
    OR (p_slug IS NOT NULL AND (NOT p_public OR p_slug='' OR p_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Invalid catalog query' USING ERRCODE='22023';
  END IF;
  IF p_entity='services' THEN
    WITH matching AS MATERIALIZED (
      SELECT s.id,s.category_id,s.name,s.slug,s.description,s.status,s.featured,s.created_by,s.created_at,s.updated_at
      -- Mirror existing read RLS. A customer already has services.view, but that
      -- permission alone must never turn a privileged query into draft access.
      FROM public.services s WHERE (CASE WHEN p_public THEN s.status='published'
        ELSE v_role IN ('administrator','content_manager') OR (v_role='customer' AND s.status='published') END)
      AND (p_id IS NULL OR s.id=p_id) AND (p_slug IS NULL OR s.slug=p_slug)
      AND (p_category_id IS NULL OR s.category_id=p_category_id) AND (p_featured IS NULL OR s.featured=p_featured)
      AND (p_status IS NULL OR s.status=p_status)
      AND (v_q IS NULL OR pg_catalog.strpos(pg_catalog.lower(pg_catalog.concat_ws(' ',s.name,s.slug,s.description)),pg_catalog.lower(v_q))>0)
    ), projected AS (
      SELECT m.created_at,m.id,CASE WHEN p_public THEN
        pg_catalog.jsonb_build_object('id',m.id,'category_id',m.category_id,'name',m.name,'slug',m.slug,'description',m.description,'featured',m.featured)
      ELSE pg_catalog.to_jsonb(m) END AS record FROM matching m
      ORDER BY m.created_at DESC,m.id DESC LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
    ) SELECT CASE WHEN p_id IS NOT NULL OR p_slug IS NOT NULL THEN (SELECT record FROM projected LIMIT 1)
      ELSE pg_catalog.jsonb_build_object('services',COALESCE((SELECT pg_catalog.jsonb_agg(record ORDER BY created_at DESC,id DESC) FROM projected),'[]'::jsonb),
        'pagination',pg_catalog.jsonb_build_object('page',p_page,'page_size',p_page_size,'total',(SELECT count(*) FROM matching))) END INTO v_result;
  ELSE
    WITH matching AS MATERIALIZED (
      SELECT c.id,c.name,c.slug,c.description,c.created_at,c.updated_at FROM public.service_categories c
      WHERE (p_id IS NULL OR c.id=p_id) AND (CASE WHEN p_public THEN
        EXISTS(SELECT 1 FROM public.services s WHERE s.category_id=c.id AND s.status='published')
        ELSE v_role IN ('administrator','content_manager','customer') END)
      AND (v_q IS NULL OR pg_catalog.strpos(pg_catalog.lower(pg_catalog.concat_ws(' ',c.name,c.slug,c.description)),pg_catalog.lower(v_q))>0)
    ), projected AS (
      SELECT m.name,m.id,CASE WHEN p_public THEN
        pg_catalog.jsonb_build_object('id',m.id,'name',m.name,'slug',m.slug,'description',m.description)
      ELSE pg_catalog.to_jsonb(m) END AS record FROM matching m
      ORDER BY m.name,m.id LIMIT p_page_size OFFSET (p_page::bigint-1)*p_page_size
    ) SELECT CASE WHEN p_id IS NOT NULL THEN (SELECT record FROM projected LIMIT 1)
      ELSE pg_catalog.jsonb_build_object('categories',COALESCE((SELECT pg_catalog.jsonb_agg(record ORDER BY name,id) FROM projected),'[]'::jsonb),
        'pagination',pg_catalog.jsonb_build_object('page',p_page,'page_size',p_page_size,'total',(SELECT count(*) FROM matching))) END INTO v_result;
  END IF;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Catalog record not found' USING ERRCODE='P0002';END IF;
  RETURN v_result;
END;$function$;

REVOKE ALL ON FUNCTION public.bedos_require_catalog_permission(uuid,text),public.bedos_validate_catalog_input(jsonb,boolean,boolean),public.bedos_catalog_audit(uuid,text,text,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.bedos_mutate_service(uuid,text,uuid,jsonb),public.bedos_mutate_service_category(uuid,text,uuid,jsonb),public.bedos_read_service_catalog(uuid,boolean,text,uuid,text,integer,integer,uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_mutate_service(uuid,text,uuid,jsonb),public.bedos_mutate_service_category(uuid,text,uuid,jsonb),public.bedos_read_service_catalog(uuid,boolean,text,uuid,text,integer,integer,uuid,boolean,text,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
