BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public.projects,public.project_stages,public.project_images,public.project_media_operations IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF to_regprocedure('public.bedos_project_media(uuid,text,uuid,uuid,uuid,integer,jsonb,uuid,jsonb)') IS NULL THEN RAISE EXCEPTION 'Construction backend prerequisite missing';END IF;
 IF EXISTS(SELECT 1 FROM public.project_images i WHERE NOT EXISTS(SELECT 1 FROM public.project_media_operations o WHERE o.media_id=i.id AND o.project_id=i.project_id AND o.storage_path=i.storage_path AND o.state='ready')) THEN RAISE EXCEPTION 'Untracked project image';END IF;
 IF EXISTS(SELECT 1 FROM storage.objects s WHERE s.bucket_id='project-images' AND NOT EXISTS(SELECT 1 FROM public.project_media_operations o WHERE o.bucket_id=s.bucket_id AND o.storage_path=s.name AND o.state<>'deleted')) THEN RAISE EXCEPTION 'Untracked project object';END IF;
END;$guard$;
REVOKE ALL ON public.projects,public.project_stages,public.project_images,public.project_categories,public.project_services,public.project_media_operations FROM PUBLIC,anon,authenticated,service_role;
DO $guard$ DECLARE tab text;role_name text;BEGIN
 FOREACH tab IN ARRAY ARRAY['projects','project_stages','project_images','project_categories','project_services','project_media_operations'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_table_privilege(role_name,'public.'||tab,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(role_name,'public.'||tab,'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Residual project privilege';END IF;
  END LOOP;
 END LOOP;
END;$guard$;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_images ENABLE ROW LEVEL SECURITY;
UPDATE storage.buckets SET public=false,file_size_limit=3145728,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'] WHERE id='project-images';
CREATE POLICY bedos_project_storage_backend_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
 USING(bucket_id<>'project-images') WITH CHECK(bucket_id<>'project-images');
NOTIFY pgrst,'reload schema';
COMMIT;
