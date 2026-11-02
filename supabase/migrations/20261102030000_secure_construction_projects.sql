BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public.projects,public.project_stages,public.project_images IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.projects) OR EXISTS(SELECT 1 FROM public.project_stages) OR EXISTS(SELECT 1 FROM public.project_images)
 OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='project-images') THEN
  RAISE EXCEPTION 'Existing construction content requires reviewed provenance migration';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='project-images' AND NOT public) THEN RAISE EXCEPTION 'Expected private project-images bucket';END IF;
 IF to_regprocedure('public.bedos_require_catalog_permission(uuid,text)') IS NULL THEN RAISE EXCEPTION 'Catalog authorization prerequisite missing';END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='projects')<>14
 OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='project_stages')<>10
 OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='project_images')<>7
 THEN RAISE EXCEPTION 'Unexpected construction schema';END IF;
END;$guard$;

CREATE TABLE public.project_categories(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 slug text NOT NULL UNIQUE CHECK(length(slug) BETWEEN 1 AND 200 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 description text CHECK(length(description)<=10000),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0),
 ADD COLUMN category_id uuid REFERENCES public.project_categories(id) ON DELETE RESTRICT,
 ADD CONSTRAINT projects_text_bounds CHECK(length(btrim(title)) BETWEEN 1 AND 200 AND length(slug) BETWEEN 1 AND 200 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(description)<=10000 AND length(project_type)<=200 AND length(location)<=500 AND length(client_name)<=500),
 ADD CONSTRAINT projects_date_order CHECK(completion_date IS NULL OR start_date IS NULL OR completion_date>=start_date);
CREATE INDEX projects_category_idx ON public.projects(category_id);
CREATE TABLE public.project_services(
 project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
 service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,service_id)
);
CREATE INDEX project_services_service_idx ON public.project_services(service_id);
ALTER TABLE public.project_stages ADD CONSTRAINT project_stages_order_bound CHECK(stage_order BETWEEN 0 AND 2147483647),
 ADD CONSTRAINT project_stages_text_bounds CHECK(length(btrim(name)) BETWEEN 1 AND 200 AND length(description)<=10000),
 ADD CONSTRAINT project_stages_dates CHECK((status='pending' AND start_date IS NULL AND completion_date IS NULL) OR (status='in_progress' AND start_date IS NOT NULL AND completion_date IS NULL) OR (status='completed' AND start_date IS NOT NULL AND completion_date IS NOT NULL AND completion_date>=start_date)),
 ADD CONSTRAINT project_stages_unique_order UNIQUE(project_id,stage_order) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE public.project_images ADD COLUMN phase text NOT NULL CHECK(phase IN ('before','during','after')),
 ADD CONSTRAINT project_images_order_bound CHECK(display_order>=0),ADD CONSTRAINT project_images_alt_bound CHECK(length(alt_text)<=1000);
CREATE UNIQUE INDEX project_images_one_primary ON public.project_images(project_id) WHERE is_primary;

CREATE TABLE public.project_media_operations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
 bound_project_id uuid NOT NULL,actor_id uuid NOT NULL,media_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 idempotency_key uuid NOT NULL,storage_path text NOT NULL UNIQUE,bucket_id text NOT NULL DEFAULT 'project-images' CHECK(bucket_id='project-images'),
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),file_size integer NOT NULL CHECK(file_size BETWEEN 1 AND 3145728),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),input jsonb NOT NULL,request_version integer NOT NULL,
 state text NOT NULL DEFAULT 'upload_pending' CHECK(state IN ('upload_pending','ready','cleanup_pending','deleted')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
 lease_until timestamptz NOT NULL DEFAULT now()+interval '5 minutes',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX project_media_parent_idx ON public.project_media_operations(bound_project_id,state);
CREATE INDEX project_media_recovery_idx ON public.project_media_operations(state,created_at,id);
ALTER TABLE public.project_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_media_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_categories,public.project_services,public.project_media_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.bedos_project_actor(p_actor uuid,p_write boolean DEFAULT false,p_admin boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 PERFORM public.bedos_require_catalog_permission(p_actor,CASE WHEN p_write THEN 'projects.manage' ELSE 'projects.view' END);
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.roles r ON r.id=p.role_id WHERE p.id=p_actor AND p.account_status='active'
 AND r.name=ANY(CASE WHEN p_admin THEN ARRAY['administrator'] ELSE ARRAY['administrator','content_manager'] END)) THEN
  RAISE EXCEPTION 'Construction authorization denied' USING ERRCODE='42501';END IF;
END;$f$;

CREATE FUNCTION public.bedos_project_input(p_input jsonb,p_kind text,p_create boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $f$
DECLARE allowed text[];k text;v jsonb;s text;n numeric;result jsonb:=p_input;d date;
BEGIN
 allowed:=CASE p_kind WHEN 'project' THEN ARRAY['title','slug','description','project_type','location','client_name','start_date','category_id','featured','service_ids']
 WHEN 'category' THEN ARRAY['name','slug','description'] WHEN 'stage' THEN ARRAY['name','description','stage_order','status','start_date','completion_date']
 WHEN 'image' THEN ARRAY['phase','alt_text','display_order','is_primary'] WHEN 'status' THEN ARRAY['status','completion_date'] END;
 IF allowed IS NULL OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR (NOT p_create AND p_input='{}')
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) field WHERE NOT field=ANY(allowed)) THEN RAISE EXCEPTION 'Invalid construction fields' USING ERRCODE='22023';END IF;
 IF p_create AND ((p_kind='project' AND NOT(p_input ? 'title' AND p_input ? 'slug')) OR (p_kind='category' AND NOT(p_input ? 'name' AND p_input ? 'slug'))
 OR(p_kind='stage' AND NOT(p_input ? 'name' AND p_input ? 'stage_order')) OR(p_kind='image' AND NOT p_input ? 'phase')) THEN RAISE EXCEPTION 'Missing construction fields' USING ERRCODE='22023';END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_input) LOOP
  IF k IN ('featured','is_primary') THEN
   IF jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'Invalid boolean' USING ERRCODE='22023';END IF;
  ELSIF k IN ('stage_order','display_order') THEN
   IF jsonb_typeof(v)<>'number' THEN RAISE EXCEPTION 'Invalid order' USING ERRCODE='22023';END IF;
   n:=v::text::numeric;IF n<0 OR n>2147483647 OR n<>trunc(n) THEN RAISE EXCEPTION 'Invalid order' USING ERRCODE='22023';END IF;
  ELSIF k='service_ids' THEN
   IF jsonb_typeof(v)<>'array' THEN RAISE EXCEPTION 'Invalid services' USING ERRCODE='22023';END IF;
   IF jsonb_array_length(v)>50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(v) a WHERE jsonb_typeof(a)<>'string' OR a#>>'{}' !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
   OR (SELECT count(*)<>count(DISTINCT a) FROM jsonb_array_elements(v) a) THEN RAISE EXCEPTION 'Invalid services' USING ERRCODE='22023';END IF;
  ELSIF k='category_id' THEN
   IF v<>'null' AND (jsonb_typeof(v)<>'string' OR p_input->>k !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') THEN RAISE EXCEPTION 'Invalid category' USING ERRCODE='22023';END IF;
  ELSIF k IN ('start_date','completion_date') THEN
   IF v='null' THEN CONTINUE;END IF;
   IF jsonb_typeof(v)<>'string' OR p_input->>k !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='22023';END IF;
   BEGIN d:=(p_input->>k)::date;EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='22023';END;
   IF d<'0001-01-01'::date OR d>'9999-12-31'::date THEN RAISE EXCEPTION 'Invalid date' USING ERRCODE='22023';END IF;
  ELSE
   IF v='null' AND k IN ('description','project_type','location','client_name','alt_text') THEN CONTINUE;END IF;
   IF jsonb_typeof(v)<>'string' THEN RAISE EXCEPTION 'Invalid text' USING ERRCODE='22023';END IF;
   s:=regexp_replace(p_input->>k,'^[[:space:]]+|[[:space:]]+$','','g');
   IF length(s)>(CASE WHEN k='description' THEN 10000 WHEN k='alt_text' THEN 1000 WHEN k IN ('location','client_name') THEN 500 ELSE 200 END)
   OR (k IN ('title','name','slug','phase','status') AND s='') OR (k='slug' AND s !~ '^[a-z0-9]+(-[a-z0-9]+)*$')
   OR(k='phase' AND s NOT IN ('before','during','after')) OR(k='status' AND ((p_kind='stage' AND s NOT IN ('pending','in_progress','completed')) OR(p_kind='status' AND s NOT IN ('draft','ongoing','completed','archived')))) THEN RAISE EXCEPTION 'Invalid text value' USING ERRCODE='22023';END IF;
   result:=jsonb_set(result,ARRAY[k],CASE WHEN s='' THEN 'null'::jsonb ELSE to_jsonb(s) END);
  END IF;
 END LOOP;RETURN result;
END;$f$;

CREATE FUNCTION public.bedos_project_lock(p_actor uuid,p_id uuid,p_version integer)
RETURNS public.projects LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.projects;
BEGIN
 PERFORM public.bedos_project_actor(p_actor,true);
 SELECT * INTO r FROM public.projects WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found' USING ERRCODE='P0002';END IF;
 IF p_version IS NULL OR p_version<1 THEN RAISE EXCEPTION 'Expected version required' USING ERRCODE='22023';END IF;
 IF r.version<>p_version THEN RAISE EXCEPTION 'Project changed' USING ERRCODE='P0001';END IF;RETURN r;
END;$f$;

CREATE FUNCTION public.bedos_project_projection(p public.projects,p_public boolean,p_detail boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $f$
DECLARE result jsonb;total integer;done integer;
BEGIN
 SELECT count(*),count(*) FILTER(WHERE status='completed') INTO total,done FROM public.project_stages WHERE project_id=p.id;
 result:=jsonb_build_object('id',p.id,'title',p.title,'slug',p.slug,'description',p.description,'project_type',p.project_type,'location',p.location,
 'category',(SELECT jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'description',c.description) FROM public.project_categories c WHERE c.id=p.category_id),
 'start_date',p.start_date,'completion_date',p.completion_date,'status',p.status,'featured',p.featured,'stage_count',total,'completed_stage_count',done,'progress',CASE WHEN total>0 THEN round(done*100.0/total) END);
 IF NOT p_public THEN result:=result||jsonb_build_object('version',p.version,'category_id',p.category_id,'client_name',p.client_name,'created_by',p.created_by,'created_at',p.created_at,'updated_at',p.updated_at);END IF;
 IF p_detail THEN
  result:=result||jsonb_build_object('stages',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.stage_order,s.id) FROM public.project_stages s WHERE s.project_id=p.id),'[]'),
   'services',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'slug',s.slug,'description',s.description) ORDER BY s.name,s.id) FROM public.project_services l JOIN public.services s ON s.id=l.service_id WHERE l.project_id=p.id AND (NOT p_public OR s.status='published')),'[]'),
   'images',coalesce((SELECT jsonb_agg((to_jsonb(m)-'storage_path')||jsonb_build_object('image_url','/api/projects/'||p.id||'/images/'||m.id||'/file') ORDER BY m.display_order,m.created_at,m.id) FROM public.project_images m JOIN public.project_media_operations o ON o.media_id=m.id AND o.state='ready' WHERE m.project_id=p.id),'[]'));
 END IF;RETURN result;
END;$f$;

CREATE FUNCTION public.bedos_project_read(p_actor uuid DEFAULT NULL,p_entity text DEFAULT 'projects',p_id uuid DEFAULT NULL,p_slug text DEFAULT NULL,p_query jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE page integer:=coalesce((p_query->>'page')::integer,1);lim integer:=coalesce((p_query->>'page_size')::integer,25);total bigint;records jsonb;
BEGIN
 IF p_actor IS NOT NULL THEN PERFORM public.bedos_project_actor(p_actor);END IF;
 IF p_entity IS NULL OR p_entity NOT IN ('projects','categories','operations') OR p_query IS NULL OR jsonb_typeof(p_query)<>'object' OR page<1 OR lim NOT BETWEEN 1 AND 100
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_query) k WHERE k NOT IN ('page','page_size','q','category_id','service_id','status','featured'))
 OR (p_query ? 'q' AND (jsonb_typeof(p_query->'q')<>'string' OR length(p_query->>'q')>200))
 OR (p_query ? 'featured' AND jsonb_typeof(p_query->'featured')<>'boolean')
 OR(p_query ? 'status' AND (p_query->>'status' IS NULL OR p_query->>'status'<>ALL(CASE WHEN p_actor IS NULL THEN ARRAY['ongoing','completed'] ELSE ARRAY['draft','ongoing','completed','archived'] END))) THEN RAISE EXCEPTION 'Invalid project read' USING ERRCODE='22023';END IF;
 IF p_entity='operations' THEN
  PERFORM public.bedos_project_actor(p_actor,true,true);
  WITH matching AS MATERIALIZED(SELECT * FROM public.project_media_operations WHERE state IN ('upload_pending','cleanup_pending')),
  paged AS(SELECT id,created_at,jsonb_build_object('id',id,'project_id',project_id,'state',state,'version',version,'created_at',created_at,'updated_at',updated_at) record FROM matching ORDER BY created_at,id LIMIT lim OFFSET(page::bigint-1)*lim)
  SELECT (SELECT count(*) FROM matching),coalesce((SELECT jsonb_agg(record ORDER BY created_at,id) FROM paged),'[]') INTO total,records;
 ELSIF p_entity='categories' THEN
  IF p_id IS NOT NULL THEN
   SELECT to_jsonb(c) INTO records FROM public.project_categories c WHERE c.id=p_id AND (p_actor IS NOT NULL OR EXISTS(SELECT 1 FROM public.projects p WHERE p.category_id=c.id AND p.status IN ('ongoing','completed')));
   IF records IS NULL THEN RAISE EXCEPTION 'Category not found' USING ERRCODE='P0002';END IF;RETURN records;
  END IF;
  WITH matching AS MATERIALIZED(SELECT c.* FROM public.project_categories c WHERE p_actor IS NOT NULL OR EXISTS(SELECT 1 FROM public.projects p WHERE p.category_id=c.id AND p.status IN ('ongoing','completed'))),
  paged AS(SELECT c.id,c.name,CASE WHEN p_actor IS NULL THEN jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'description',c.description) ELSE to_jsonb(c) END record FROM matching c ORDER BY c.name,c.id LIMIT lim OFFSET(page::bigint-1)*lim)
  SELECT (SELECT count(*) FROM matching),coalesce((SELECT jsonb_agg(record ORDER BY name,id) FROM paged),'[]') INTO total,records;
 ELSE
  IF p_id IS NOT NULL OR p_slug IS NOT NULL THEN
   SELECT public.bedos_project_projection(p,p_actor IS NULL,true) INTO records FROM public.projects p WHERE (p_id IS NULL OR id=p_id) AND (p_slug IS NULL OR slug=p_slug) AND (p_actor IS NOT NULL OR status IN ('ongoing','completed'));
   IF NOT FOUND THEN RAISE EXCEPTION 'Project not found' USING ERRCODE='P0002';END IF;RETURN records;
  END IF;
  WITH matching AS MATERIALIZED(SELECT * FROM public.projects p WHERE (p_actor IS NOT NULL OR status IN ('ongoing','completed'))
   AND(NOT p_query ? 'status' OR status=p_query->>'status') AND(NOT p_query ? 'featured' OR featured=(p_query->>'featured')::boolean)
   AND(NOT p_query ? 'q' OR strpos(lower(title||' '||coalesce(description,'')||' '||coalesce(location,'')),lower(p_query->>'q'))>0)
   AND(NOT p_query ? 'category_id' OR category_id=(p_query->>'category_id')::uuid)
   AND(NOT p_query ? 'service_id' OR EXISTS(SELECT 1 FROM public.project_services l JOIN public.services s ON s.id=l.service_id WHERE l.project_id=p.id AND l.service_id=(p_query->>'service_id')::uuid AND(p_actor IS NOT NULL OR s.status='published')))),
   paged AS(SELECT * FROM matching ORDER BY featured DESC,created_at DESC,id DESC LIMIT lim OFFSET(page::bigint-1)*lim)
  SELECT (SELECT count(*) FROM matching),coalesce((SELECT jsonb_agg(public.bedos_project_projection(p,p_actor IS NULL) ORDER BY featured DESC,created_at DESC,id DESC) FROM paged p),'[]') INTO total,records;
 END IF;
 RETURN jsonb_build_object('records',records,'pagination',jsonb_build_object('page',page,'page_size',lim,'total',total));
END;$f$;

CREATE FUNCTION public.bedos_project_mutate(p_actor uuid,p_entity text,p_action text,p_id uuid DEFAULT NULL,p_project uuid DEFAULT NULL,p_version integer DEFAULT NULL,p_input jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE data jsonb;before_row jsonb;after_row jsonb;r public.projects;c public.project_categories;s public.project_stages;oldstage public.project_stages;v uuid;sid uuid;nextstatus text;
BEGIN
 PERFORM public.bedos_project_actor(p_actor,true);
 IF p_entity IS NULL OR p_entity NOT IN ('project','category','stage','status','reorder') OR p_action IS NULL OR p_action NOT IN ('create','update','delete') THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023';END IF;
 IF p_entity='category' THEN
  IF p_action<>'create' THEN
   SELECT * INTO c FROM public.project_categories WHERE id=p_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE='P0002';END IF;
   IF p_version IS NULL OR p_version<1 THEN RAISE EXCEPTION 'Version required' USING ERRCODE='22023';END IF;
   IF c.version<>p_version THEN RAISE EXCEPTION 'Category changed' USING ERRCODE='P0001';END IF;before_row:=to_jsonb(c);
  END IF;
  IF p_action='delete' THEN DELETE FROM public.project_categories WHERE id=p_id;
  ELSE
   data:=public.bedos_project_input(p_input,'category',p_action='create');
   IF p_action='create' THEN INSERT INTO public.project_categories(name,slug,description) VALUES(data->>'name',data->>'slug',data->>'description') RETURNING * INTO c;
   ELSE c:=jsonb_populate_record(c,data);UPDATE public.project_categories SET name=c.name,slug=c.slug,description=c.description,version=version+1,updated_at=clock_timestamp() WHERE id=p_id RETURNING * INTO c;END IF;
   after_row:=to_jsonb(c);
  END IF;
  PERFORM public.bedos_catalog_audit(p_actor,'project_category_'||p_action,'project_category',coalesce(p_id,c.id),before_row,after_row);RETURN coalesce(after_row,jsonb_build_object('deleted',true));
 END IF;
 IF p_entity='project' AND p_action='create' THEN
  data:=public.bedos_project_input(p_input,'project',true);
  r:=jsonb_populate_record(NULL::public.projects,data-'service_ids');
  IF r.category_id IS NOT NULL THEN PERFORM 1 FROM public.project_categories WHERE id=r.category_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE='P0002';END IF;END IF;
  INSERT INTO public.projects(title,slug,description,project_type,location,client_name,start_date,category_id,featured,created_by)
  VALUES(r.title,r.slug,r.description,r.project_type,r.location,r.client_name,r.start_date,r.category_id,coalesce(r.featured,false),p_actor) RETURNING * INTO r;
 ELSE
  r:=public.bedos_project_lock(p_actor,coalesce(p_project,p_id),p_version);
  before_row:=public.bedos_project_projection(r,false,true);
 END IF;
 IF p_entity='project' THEN
  IF p_action='delete' THEN
   IF EXISTS(SELECT 1 FROM public.project_images WHERE project_id=r.id) OR EXISTS(SELECT 1 FROM public.project_media_operations WHERE bound_project_id=r.id AND state NOT IN ('deleted')) THEN RAISE EXCEPTION 'Remove project files first' USING ERRCODE='P0001';END IF;
   DELETE FROM public.projects WHERE id=r.id;
  ELSE
   IF p_action='update' THEN
    data:=public.bedos_project_input(p_input,'project');r:=jsonb_populate_record(r,data-'service_ids');
    IF r.category_id IS NOT NULL THEN PERFORM 1 FROM public.project_categories WHERE id=r.category_id FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Category not found' USING ERRCODE='P0002';END IF;END IF;
    UPDATE public.projects SET title=r.title,slug=r.slug,description=r.description,project_type=r.project_type,location=r.location,client_name=r.client_name,start_date=r.start_date,category_id=r.category_id,featured=r.featured WHERE id=r.id;
   END IF;
   IF data ? 'service_ids' THEN
    FOR sid IN SELECT (a#>>'{}')::uuid FROM jsonb_array_elements(data->'service_ids') a ORDER BY 1 LOOP
     PERFORM 1 FROM public.services WHERE id=sid AND status='published' FOR SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Published service required' USING ERRCODE='P0001';END IF;
    END LOOP;
    DELETE FROM public.project_services WHERE project_id=r.id;
    INSERT INTO public.project_services(project_id,service_id) SELECT r.id,(a#>>'{}')::uuid FROM jsonb_array_elements(data->'service_ids') a;
   END IF;
  END IF;
 ELSIF p_entity='status' THEN
  IF p_action<>'update' THEN RAISE EXCEPTION 'Invalid status action' USING ERRCODE='22023';END IF;
  data:=public.bedos_project_input(p_input,'status');nextstatus:=data->>'status';
  IF nextstatus IS NULL OR NOT ((r.status='draft' AND nextstatus IN ('ongoing','archived')) OR(r.status='ongoing' AND nextstatus IN ('completed','archived')) OR(r.status='completed' AND nextstatus IN ('ongoing','archived')) OR(r.status='archived' AND nextstatus='draft')) THEN RAISE EXCEPTION 'Invalid project transition' USING ERRCODE='P0001';END IF;
  IF nextstatus='completed' AND (data->>'completion_date' IS NULL OR NOT EXISTS(SELECT 1 FROM public.project_stages WHERE project_id=r.id) OR EXISTS(SELECT 1 FROM public.project_stages WHERE project_id=r.id AND status<>'completed')) THEN RAISE EXCEPTION 'Complete all stages and supply date' USING ERRCODE='P0001';END IF;
  IF nextstatus<>'completed' AND data->>'completion_date' IS NOT NULL THEN RAISE EXCEPTION 'Unexpected completion date' USING ERRCODE='22023';END IF;
  UPDATE public.projects SET status=nextstatus,completion_date=CASE WHEN nextstatus='completed' THEN (data->>'completion_date')::date ELSE NULL END WHERE id=r.id;
 ELSIF p_entity IN ('stage','reorder') THEN
  IF r.status='completed' THEN RAISE EXCEPTION 'Reopen completed project first' USING ERRCODE='P0001';END IF;
  IF p_entity='reorder' THEN
   IF p_action<>'update' OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR NOT p_input ? 'stage_ids' OR (SELECT count(*) FROM jsonb_object_keys(p_input))<>1 OR jsonb_typeof(p_input->'stage_ids')<>'array' THEN RAISE EXCEPTION 'Invalid stage ordering' USING ERRCODE='22023';END IF;
   IF jsonb_array_length(p_input->'stage_ids')<>(SELECT count(*) FROM public.project_stages WHERE project_id=r.id) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_input->'stage_ids') a WHERE a !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') OR (SELECT count(*)<>count(DISTINCT a) FROM jsonb_array_elements_text(p_input->'stage_ids') a) THEN RAISE EXCEPTION 'Invalid stage ordering' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_input->'stage_ids') a WHERE NOT EXISTS(SELECT 1 FROM public.project_stages WHERE id=a::uuid AND project_id=r.id)) THEN RAISE EXCEPTION 'Stage not found' USING ERRCODE='P0002';END IF;
   SET CONSTRAINTS public.project_stages_unique_order DEFERRED;
   UPDATE public.project_stages target SET stage_order=x.n-1 FROM(SELECT a::uuid id,n::integer FROM jsonb_array_elements_text(p_input->'stage_ids') WITH ORDINALITY t(a,n)) x WHERE target.id=x.id AND target.project_id=r.id;
   SET CONSTRAINTS public.project_stages_unique_order IMMEDIATE;
  ELSE
   IF p_action<>'create' THEN SELECT * INTO s FROM public.project_stages WHERE id=p_id AND project_id=r.id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Stage not found' USING ERRCODE='P0002';END IF;oldstage:=s;END IF;
   IF p_action='delete' THEN DELETE FROM public.project_stages WHERE id=s.id;
   ELSE
    data:=public.bedos_project_input(p_input,'stage',p_action='create');
    IF p_action='create' THEN
     IF (SELECT count(*) FROM public.project_stages WHERE project_id=r.id)>=100 THEN RAISE EXCEPTION 'Stage limit reached' USING ERRCODE='P0001';END IF;
     IF coalesce(data->>'status','pending')<>'pending' OR data->>'start_date' IS NOT NULL OR data->>'completion_date' IS NOT NULL THEN RAISE EXCEPTION 'New stage must be pending' USING ERRCODE='22023';END IF;
     INSERT INTO public.project_stages(project_id,name,description,stage_order) VALUES(r.id,data->>'name',data->>'description',(data->>'stage_order')::integer) RETURNING * INTO s;
    ELSE
     s:=jsonb_populate_record(s,data);
     IF data ? 'status' THEN
      IF NOT((oldstage.status='pending' AND s.status='in_progress') OR(oldstage.status='in_progress' AND s.status IN ('completed','pending')) OR(oldstage.status='completed' AND s.status='in_progress')) THEN RAISE EXCEPTION 'Invalid stage transition' USING ERRCODE='P0001';END IF;
      IF s.status='pending' THEN s.start_date:=NULL;s.completion_date:=NULL;ELSIF s.status='in_progress' THEN s.completion_date:=NULL;END IF;
     END IF;
     UPDATE public.project_stages SET name=s.name,description=s.description,stage_order=s.stage_order,status=s.status,start_date=s.start_date,completion_date=s.completion_date WHERE id=s.id RETURNING * INTO s;
    END IF;
   END IF;
   PERFORM public.bedos_catalog_audit(p_actor,'project_stage_'||p_action,'project_stage',s.id,CASE WHEN p_action<>'create' THEN to_jsonb(oldstage) END,CASE WHEN p_action<>'delete' THEN to_jsonb(s) END,jsonb_build_object('project_id',r.id));
  END IF;
 END IF;
 IF NOT(p_entity='project' AND p_action='delete') THEN
  IF NOT(p_entity='project' AND p_action='create') THEN UPDATE public.projects SET version=version+1 WHERE id=r.id;END IF;
  SELECT * INTO r FROM public.projects WHERE id=r.id;after_row:=public.bedos_project_projection(r,false,true);
 END IF;
 PERFORM public.bedos_catalog_audit(p_actor,'project_'||p_entity||'_'||p_action,'project',r.id,before_row,after_row);
 RETURN coalesce(after_row,jsonb_build_object('deleted',true));
END;$f$;

CREATE FUNCTION public.bedos_project_media(p_actor uuid,p_action text,p_project uuid DEFAULT NULL,p_media uuid DEFAULT NULL,
 p_operation uuid DEFAULT NULL,p_version integer DEFAULT NULL,p_input jsonb DEFAULT '{}',p_key uuid DEFAULT NULL,p_proof jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.projects;o public.project_media_operations;oldop jsonb;before_row jsonb;data jsonb;m public.project_images;path text;selected_id uuid;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('reserve','finalize','status','delete','retry','complete','update','proof') THEN RAISE EXCEPTION 'Invalid image action' USING ERRCODE='22023';END IF;
 IF p_action='proof' THEN
  IF p_actor IS NOT NULL THEN PERFORM public.bedos_project_actor(p_actor);END IF;
  SELECT * INTO r FROM public.projects WHERE id=p_project AND(p_actor IS NOT NULL OR status IN ('ongoing','completed'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found' USING ERRCODE='P0002';END IF;
  SELECT x.* INTO o FROM public.project_media_operations x JOIN public.project_images i ON i.id=x.media_id AND i.project_id=x.project_id WHERE x.project_id=r.id AND x.media_id=p_media AND x.state='ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'Image not found' USING ERRCODE='P0002';END IF;
  RETURN jsonb_build_object('bucket_id',o.bucket_id,'storage_path',o.storage_path,'mime',o.mime,'file_size',o.file_size,'sha256',o.sha256);
 END IF;
 PERFORM public.bedos_project_actor(p_actor,true,p_action='retry');
 IF p_action='reserve' THEN
  data:=public.bedos_project_input(p_input,'image',true);
  IF p_key IS NULL OR p_version IS NULL OR p_version<1 OR p_proof IS NULL OR jsonb_typeof(p_proof)<>'object'
  OR p_proof->>'mime' IS NULL OR p_proof->>'mime' NOT IN ('image/jpeg','image/png','image/webp') OR coalesce(p_proof->>'sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_proof->>'file_size','') !~ '^[1-9][0-9]{0,6}$' OR (p_proof->>'file_size')::integer>3145728 THEN RAISE EXCEPTION 'Invalid upload proof' USING ERRCODE='22023';END IF;
  -- Serializes replay keys even when callers supply different project IDs.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text||p_key::text,7));
  SELECT * INTO o FROM public.project_media_operations WHERE actor_id=p_actor AND idempotency_key=p_key;
  IF FOUND THEN
   IF o.bound_project_id IS DISTINCT FROM p_project OR o.request_version<>p_version OR o.input<>data OR o.mime<>p_proof->>'mime' OR o.sha256<>p_proof->>'sha256' OR o.file_size<>(p_proof->>'file_size')::integer THEN RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE='P0001';END IF;
   RETURN jsonb_build_object('operation',to_jsonb(o),'acquired',false);
  END IF;
  r:=public.bedos_project_lock(p_actor,p_project,p_version);
  IF (SELECT count(*) FROM public.project_media_operations WHERE bound_project_id=r.id AND state<>'deleted')>=100 THEN RAISE EXCEPTION 'Image limit reached' USING ERRCODE='P0001';END IF;
  before_row:=public.bedos_project_projection(r,false,true);
  path:=r.id::text||'/'||gen_random_uuid()::text||CASE p_proof->>'mime' WHEN 'image/jpeg' THEN '.jpg' WHEN 'image/png' THEN '.png' ELSE '.webp' END;
  INSERT INTO public.project_media_operations(project_id,bound_project_id,actor_id,idempotency_key,storage_path,mime,file_size,sha256,input,request_version)
  VALUES(r.id,r.id,p_actor,p_key,path,p_proof->>'mime',(p_proof->>'file_size')::integer,p_proof->>'sha256',data,p_version) RETURNING * INTO o;
  UPDATE public.projects SET version=version+1 WHERE id=r.id RETURNING * INTO r;
  PERFORM public.bedos_catalog_audit(p_actor,'project_image_reserved','project',r.id,before_row,public.bedos_project_projection(r,false,true),jsonb_build_object('operation_id',o.id,'media_id',o.media_id));
  PERFORM public.bedos_catalog_audit(p_actor,'project_media_reserved','project_media_operation',o.id,NULL,to_jsonb(o));
  RETURN jsonb_build_object('operation',to_jsonb(o),'acquired',true);
 END IF;
 IF p_action IN ('delete','update') THEN
  r:=public.bedos_project_lock(p_actor,p_project,p_version);
  SELECT * INTO o FROM public.project_media_operations WHERE project_id=r.id AND media_id=p_media FOR UPDATE;
 ELSE
  SELECT * INTO o FROM public.project_media_operations WHERE id=p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE='P0002';END IF;
  IF p_action IN ('status','finalize') AND o.actor_id<>p_actor THEN RAISE EXCEPTION 'Operation not found' USING ERRCODE='P0002';END IF;
  -- Lock parent before operation consistently with all other image mutations.
  SELECT * INTO r FROM public.projects WHERE id=o.project_id FOR UPDATE;
  SELECT * INTO o FROM public.project_media_operations WHERE id=p_operation FOR UPDATE;
 END IF;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Image not found' USING ERRCODE='P0002';END IF;
 oldop:=to_jsonb(o);
 IF p_action='status' THEN RETURN to_jsonb(o);END IF;
 before_row:=CASE WHEN r.id IS NOT NULL THEN public.bedos_project_projection(r,false,true) END;
 IF p_action='update' THEN
  IF o.state<>'ready' THEN RAISE EXCEPTION 'Image not ready' USING ERRCODE='P0001';END IF;
  data:=public.bedos_project_input(p_input,'image');
  SELECT * INTO m FROM public.project_images WHERE id=o.media_id AND project_id=r.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Image not found' USING ERRCODE='P0002';END IF;
  m:=jsonb_populate_record(m,data);
  IF m.is_primary THEN UPDATE public.project_images SET is_primary=false WHERE project_id=r.id AND id<>m.id;END IF;
  UPDATE public.project_images SET phase=m.phase,alt_text=m.alt_text,display_order=m.display_order,is_primary=m.is_primary WHERE id=m.id;
 ELSIF p_action='finalize' THEN
  IF r.id IS NULL OR o.state<>'upload_pending' OR o.version IS DISTINCT FROM p_version OR o.lease_token::text IS DISTINCT FROM p_proof->>'lease_token' OR o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Upload lease changed' USING ERRCODE='P0001';END IF;
  IF coalesce((o.input->>'is_primary')::boolean,false) THEN UPDATE public.project_images SET is_primary=false WHERE project_id=r.id;END IF;
  INSERT INTO public.project_images(id,project_id,storage_path,phase,alt_text,display_order,is_primary)
  VALUES(o.media_id,r.id,o.storage_path,o.input->>'phase',o.input->>'alt_text',coalesce((o.input->>'display_order')::integer,0),coalesce((o.input->>'is_primary')::boolean,false));
  UPDATE public.project_media_operations SET state='ready',version=version+1,lease_until=clock_timestamp(),updated_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
 ELSIF p_action IN ('delete','retry') THEN
  IF o.state='deleted' THEN RETURN jsonb_build_object('operation',to_jsonb(o),'acquired',false);END IF;
  IF p_action='retry' AND o.state='ready' THEN RAISE EXCEPTION 'Ready image requires explicit delete' USING ERRCODE='P0001';END IF;
  IF p_action='retry' AND o.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('operation',to_jsonb(o),'acquired',false);END IF;
  IF p_action='delete' AND o.state<>'ready' THEN RAISE EXCEPTION 'Use controlled recovery for pending image' USING ERRCODE='P0001';END IF;
  DELETE FROM public.project_images WHERE id=o.media_id AND project_id=r.id;
  UPDATE public.project_media_operations SET state='cleanup_pending',version=version+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
 ELSIF p_action='complete' THEN
  IF o.state<>'cleanup_pending' OR o.version IS DISTINCT FROM p_version OR o.lease_token::text IS DISTINCT FROM p_proof->>'lease_token' OR o.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Cleanup lease changed' USING ERRCODE='P0001';END IF;
  UPDATE public.project_media_operations SET state='deleted',version=version+1,lease_until=clock_timestamp(),updated_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
 END IF;
 IF r.id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.project_images WHERE project_id=r.id AND is_primary) THEN
   SELECT id INTO selected_id FROM public.project_images WHERE project_id=r.id ORDER BY display_order,created_at,id LIMIT 1;
   UPDATE public.project_images SET is_primary=true WHERE id=selected_id;
  END IF;
  UPDATE public.projects SET version=version+1 WHERE id=r.id RETURNING * INTO r;
  PERFORM public.bedos_catalog_audit(p_actor,'project_image_'||p_action,'project',r.id,before_row,public.bedos_project_projection(r,false,true),jsonb_build_object('operation_id',o.id,'media_id',o.media_id));
 END IF;
 IF p_action<>'update' THEN PERFORM public.bedos_catalog_audit(p_actor,'project_media_'||p_action,'project_media_operation',o.id,oldop,to_jsonb(o));END IF;
 IF p_action IN ('delete','retry') THEN RETURN jsonb_build_object('operation',to_jsonb(o),'acquired',true);END IF;
 RETURN jsonb_build_object('operation',to_jsonb(o),'project_version',r.version);
END;$f$;

REVOKE ALL ON FUNCTION public.bedos_project_actor(uuid,boolean,boolean),public.bedos_project_input(jsonb,text,boolean),public.bedos_project_lock(uuid,uuid,integer),public.bedos_project_projection(public.projects,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.bedos_project_read(uuid,text,uuid,text,jsonb),public.bedos_project_mutate(uuid,text,text,uuid,uuid,integer,jsonb),public.bedos_project_media(uuid,text,uuid,uuid,uuid,integer,jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_project_read(uuid,text,uuid,text,jsonb),public.bedos_project_mutate(uuid,text,text,uuid,uuid,integer,jsonb),public.bedos_project_media(uuid,text,uuid,uuid,uuid,integer,jsonb,uuid,jsonb) TO service_role;
COMMIT;
