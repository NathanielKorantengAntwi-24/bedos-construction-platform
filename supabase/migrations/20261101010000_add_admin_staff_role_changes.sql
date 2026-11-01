-- Ordinary staff role changes only. No administrator/customer conversion.
BEGIN;
CREATE FUNCTION public.bedos_update_user_role(
    p_actor_id uuid,p_user_id uuid,p_role_id uuid,p_expected_role_id uuid,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
    v_profile public.profiles%ROWTYPE;
    v_invitation public.staff_invitations%ROWTYPE;
    v_previous_role text;
    v_role_name text;
    v_reason text := pg_catalog.regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
BEGIN
    -- Shared lock order with activation/revocation/status: actor, invitation, target.
    PERFORM 1 FROM public.profiles AS actor
    WHERE actor.id=p_actor_id AND actor.account_status='active' FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.profiles AS actor
        JOIN public.role_permissions AS rp ON rp.role_id=actor.role_id
        JOIN public.permissions AS permission ON permission.id=rp.permission_id
        WHERE actor.id=p_actor_id AND actor.account_status='active' AND permission.name='users.manage'
    ) THEN
        RAISE EXCEPTION 'Account role authorization denied' USING ERRCODE='42501';
    END IF;
    IF p_actor_id=p_user_id THEN
        RAISE EXCEPTION 'Self role changes denied' USING ERRCODE='42501';
    END IF;
    IF p_user_id IS NULL OR p_role_id IS NULL OR p_expected_role_id IS NULL
       OR v_reason IS NULL OR v_reason='' OR pg_catalog.char_length(v_reason)>500 THEN
        RAISE EXCEPTION 'Invalid account role request' USING ERRCODE='22023';
    END IF;
    SELECT r.name INTO v_role_name FROM public.roles AS r WHERE r.id=p_role_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid requested role' USING ERRCODE='22023';
    END IF;
    IF v_role_name NOT IN ('content_manager','finance','sales_customer_service') THEN
        RAISE EXCEPTION 'Requested role is protected' USING ERRCODE='42501';
    END IF;
    SELECT p.* INTO v_profile FROM public.profiles AS p WHERE p.id=p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
    SELECT r.name INTO v_previous_role FROM public.roles AS r WHERE r.id=v_profile.role_id;
    IF v_previous_role IN ('administrator','customer') THEN
        RAISE EXCEPTION 'Target role is protected' USING ERRCODE='42501';
    END IF;
    SELECT si.* INTO v_invitation FROM public.staff_invitations AS si
    WHERE si.user_id=p_user_id FOR UPDATE;
    SELECT p.* INTO v_profile FROM public.profiles AS p WHERE p.id=p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
    SELECT r.name INTO v_previous_role FROM public.roles AS r WHERE r.id=v_profile.role_id;
    IF v_previous_role IN ('administrator','customer') THEN
        RAISE EXCEPTION 'Target role is protected' USING ERRCODE='42501';
    END IF;
    IF v_profile.account_status<>'active' OR v_profile.role_id IS DISTINCT FROM p_expected_role_id
       OR v_profile.role_id=p_role_id OR v_previous_role IS NULL
       OR v_previous_role NOT IN ('content_manager','finance','sales_customer_service')
       OR v_invitation.id IS NULL OR v_invitation.status<>'activated'
       OR v_invitation.approved_role_id IS DISTINCT FROM v_profile.role_id THEN
        RAISE EXCEPTION 'Stale or ineligible account role transition' USING ERRCODE='P0001';
    END IF;
    UPDATE public.profiles SET role_id=p_role_id,updated_at=pg_catalog.now() WHERE id=p_user_id;
    -- Keep current onboarding proof consistent; original approval remains in audit history.
    UPDATE public.staff_invitations SET approved_role_id=p_role_id WHERE id=v_invitation.id;
    INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,description,metadata)
    VALUES(p_actor_id,'staff_role_changed','user',p_user_id,'Administrator changed ordinary staff role.',
        pg_catalog.jsonb_build_object('previous_role_id',v_profile.role_id,'previous_role_name',v_previous_role,
          'role_id',p_role_id,'role_name',v_role_name,'invitation_id',v_invitation.id,'reason',v_reason));
    RETURN pg_catalog.jsonb_build_object('user_id',p_user_id,'role',pg_catalog.jsonb_build_object('id',p_role_id,'name',v_role_name));
END;
$function$;
REVOKE ALL ON FUNCTION public.bedos_update_user_role(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_update_user_role(uuid,uuid,uuid,uuid,text) TO service_role;
COMMIT;
