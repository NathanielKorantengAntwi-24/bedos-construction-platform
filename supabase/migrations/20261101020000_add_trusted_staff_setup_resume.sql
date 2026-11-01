-- Recover only newly created server-proven staff setup; legacy ambiguous users stay closed.
BEGIN;
CREATE FUNCTION public.bedos_setup_staff_invitation(
    p_user_id uuid,p_actor_id uuid,p_reason text,p_resume boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
    v_marker jsonb;
    v_email text;
    v_pending text;
    v_role_id uuid;
    v_role_name text;
    v_creator uuid;
    v_profile public.profiles%ROWTYPE;
    v_profile_role text;
    v_invitation public.staff_invitations%ROWTYPE;
    v_invitation_id uuid;
    v_reason text := pg_catalog.regexp_replace(p_reason,'^[[:space:]]+|[[:space:]]+$','','g');
    v_uuid_pattern text := '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$';
    v_repaired boolean;
    v_new_approval boolean;
BEGIN
    PERFORM 1 FROM public.profiles AS actor
    WHERE actor.id=p_actor_id AND actor.account_status='active' FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.profiles AS actor
        JOIN public.role_permissions AS rp ON rp.role_id=actor.role_id
        JOIN public.permissions AS permission ON permission.id=rp.permission_id
        WHERE actor.id=p_actor_id AND actor.account_status='active' AND permission.name='users.manage'
    ) THEN RAISE EXCEPTION 'Staff setup authorization denied' USING ERRCODE='42501'; END IF;
    IF p_user_id=p_actor_id THEN RAISE EXCEPTION 'Self staff setup denied' USING ERRCODE='42501'; END IF;
    IF p_user_id IS NULL OR p_resume IS NULL OR v_reason IS NULL OR v_reason='' OR pg_catalog.char_length(v_reason)>500 THEN
        RAISE EXCEPTION 'Invalid staff setup request' USING ERRCODE='22023';
    END IF;
    SELECT u.raw_app_meta_data->'bedos_staff_invitation',u.email,u.raw_user_meta_data->>'bedos_staff_onboarding_pending'
      INTO v_marker,v_email,v_pending FROM auth.users AS u WHERE u.id=p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
    -- Only Auth admin app_metadata is provenance. user_metadata never supplies approval.
    IF pg_catalog.jsonb_typeof(v_marker) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(v_marker->'version') IS DISTINCT FROM 'number'
       OR v_marker->>'version' IS DISTINCT FROM '1'
       OR COALESCE(v_marker->>'request_id','') !~* v_uuid_pattern
       OR COALESCE(v_marker->>'requested_role_id','') !~* v_uuid_pattern
       OR COALESCE(v_marker->>'created_by','') !~* v_uuid_pattern
       OR pg_catalog.jsonb_typeof(v_marker->'email') IS DISTINCT FROM 'string'
       OR pg_catalog.lower(pg_catalog.btrim(v_marker->>'email')) IS DISTINCT FROM v_email
       OR pg_catalog.jsonb_typeof(v_marker->'full_name') IS DISTINCT FROM 'string'
       OR pg_catalog.btrim(v_marker->>'full_name')='' OR pg_catalog.char_length(v_marker->>'full_name')>200
       OR COALESCE(pg_catalog.jsonb_typeof(v_marker->'phone'),'null') NOT IN ('null','string')
       OR pg_catalog.char_length(v_marker->>'phone')>40 THEN
        RAISE EXCEPTION 'Trusted staff creation proof required' USING ERRCODE='42501';
    END IF;
    v_role_id:=(v_marker->>'requested_role_id')::uuid;
    v_creator:=(v_marker->>'created_by')::uuid;
    IF v_creator=p_user_id THEN RAISE EXCEPTION 'Invalid staff creation proof' USING ERRCODE='42501'; END IF;
    SELECT r.name INTO v_role_name FROM public.roles AS r WHERE r.id=v_role_id;
    IF v_role_name IS NULL OR v_role_name NOT IN ('content_manager','finance','sales_customer_service') THEN
        RAISE EXCEPTION 'Creation role is not eligible' USING ERRCODE='42501';
    END IF;
    IF v_pending IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Staff pending state changed' USING ERRCODE='P0001';
    END IF;
    SELECT r.name INTO v_profile_role FROM public.profiles p LEFT JOIN public.roles r ON r.id=p.role_id WHERE p.id=p_user_id;
    IF v_profile_role='administrator' THEN RAISE EXCEPTION 'Administrator setup denied' USING ERRCODE='42501'; END IF;
    -- Serialize missing-row creation before invitation/profile locks. Lifecycle RPCs
    -- retain their existing actor -> invitation -> profile ordering and need no new lock.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bedos.staff.setup:'||p_user_id::text,0));
    SELECT si.* INTO v_invitation FROM public.staff_invitations si WHERE si.user_id=p_user_id FOR UPDATE;
    SELECT p.* INTO v_profile FROM public.profiles p WHERE p.id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff profile requires controlled review' USING ERRCODE='P0001'; END IF;
    SELECT r.name INTO v_profile_role FROM public.roles r WHERE r.id=v_profile.role_id;
    IF v_profile_role='administrator' THEN RAISE EXCEPTION 'Administrator setup denied' USING ERRCODE='42501'; END IF;
    IF v_profile.account_status<>'inactive' OR
       (v_profile.role_id IS DISTINCT FROM v_role_id AND v_profile_role IS DISTINCT FROM 'customer') THEN
        RAISE EXCEPTION 'Staff profile is not eligible for setup' USING ERRCODE='P0001';
    END IF;
    IF v_invitation.id IS NOT NULL AND
       (v_invitation.status<>'pending' OR v_invitation.approved_role_id IS DISTINCT FROM v_role_id) THEN
        RAISE EXCEPTION 'Staff invitation is not eligible for setup' USING ERRCODE='P0001';
    END IF;
    v_new_approval:=v_invitation.id IS NULL;
    v_repaired:=v_new_approval OR v_profile.role_id IS DISTINCT FROM v_role_id;
    IF v_repaired THEN
        UPDATE public.profiles SET full_name=v_marker->>'full_name',phone=v_marker->>'phone',
          role_id=v_role_id,account_status='inactive',updated_at=pg_catalog.now() WHERE id=p_user_id;
    END IF;
    IF v_new_approval THEN
        v_invitation_id:=public.bedos_authorize_staff_invitation(p_user_id,p_actor_id,v_role_id);
    ELSE
        v_invitation_id:=v_invitation.id;
    END IF;
    IF p_resume THEN
        INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,description,metadata)
        VALUES(p_actor_id,'staff_invitation_setup_resumed','user',p_user_id,
          'Administrator rechecked or repaired staff invitation setup.',pg_catalog.jsonb_build_object(
          'invitation_id',v_invitation_id,'request_id',v_marker->>'request_id','original_creator',v_creator,
          'approved_role_id',v_role_id,'new_approval',v_new_approval,'profile_repaired',v_repaired,'reason',v_reason));
    END IF;
    RETURN v_invitation_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.bedos_setup_staff_invitation(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_setup_staff_invitation(uuid,uuid,text,boolean) TO service_role;
COMMIT;
