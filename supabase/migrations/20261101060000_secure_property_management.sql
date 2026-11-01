BEGIN;

-- Refuse a silent reinterpretation of legacy data, including changes since preflight.
LOCK TABLE public.properties IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.properties WHERE status NOT IN ('draft','published','reserved','sold','unavailable','archived')) THEN
    RAISE EXCEPTION 'Legacy property statuses require explicit review';
  END IF;
END;$guard$;
ALTER TABLE public.properties DROP CONSTRAINT properties_status_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_status_check CHECK (status IN ('draft','published','reserved','sold','unavailable','archived'));

CREATE FUNCTION public.bedos_validate_property_input(p_input jsonb,p_create boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE k text; v jsonb; s text; n numeric; result jsonb:=p_input;
BEGIN
  IF p_input IS NULL OR pg_catalog.jsonb_typeof(p_input)<>'object' OR p_input='{}'::jsonb OR
     EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_input) key WHERE key NOT IN
      ('title','slug','description','property_type','listing_type','price','currency','location','address','city','region','bedrooms','bathrooms','floor_area','land_area','featured')) OR
     (p_create AND NOT p_input ?& ARRAY['title','slug','property_type','listing_type']) THEN
    RAISE EXCEPTION 'Invalid property fields' USING ERRCODE='22023';
  END IF;
  FOR k,v IN SELECT * FROM pg_catalog.jsonb_each(p_input) LOOP
    IF k='featured' THEN
      IF pg_catalog.jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'Invalid featured' USING ERRCODE='22023';END IF;
    ELSIF k IN ('price','bedrooms','bathrooms','floor_area','land_area') THEN
      IF v='null'::jsonb THEN CONTINUE;END IF;
      IF pg_catalog.jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'Invalid numeric value' USING ERRCODE='22023';END IF;
      n:=(p_input->>k)::numeric;
      IF n<0 OR n>(CASE WHEN k='price' THEN 999999999999.99 WHEN k IN ('floor_area','land_area') THEN 9999999999.99 ELSE 2147483647 END) OR
         (k IN ('bedrooms','bathrooms') AND n<>pg_catalog.trunc(n)) OR
         (k IN ('price','floor_area','land_area') AND n<>pg_catalog.round(n,2)) THEN
        RAISE EXCEPTION 'Invalid numeric range or precision' USING ERRCODE='22023';
      END IF;
    ELSE
      IF v='null'::jsonb AND k IN ('description','location','address','city','region') THEN CONTINUE;END IF;
      IF pg_catalog.jsonb_typeof(v)<>'string' THEN RAISE EXCEPTION 'Invalid text' USING ERRCODE='22023';END IF;
      s:=pg_catalog.regexp_replace(p_input->>k,'^[[:space:]]+|[[:space:]]+$','','g');
      IF pg_catalog.char_length(s)>(CASE WHEN k='description' THEN 10000 WHEN k='address' THEN 1000 ELSE 200 END) OR
        (s='' AND k IN ('title','slug','property_type','listing_type','currency')) OR
        (k='slug' AND s !~ '^[a-z0-9]+(-[a-z0-9]+)*$') OR (k='currency' AND s !~ '^[A-Z]{3}$') THEN
        RAISE EXCEPTION 'Invalid property text' USING ERRCODE='22023';
      END IF;
      result:=pg_catalog.jsonb_set(result,ARRAY[k],CASE WHEN s='' THEN 'null'::jsonb ELSE pg_catalog.to_jsonb(s) END);
    END IF;
  END LOOP;
  RETURN result;
END;$function$;

CREATE FUNCTION public.bedos_validate_property_filters(p_filters jsonb,p_staff boolean)
RETURNS void LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE k text; v jsonb; n numeric;
BEGIN
  IF p_filters IS NULL OR pg_catalog.jsonb_typeof(p_filters)<>'object' THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  FOR k,v IN SELECT * FROM pg_catalog.jsonb_each(p_filters) LOOP
    IF k NOT IN ('page','limit','search','property_type','listing_type','city','region','featured','status','min_price','max_price','min_bedrooms','max_bedrooms','min_bathrooms','max_bathrooms') OR
      (k='status' AND NOT p_staff) THEN RAISE EXCEPTION 'Invalid filter field' USING ERRCODE='22023';END IF;
    IF k IN ('page','limit','min_price','max_price','min_bedrooms','max_bedrooms','min_bathrooms','max_bathrooms') THEN
      IF pg_catalog.jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'Invalid filter number' USING ERRCODE='22023';END IF;
      n:=(p_filters->>k)::numeric;
      IF n<(CASE WHEN k IN ('page','limit') THEN 1 ELSE 0 END) OR n>(CASE WHEN k='limit' THEN 100 WHEN k IN ('min_price','max_price') THEN 9007199254740991 ELSE 2147483647 END) OR
        (k NOT IN ('min_price','max_price') AND n<>pg_catalog.trunc(n)) THEN RAISE EXCEPTION 'Invalid filter range' USING ERRCODE='22023';END IF;
    ELSIF k='featured' THEN
      IF pg_catalog.jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'Invalid featured' USING ERRCODE='22023';END IF;
    ELSE
      IF pg_catalog.jsonb_typeof(v)<>'string' OR pg_catalog.btrim(p_filters->>k)='' OR
        pg_catalog.char_length(p_filters->>k)>(CASE WHEN k='search' THEN 100 ELSE 200 END) OR
        (k='status' AND p_filters->>k NOT IN ('draft','published','reserved','sold','unavailable','archived')) THEN
        RAISE EXCEPTION 'Invalid filter text' USING ERRCODE='22023';
      END IF;
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['price','bedrooms','bathrooms'] LOOP
    IF (p_filters->>('min_'||k))::numeric > (p_filters->>('max_'||k))::numeric THEN RAISE EXCEPTION 'Invalid filter range' USING ERRCODE='22023';END IF;
  END LOOP;
END;$function$;

CREATE FUNCTION public.bedos_read_properties(p_actor_id uuid DEFAULT NULL,p_id uuid DEFAULT NULL,p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE staff boolean:=p_actor_id IS NOT NULL; result jsonb; page integer; lim integer;
BEGIN
  IF staff THEN
    PERFORM public.bedos_require_catalog_permission(p_actor_id,'properties.manage');
    IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=p_actor_id AND r.name IN ('administrator','content_manager')) THEN
      RAISE EXCEPTION 'Property preview denied' USING ERRCODE='42501';
    END IF;
  END IF;
  PERFORM public.bedos_validate_property_filters(p_filters,staff);
  page:=COALESCE((p_filters->>'page')::integer,1);lim:=COALESCE((p_filters->>'limit')::integer,12);
  WITH matching AS MATERIALIZED (
    SELECT p.* FROM public.properties p WHERE (p_id IS NULL OR p.id=p_id)
      AND (staff OR p.status='published')
      AND (NOT p_filters ? 'status' OR p.status=p_filters->>'status')
      AND (NOT p_filters ? 'property_type' OR p.property_type=p_filters->>'property_type')
      AND (NOT p_filters ? 'listing_type' OR p.listing_type=p_filters->>'listing_type')
      AND (NOT p_filters ? 'city' OR p.city=p_filters->>'city')
      AND (NOT p_filters ? 'region' OR p.region=p_filters->>'region')
      AND (NOT p_filters ? 'featured' OR p.featured=(p_filters->>'featured')::boolean)
      AND (NOT p_filters ? 'min_price' OR p.price>=(p_filters->>'min_price')::numeric)
      AND (NOT p_filters ? 'max_price' OR p.price<=(p_filters->>'max_price')::numeric)
      AND (NOT p_filters ? 'min_bedrooms' OR p.bedrooms>=(p_filters->>'min_bedrooms')::integer)
      AND (NOT p_filters ? 'max_bedrooms' OR p.bedrooms<=(p_filters->>'max_bedrooms')::integer)
      AND (NOT p_filters ? 'min_bathrooms' OR p.bathrooms>=(p_filters->>'min_bathrooms')::integer)
      AND (NOT p_filters ? 'max_bathrooms' OR p.bathrooms<=(p_filters->>'max_bathrooms')::integer)
      AND (NOT p_filters ? 'search' OR pg_catalog.strpos(pg_catalog.lower(pg_catalog.concat_ws(' ',p.title,p.location,p.city)),pg_catalog.lower(p_filters->>'search'))>0)
  ), projected AS (
    SELECT m.id,m.created_at,m.featured,CASE WHEN staff THEN pg_catalog.to_jsonb(m) ELSE pg_catalog.jsonb_build_object('id',m.id,'title',m.title,'slug',m.slug,'description',m.description,'property_type',m.property_type,'listing_type',m.listing_type,'price',m.price,'currency',m.currency,'location',m.location,'address',m.address,'city',m.city,'region',m.region,'bedrooms',m.bedrooms,'bathrooms',m.bathrooms,'floor_area',m.floor_area,'land_area',m.land_area,'status',m.status,'featured',m.featured,'created_at',m.created_at,'updated_at',m.updated_at) END record
    FROM matching m ORDER BY m.featured DESC,m.created_at DESC,m.id DESC LIMIT lim OFFSET (page::bigint-1)*lim
  ) SELECT CASE WHEN p_id IS NOT NULL THEN (SELECT record FROM projected LIMIT 1) ELSE
    pg_catalog.jsonb_build_object('properties',COALESCE((SELECT pg_catalog.jsonb_agg(record ORDER BY featured DESC,created_at DESC,id DESC) FROM projected),'[]'::jsonb),
      'pagination',pg_catalog.jsonb_build_object('page',page,'limit',lim,'total',(SELECT count(*) FROM matching),'total_pages',pg_catalog.ceil((SELECT count(*) FROM matching)::numeric/lim))) END INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'Property not found' USING ERRCODE='P0002';END IF;
  RETURN result;
END;$function$;

CREATE FUNCTION public.bedos_mutate_property(p_actor_id uuid,p_action text,p_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE v_input jsonb; before_row public.properties%ROWTYPE; after_row public.properties%ROWTYPE;
  actor_role text; target_status text; reason text; enquiry_id uuid; related jsonb;
BEGIN
  PERFORM public.bedos_require_catalog_permission(p_actor_id,'properties.manage');
  SELECT r.name INTO actor_role FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=p_actor_id;
  IF actor_role NOT IN ('administrator','content_manager') OR (p_action='delete' AND actor_role<>'administrator') THEN
    RAISE EXCEPTION 'Property mutation denied' USING ERRCODE='42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('create','update','status','delete') OR
    (p_action='create' AND p_id IS NOT NULL) OR (p_action<>'create' AND p_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid property operation' USING ERRCODE='22023';
  END IF;
  IF p_action IN ('create','update') THEN
    v_input:=public.bedos_validate_property_input(p_input,p_action='create');
  ELSIF p_action='delete' THEN
    IF p_input IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'Invalid deletion input' USING ERRCODE='22023';END IF;
  ELSE
    IF p_input IS NULL OR pg_catalog.jsonb_typeof(p_input)<>'object' OR NOT p_input ?& ARRAY['status','expected_status','reason'] OR
      EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_input) k WHERE k NOT IN ('status','expected_status','reason')) OR
      pg_catalog.jsonb_typeof(p_input->'status')<>'string' OR pg_catalog.jsonb_typeof(p_input->'expected_status')<>'string' OR
      pg_catalog.jsonb_typeof(p_input->'reason')<>'string' OR
      p_input->>'status' NOT IN ('draft','published','reserved','sold','unavailable','archived') OR
      p_input->>'expected_status' NOT IN ('draft','published','reserved','sold','unavailable','archived') THEN
      RAISE EXCEPTION 'Invalid status input' USING ERRCODE='22023';
    END IF;
    reason:=pg_catalog.regexp_replace(p_input->>'reason','^[[:space:]]+|[[:space:]]+$','','g');
    IF reason='' OR pg_catalog.char_length(reason)>1000 THEN RAISE EXCEPTION 'Invalid reason' USING ERRCODE='22023';END IF;
    target_status:=p_input->>'status';
  END IF;
  IF p_action<>'create' THEN
    -- FOR UPDATE also conflicts with FK insert locks, protecting deletion checks.
    SELECT * INTO before_row FROM public.properties WHERE id=p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Property not found' USING ERRCODE='P0002';END IF;
  END IF;
  IF p_action='create' THEN
    v_input:=pg_catalog.jsonb_build_object('id',pg_catalog.gen_random_uuid(),'created_by',p_actor_id,'status','draft','currency','GHS','featured',false,'created_at',pg_catalog.now(),'updated_at',pg_catalog.now())||v_input;
    SELECT * INTO after_row FROM pg_catalog.jsonb_populate_record(NULL::public.properties,v_input);
    INSERT INTO public.properties SELECT (after_row).* RETURNING * INTO after_row;
  ELSIF p_action='update' THEN
    SELECT * INTO after_row FROM pg_catalog.jsonb_populate_record(before_row,v_input);
    UPDATE public.properties SET title=after_row.title,slug=after_row.slug,description=after_row.description,
      property_type=after_row.property_type,listing_type=after_row.listing_type,price=after_row.price,currency=after_row.currency,
      location=after_row.location,address=after_row.address,city=after_row.city,region=after_row.region,bedrooms=after_row.bedrooms,
      bathrooms=after_row.bathrooms,floor_area=after_row.floor_area,land_area=after_row.land_area,featured=after_row.featured
      WHERE id=p_id RETURNING * INTO after_row;
  ELSIF p_action='status' THEN
    IF before_row.status<>p_input->>'expected_status' OR NOT (CASE before_row.status
      WHEN 'draft' THEN target_status IN ('published','archived')
      WHEN 'published' THEN target_status IN ('draft','reserved','sold','unavailable','archived')
      WHEN 'reserved' THEN target_status IN ('published','sold','unavailable','archived')
      WHEN 'unavailable' THEN target_status IN ('published','archived')
      WHEN 'sold' THEN target_status='archived'
      WHEN 'archived' THEN target_status='draft' ELSE false END) THEN
      RAISE EXCEPTION 'Stale or unsupported lifecycle transition' USING ERRCODE='P0001';
    END IF;
    UPDATE public.properties SET status=target_status WHERE id=p_id RETURNING * INTO after_row;
  ELSE
    IF EXISTS(SELECT 1 FROM public.viewing_requests WHERE property_id=p_id) OR
       EXISTS(SELECT 1 FROM public.property_images WHERE property_id=p_id) OR
       EXISTS(SELECT 1 FROM public.property_floor_plans WHERE property_id=p_id) THEN
      RAISE EXCEPTION 'Property has protected dependencies' USING ERRCODE='P0001';
    END IF;
    -- Preserve metadata cascades and SET NULL references with atomic audit evidence.
    PERFORM 1 FROM public.property_features WHERE property_id=p_id ORDER BY id FOR UPDATE;
    PERFORM 1 FROM public.property_amenities WHERE property_id=p_id ORDER BY id FOR UPDATE;
    SELECT pg_catalog.jsonb_build_object('features',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f) ORDER BY f.id) FROM public.property_features f WHERE f.property_id=p_id),'[]'::jsonb),
      'amenities',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.id) FROM public.property_amenities a WHERE a.property_id=p_id),'[]'::jsonb)) INTO related;
    FOR enquiry_id IN SELECT id FROM public.enquiries WHERE property_id=p_id ORDER BY id FOR UPDATE LOOP
      UPDATE public.enquiries SET property_id=NULL WHERE id=enquiry_id;
      PERFORM public.bedos_catalog_audit(p_actor_id,'enquiry_property_detached','enquiry',enquiry_id,
        pg_catalog.jsonb_build_object('property_id',p_id),pg_catalog.jsonb_build_object('property_id',NULL));
    END LOOP;
    DELETE FROM public.properties WHERE id=p_id;
    PERFORM public.bedos_catalog_audit(p_actor_id,'property_deleted','property',p_id,pg_catalog.to_jsonb(before_row),NULL,pg_catalog.jsonb_build_object('deleted_metadata',related));
    RETURN pg_catalog.jsonb_build_object('id',p_id);
  END IF;
  PERFORM public.bedos_catalog_audit(p_actor_id,CASE p_action WHEN 'create' THEN 'property_created' WHEN 'status' THEN 'property_status_changed' ELSE 'property_updated' END,
    'property',after_row.id,CASE WHEN p_action='create' THEN NULL ELSE pg_catalog.to_jsonb(before_row) END,pg_catalog.to_jsonb(after_row),
    CASE WHEN p_action='status' THEN pg_catalog.jsonb_build_object('reason',reason) ELSE '{}'::jsonb END);
  RETURN pg_catalog.to_jsonb(after_row);
END;$function$;

REVOKE ALL ON FUNCTION public.bedos_validate_property_input(jsonb,boolean),public.bedos_validate_property_filters(jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.bedos_read_properties(uuid,uuid,jsonb),public.bedos_mutate_property(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_read_properties(uuid,uuid,jsonb),public.bedos_mutate_property(uuid,text,uuid,jsonb) TO service_role;

-- Approved compatibility guard: only new or changed property references are checked.
-- FOR SHARE conflicts with lifecycle updates and is held until the reference commits.
CREATE FUNCTION public.bedos_guard_property_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE publication text;
BEGIN
  IF NEW.property_id IS NULL THEN RETURN NEW;END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.property_id IS NOT DISTINCT FROM OLD.property_id THEN RETURN NEW;END IF;
  END IF;
  SELECT status INTO publication FROM public.properties WHERE id=NEW.property_id FOR SHARE;
  IF NOT FOUND OR publication<>'published' THEN
    RAISE EXCEPTION 'Property is no longer available for this request' USING ERRCODE='P0409';
  END IF;
  RETURN NEW;
END;$function$;
REVOKE ALL ON FUNCTION public.bedos_guard_property_reference() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER viewing_property_publication_guard BEFORE INSERT OR UPDATE OF property_id ON public.viewing_requests
FOR EACH ROW EXECUTE FUNCTION public.bedos_guard_property_reference();
CREATE TRIGGER enquiry_property_publication_guard BEFORE INSERT OR UPDATE OF property_id ON public.enquiries
FOR EACH ROW EXECUTE FUNCTION public.bedos_guard_property_reference();
NOTIFY pgrst,'reload schema';
COMMIT;
