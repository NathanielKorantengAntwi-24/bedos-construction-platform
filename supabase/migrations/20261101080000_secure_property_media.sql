BEGIN;
LOCK TABLE public.property_images,public.property_floor_plans IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
  IF (SELECT count(*) FROM storage.buckets WHERE id IN ('property-images','property-floor-plans') AND NOT public)<>2 THEN
    RAISE EXCEPTION 'Expected private property buckets before media installation';
  END IF;
  IF EXISTS(SELECT 1 FROM public.property_images) OR EXISTS(SELECT 1 FROM public.property_floor_plans) OR
     EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id IN ('property-images','property-floor-plans')) THEN
    RAISE EXCEPTION 'Existing media requires an explicit provenance migration';
  END IF;
END;$guard$;
ALTER TABLE public.property_images ADD CONSTRAINT property_images_order_check CHECK(display_order>=0);
ALTER TABLE public.property_floor_plans ADD CONSTRAINT property_floor_plans_order_check CHECK(display_order>=0);
CREATE UNIQUE INDEX property_images_one_primary_idx ON public.property_images(property_id) WHERE is_primary;

CREATE TABLE public.property_media_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
 bound_property_id uuid NOT NULL,actor_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('images','floor_plans')),
 media_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),idempotency_key uuid NOT NULL,
 bucket_id text NOT NULL,storage_path text NOT NULL,
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
 file_size integer NOT NULL CHECK(file_size BETWEEN 1 AND 3145728),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 input jsonb NOT NULL,state text NOT NULL DEFAULT 'upload_pending' CHECK(state IN ('upload_pending','ready','cleanup_pending','deleted')),
 version integer NOT NULL DEFAULT 1,lease_token uuid NOT NULL DEFAULT gen_random_uuid(),lease_until timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,idempotency_key),UNIQUE(bucket_id,storage_path),
 CHECK((kind='images' AND bucket_id='property-images') OR (kind='floor_plans' AND bucket_id='property-floor-plans'))
);
ALTER TABLE public.property_media_operations ENABLE ROW LEVEL SECURITY;
CREATE INDEX property_media_operation_property_idx ON public.property_media_operations(bound_property_id,state);
CREATE INDEX property_media_operation_actor_idx ON public.property_media_operations(actor_id,created_at);
CREATE INDEX property_media_operation_queue_idx ON public.property_media_operations((CASE WHEN state IN ('upload_pending','cleanup_pending') THEN 0 ELSE 1 END),created_at,id);

CREATE FUNCTION public.bedos_media_actor(p_actor uuid,p_delete boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 PERFORM 1 FROM public.profiles WHERE id=p_actor FOR UPDATE;
 PERFORM public.bedos_require_catalog_permission(p_actor,'properties.manage');
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=p_actor AND r.name=ANY(CASE WHEN p_delete THEN ARRAY['administrator'] ELSE ARRAY['administrator','content_manager'] END)) THEN
  RAISE EXCEPTION 'Media authorization denied' USING ERRCODE='42501';
 END IF;
END;$function$;

CREATE FUNCTION public.bedos_media_validate(p_kind text,p_input jsonb,p_create boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path=''
AS $function$
DECLARE k text;v jsonb;s text;allowed text[];result jsonb:=p_input;
BEGIN
 allowed:=CASE p_kind WHEN 'images' THEN ARRAY['alt_text','display_order','is_primary'] WHEN 'floor_plans' THEN ARRAY['title','description','display_order'] WHEN 'features' THEN ARRAY['name','value'] WHEN 'amenities' THEN ARRAY['name'] END;
 IF allowed IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR (NOT p_create AND p_input='{}'::jsonb) OR
 EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) key WHERE NOT key=ANY(allowed)) OR (p_create AND p_kind IN ('features','amenities') AND NOT p_input ? 'name') THEN RAISE EXCEPTION 'Invalid media fields' USING ERRCODE='22023';END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_input) LOOP
  IF k='display_order' THEN
   IF jsonb_typeof(v)<>'number' OR (v::text)::numeric<0 OR (v::text)::numeric>2147483647 OR (v::text)::numeric<>trunc((v::text)::numeric) THEN RAISE EXCEPTION 'Invalid order' USING ERRCODE='22023';END IF;
  ELSIF k='is_primary' THEN
   IF jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'Invalid primary' USING ERRCODE='22023';END IF;
  ELSE
   IF v='null'::jsonb AND k<>'name' THEN CONTINUE;END IF;
   IF jsonb_typeof(v)<>'string' THEN RAISE EXCEPTION 'Invalid text' USING ERRCODE='22023';END IF;
   s:=regexp_replace(p_input->>k,'^[[:space:]]+|[[:space:]]+$','','g');
   IF (k='name' AND s='') OR char_length(s)>(CASE WHEN k='description' THEN 10000 WHEN k IN ('name','title') THEN 200 ELSE 1000 END) THEN RAISE EXCEPTION 'Invalid text length' USING ERRCODE='22023';END IF;
   result:=jsonb_set(result,ARRAY[k],CASE WHEN s='' THEN 'null'::jsonb ELSE to_jsonb(s) END);
  END IF;
 END LOOP;RETURN result;
END;$function$;

CREATE FUNCTION public.bedos_media_parent(p_actor uuid,p_property uuid,p_write boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 IF p_actor IS NOT NULL THEN PERFORM public.bedos_media_actor(p_actor);END IF;
 IF p_write THEN
  PERFORM 1 FROM public.properties WHERE id=p_property FOR UPDATE;
 ELSE
  PERFORM 1 FROM public.properties WHERE id=p_property AND (p_actor IS NOT NULL OR status='published');
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Property not found' USING ERRCODE='P0002';END IF;
END;$function$;

CREATE FUNCTION public.bedos_media_read(p_actor uuid,p_property uuid,p_kind text,p_id uuid DEFAULT NULL,p_page integer DEFAULT 1,p_limit integer DEFAULT 25,p_file boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE tab text;ordering text;projection text;result jsonb;total bigint;rows jsonb;
BEGIN
 PERFORM public.bedos_media_parent(p_actor,p_property);
 IF p_kind IS NULL OR p_kind NOT IN ('images','floor_plans','features','amenities') OR p_page IS NULL OR p_page<1 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_file AND (p_id IS NULL OR p_kind NOT IN ('images','floor_plans'))) THEN RAISE EXCEPTION 'Invalid media read' USING ERRCODE='22023';END IF;
 tab:='property_'||p_kind;ordering:=CASE WHEN p_kind IN ('images','floor_plans') THEN 'm.display_order,m.created_at,m.id' ELSE 'm.created_at,m.id' END;
 projection:=CASE p_kind WHEN 'images' THEN 'm.id,m.property_id,m.alt_text,m.display_order,m.is_primary,m.created_at' WHEN 'floor_plans' THEN 'm.id,m.property_id,m.title,m.description,m.display_order,m.created_at' WHEN 'features' THEN 'm.id,m.property_id,m.name,m.value,m.created_at' ELSE 'm.id,m.property_id,m.name,m.created_at' END;
 IF p_file THEN
  SELECT jsonb_build_object('bucket_id',o.bucket_id,'storage_path',o.storage_path,'mime',o.mime,'file_size',o.file_size,'sha256',o.sha256,'media_id',o.media_id) INTO result
   FROM public.property_media_operations o WHERE o.media_id=p_id AND o.property_id=p_property AND o.kind=p_kind AND o.state='ready';
 ELSE
  EXECUTE format('WITH matching AS MATERIALIZED (SELECT %s FROM public.%I m WHERE m.property_id=$1 AND ($2 IS NULL OR m.id=$2) AND ($3 NOT IN (''images'',''floor_plans'') OR EXISTS(SELECT 1 FROM public.property_media_operations o WHERE o.media_id=m.id AND o.property_id=$1 AND o.kind=$3 AND o.state=''ready''))), paged AS (SELECT to_jsonb(m) record,row_number() OVER(ORDER BY %s) n FROM matching m ORDER BY %s LIMIT $4 OFFSET $5) SELECT (SELECT count(*) FROM matching),coalesce((SELECT jsonb_agg(record ORDER BY n) FROM paged),''[]''::jsonb)',projection,tab,ordering,ordering)
   INTO total,rows USING p_property,p_id,p_kind,p_limit,(p_page::bigint-1)*p_limit;
  result:=CASE WHEN p_id IS NOT NULL THEN rows->0 ELSE jsonb_build_object('records',rows,'pagination',jsonb_build_object('page',p_page,'limit',p_limit,'total',total)) END;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Media not found' USING ERRCODE='P0002';END IF;RETURN result;
END;$function$;

CREATE FUNCTION public.bedos_media_metadata(p_actor uuid,p_property uuid,p_kind text,p_action text,p_id uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE tab text;before_image jsonb;after_image jsonb;v_input jsonb;n bigint;fields text;other record;
BEGIN
 PERFORM public.bedos_media_actor(p_actor,p_action='delete');PERFORM public.bedos_media_parent(p_actor,p_property,true);
 IF p_kind IS NULL OR p_kind NOT IN ('images','floor_plans','features','amenities') OR p_action IS NULL OR p_action NOT IN ('create','update','delete') OR (p_action='create' AND (p_id IS NOT NULL OR p_kind IN ('images','floor_plans'))) OR (p_action<>'create' AND p_id IS NULL) OR (p_action='delete' AND p_kind IN ('images','floor_plans')) THEN RAISE EXCEPTION 'Invalid metadata operation' USING ERRCODE='22023';END IF;
 tab:='property_'||p_kind;
 IF p_action='delete' THEN IF p_input IS DISTINCT FROM '{}'::jsonb THEN RAISE EXCEPTION 'Invalid deletion input' USING ERRCODE='22023';END IF;
 ELSE v_input:=public.bedos_media_validate(p_kind,p_input,p_action='create');END IF;
 IF p_action<>'create' THEN
  EXECUTE format('SELECT to_jsonb(m) FROM public.%I m WHERE id=$1 AND property_id=$2 FOR UPDATE',tab) INTO before_image USING p_id,p_property;
  IF before_image IS NULL OR (p_kind IN ('images','floor_plans') AND NOT EXISTS(SELECT 1 FROM public.property_media_operations WHERE media_id=p_id AND state='ready')) THEN RAISE EXCEPTION 'Media not found' USING ERRCODE='P0002';END IF;
 END IF;
 IF p_kind='images' AND v_input->>'is_primary'='true' THEN
  FOR other IN SELECT * FROM public.property_images WHERE property_id=p_property AND is_primary AND id<>p_id FOR UPDATE LOOP
   UPDATE public.property_images SET is_primary=false WHERE id=other.id RETURNING to_jsonb(property_images) INTO after_image;
   PERFORM public.bedos_catalog_audit(p_actor,'property_image_updated','property_image',other.id,to_jsonb(other),after_image);
  END LOOP;
 END IF;
 IF p_action='create' THEN
  EXECUTE format('SELECT count(*) FROM public.%I WHERE property_id=$1',tab) INTO n USING p_property;
  IF n>=100 THEN RAISE EXCEPTION 'Metadata quota reached' USING ERRCODE='P0001';END IF;
  v_input:=v_input||jsonb_build_object('id',gen_random_uuid(),'property_id',p_property,'created_at',now());
  EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).* RETURNING to_jsonb(%I)',tab,tab,tab) INTO after_image USING v_input;
 ELSIF p_action='update' THEN
  SELECT string_agg(format('%I=(jsonb_populate_record(NULL::public.%I,$1)).%I',k,tab,k),',') INTO fields FROM jsonb_object_keys(v_input) k;
  EXECUTE format('UPDATE public.%I SET %s WHERE id=$2 AND property_id=$3 RETURNING to_jsonb(%I)',tab,fields,tab) INTO after_image USING before_image||v_input,p_id,p_property;
 ELSE
  EXECUTE format('DELETE FROM public.%I WHERE id=$1 AND property_id=$2',tab) USING p_id,p_property;
 END IF;
 PERFORM public.bedos_catalog_audit(p_actor,'property_'||CASE p_kind WHEN 'images' THEN 'image' WHEN 'floor_plans' THEN 'floor_plan' WHEN 'features' THEN 'feature' ELSE 'amenity' END||'_'||CASE p_action WHEN 'create' THEN 'created' WHEN 'update' THEN 'updated' ELSE 'deleted' END,
  'property_'||CASE p_kind WHEN 'images' THEN 'image' WHEN 'floor_plans' THEN 'floor_plan' WHEN 'features' THEN 'feature' ELSE 'amenity' END,(coalesce(after_image,before_image)->>'id')::uuid,before_image,after_image);
 RETURN coalesce(after_image,jsonb_build_object('id',p_id));
END;$function$;

CREATE FUNCTION public.bedos_media_upload(p_actor uuid,p_property uuid,p_kind text,p_input jsonb,p_mime text,p_size integer,p_hash text,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE op public.property_media_operations%ROWTYPE;v_input jsonb;n bigint;active_count bigint;tab text;
BEGIN
 PERFORM public.bedos_media_parent(p_actor,p_property,true);
 IF p_actor IS NULL OR p_kind IS NULL OR p_kind NOT IN ('images','floor_plans') OR p_mime IS NULL OR p_mime NOT IN ('image/jpeg','image/png','image/webp') OR p_size IS NULL OR p_size NOT BETWEEN 1 AND 3145728 OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_key IS NULL THEN RAISE EXCEPTION 'Invalid upload proof' USING ERRCODE='22023';END IF;
 v_input:=public.bedos_media_validate(p_kind,p_input,true);
 SELECT * INTO op FROM public.property_media_operations WHERE actor_id=p_actor AND idempotency_key=p_key FOR UPDATE;
 IF FOUND THEN
  IF op.bound_property_id<>p_property OR op.kind<>p_kind OR op.sha256<>p_hash OR op.input<>v_input OR op.mime<>p_mime OR op.file_size<>p_size THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='P0001';END IF;
  RETURN jsonb_build_object('operation',to_jsonb(op),'acquired',false);
 END IF;
 IF (SELECT count(*) FROM public.property_media_operations WHERE actor_id=p_actor AND created_at>now()-interval '1 minute')>=30 THEN RAISE EXCEPTION 'Upload rate exceeded' USING ERRCODE='P0429';END IF;
 SELECT count(*) INTO active_count FROM public.property_media_operations WHERE actor_id=p_actor AND state='upload_pending';
 IF active_count>=2 THEN RAISE EXCEPTION 'Uploads already in progress' USING ERRCODE='P0001';END IF;
 tab:='property_'||p_kind;
 EXECUTE format('SELECT count(*) FROM public.%I WHERE property_id=$1',tab) INTO n USING p_property;
 SELECT n+count(*) INTO n FROM public.property_media_operations o WHERE property_id=p_property AND kind=p_kind AND state IN ('upload_pending','cleanup_pending') AND NOT EXISTS(SELECT 1 FROM public.property_images WHERE id=o.media_id) AND NOT EXISTS(SELECT 1 FROM public.property_floor_plans WHERE id=o.media_id);
 IF n>=(CASE WHEN p_kind='images' THEN 100 ELSE 25 END) THEN RAISE EXCEPTION 'Media quota reached' USING ERRCODE='P0001';END IF;
 op.id:=gen_random_uuid();op.bucket_id:=CASE p_kind WHEN 'images' THEN 'property-images' ELSE 'property-floor-plans' END;
 op.storage_path:='properties/'||p_property||'/'||op.id||'.'||CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' ELSE 'webp' END;
 INSERT INTO public.property_media_operations(id,property_id,bound_property_id,actor_id,kind,idempotency_key,bucket_id,storage_path,mime,file_size,sha256,input)
 VALUES(op.id,p_property,p_property,p_actor,p_kind,p_key,op.bucket_id,op.storage_path,p_mime,p_size,p_hash,v_input) RETURNING * INTO op;
 PERFORM public.bedos_catalog_audit(p_actor,'property_media_upload_started','property_media_operation',op.id,NULL,to_jsonb(op)-'lease_token');
 RETURN jsonb_build_object('operation',to_jsonb(op),'acquired',true);
END;$function$;

CREATE FUNCTION public.bedos_media_finalize(p_actor uuid,p_operation uuid,p_version integer,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE op public.property_media_operations%ROWTYPE;image jsonb;other record;prior jsonb;tab text;
BEGIN
 PERFORM public.bedos_media_actor(p_actor);
 SELECT * INTO op FROM public.property_media_operations WHERE id=p_operation;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE='P0002';END IF;
 PERFORM public.bedos_media_parent(p_actor,op.property_id,true);
 SELECT * INTO op FROM public.property_media_operations WHERE id=p_operation FOR UPDATE;
 IF op.actor_id<>p_actor OR op.state<>'upload_pending' OR op.version IS DISTINCT FROM p_version OR op.lease_token IS DISTINCT FROM p_token OR op.property_id IS NULL THEN RAISE EXCEPTION 'Stale upload operation' USING ERRCODE='P0001';END IF;
 IF op.kind='images' AND op.input->>'is_primary'='true' THEN
  FOR other IN SELECT * FROM public.property_images WHERE property_id=op.property_id AND is_primary FOR UPDATE LOOP
   UPDATE public.property_images SET is_primary=false WHERE id=other.id RETURNING to_jsonb(property_images) INTO prior;
   PERFORM public.bedos_catalog_audit(p_actor,'property_image_updated','property_image',other.id,to_jsonb(other),prior);
  END LOOP;
 END IF;
 tab:='property_'||op.kind;
 image:=jsonb_build_object('id',op.media_id,'property_id',op.property_id,'storage_path',op.storage_path,'created_at',now(),'display_order',0)||CASE WHEN op.kind='images' THEN '{"is_primary":false}'::jsonb ELSE '{}'::jsonb END||op.input;
 EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).* RETURNING to_jsonb(%I)',tab,tab,tab) INTO image USING image;
 UPDATE public.property_media_operations SET state='ready',version=version+1,lease_until=now(),updated_at=now() WHERE id=op.id;
 PERFORM public.bedos_catalog_audit(p_actor,CASE op.kind WHEN 'images' THEN 'property_image_created' ELSE 'property_floor_plan_created' END,CASE op.kind WHEN 'images' THEN 'property_image' ELSE 'property_floor_plan' END,op.media_id,NULL,image,jsonb_build_object('operation_id',op.id));
 RETURN image-'storage_path';
END;$function$;

CREATE FUNCTION public.bedos_media_operation(p_actor uuid,p_action text,p_operation uuid DEFAULT NULL,p_property uuid DEFAULT NULL,p_media uuid DEFAULT NULL,p_kind text DEFAULT NULL,p_version integer DEFAULT NULL,p_token uuid DEFAULT NULL,p_page integer DEFAULT 1,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE op public.property_media_operations%ROWTYPE;before_image jsonb;tab text;total bigint;records jsonb;
BEGIN
 PERFORM public.bedos_media_actor(p_actor,p_action IN ('list','retry','delete','complete'));
 IF p_action='list' THEN
  IF p_page IS NULL OR p_page<1 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid pagination' USING ERRCODE='22023';END IF;
  SELECT count(*) INTO total FROM public.property_media_operations;
  SELECT coalesce(jsonb_agg(v.record ORDER BY v.priority,v.created_at,v.id),'[]'::jsonb) INTO records FROM
   (SELECT id,created_at,CASE WHEN state IN ('upload_pending','cleanup_pending') THEN 0 ELSE 1 END priority,jsonb_build_object('id',id,'property_id',property_id,'kind',kind,'state',state,'version',version,'lease_until',lease_until,'created_at',created_at) record FROM public.property_media_operations ORDER BY priority,created_at,id LIMIT p_limit OFFSET (p_page::bigint-1)*p_limit) v;
  RETURN jsonb_build_object('operations',records,'pagination',jsonb_build_object('page',p_page,'limit',p_limit,'total',total));
 END IF;
 IF p_action IS NULL OR p_action NOT IN ('status','retry','delete','complete') THEN RAISE EXCEPTION 'Invalid operation action' USING ERRCODE='22023';END IF;
 IF p_action='delete' THEN SELECT * INTO op FROM public.property_media_operations WHERE media_id=p_media AND property_id=p_property AND kind=p_kind;
 ELSE SELECT * INTO op FROM public.property_media_operations WHERE id=p_operation;END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Media operation not found' USING ERRCODE='P0002';END IF;
 -- Match parent-before-operation lock order used by metadata/finalization and FK detachment.
 IF op.property_id IS NOT NULL THEN PERFORM 1 FROM public.properties WHERE id=op.property_id FOR UPDATE;END IF;
 SELECT * INTO op FROM public.property_media_operations WHERE id=op.id FOR UPDATE;
 IF p_action='status' THEN
  IF op.actor_id<>p_actor AND NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=p_actor AND r.name='administrator') THEN RAISE EXCEPTION 'Operation access denied' USING ERRCODE='42501';END IF;
  RETURN to_jsonb(op);
 END IF;
 IF p_action='complete' THEN
  IF op.state<>'cleanup_pending' OR op.version IS DISTINCT FROM p_version OR op.lease_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'Stale cleanup' USING ERRCODE='P0001';END IF;
  tab:='property_'||op.kind;
  EXECUTE format('SELECT to_jsonb(m) FROM public.%I m WHERE id=$1 FOR UPDATE',tab) INTO before_image USING op.media_id;
  IF before_image IS NOT NULL THEN
   EXECUTE format('DELETE FROM public.%I WHERE id=$1',tab) USING op.media_id;
   PERFORM public.bedos_catalog_audit(p_actor,CASE op.kind WHEN 'images' THEN 'property_image_deleted' ELSE 'property_floor_plan_deleted' END,CASE op.kind WHEN 'images' THEN 'property_image' ELSE 'property_floor_plan' END,op.media_id,before_image,NULL,jsonb_build_object('operation_id',op.id));
  END IF;
  UPDATE public.property_media_operations SET state='deleted',version=version+1,lease_until=now(),updated_at=now() WHERE id=op.id;
  PERFORM public.bedos_catalog_audit(p_actor,'property_media_cleanup_completed','property_media_operation',op.id,to_jsonb(op)-'lease_token',jsonb_build_object('state','deleted'));
  RETURN jsonb_build_object('id',op.id,'state','deleted');
 END IF;
 IF op.state='deleted' AND p_action='delete' THEN RETURN jsonb_build_object('operation',to_jsonb(op),'acquired',false);END IF;
 IF p_action='retry' AND (op.state='ready' OR op.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'Operation is not eligible for retry' USING ERRCODE='P0001';END IF;
 IF p_action='delete' AND op.state='upload_pending' THEN RAISE EXCEPTION 'Upload is still pending' USING ERRCODE='P0001';END IF;
 IF op.state='cleanup_pending' AND op.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('operation',to_jsonb(op),'acquired',false);END IF;
 before_image:=to_jsonb(op)-'lease_token';
 UPDATE public.property_media_operations SET state='cleanup_pending',version=version+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',updated_at=now() WHERE id=op.id RETURNING * INTO op;
 PERFORM public.bedos_catalog_audit(p_actor,'property_media_cleanup_requested','property_media_operation',op.id,before_image,to_jsonb(op)-'lease_token');
 RETURN jsonb_build_object('operation',to_jsonb(op),'acquired',true);
END;$function$;

CREATE FUNCTION public.bedos_media_parent_removed()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $function$
BEGIN
 IF NEW.property_id IS NULL AND OLD.property_id IS NOT NULL AND NEW.state='upload_pending' THEN
  NEW.state:='cleanup_pending';NEW.version:=NEW.version+1;NEW.updated_at:=now();
 END IF;RETURN NEW;
END;$function$;
CREATE TRIGGER property_media_parent_removed BEFORE UPDATE OF property_id ON public.property_media_operations FOR EACH ROW EXECUTE FUNCTION public.bedos_media_parent_removed();

REVOKE ALL ON public.property_media_operations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.bedos_media_actor(uuid,boolean),public.bedos_media_validate(text,jsonb,boolean),public.bedos_media_parent(uuid,uuid,boolean),public.bedos_media_parent_removed() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.bedos_media_read(uuid,uuid,text,uuid,integer,integer,boolean),public.bedos_media_metadata(uuid,uuid,text,text,uuid,jsonb),public.bedos_media_upload(uuid,uuid,text,jsonb,text,integer,text,uuid),public.bedos_media_finalize(uuid,uuid,integer,uuid),public.bedos_media_operation(uuid,text,uuid,uuid,uuid,text,integer,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_media_read(uuid,uuid,text,uuid,integer,integer,boolean),public.bedos_media_metadata(uuid,uuid,text,text,uuid,jsonb),public.bedos_media_upload(uuid,uuid,text,jsonb,text,integer,text,uuid),public.bedos_media_finalize(uuid,uuid,integer,uuid),public.bedos_media_operation(uuid,text,uuid,uuid,uuid,text,integer,uuid,integer,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
