-- Approved Module 2 suspension/restoration only. No role changes or onboarding activation.
BEGIN;
CREATE FUNCTION public.bedos_update_user_status(
    p_actor_id uuid,
    p_user_id uuid,
    p_account_status text,
    p_expected_account_status text,
    p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
    v_profile public.profiles%ROWTYPE;
    v_invitation public.staff_invitations%ROWTYPE;
    v_role_name text;
    v_reason text := pg_catalog.regexp_replace(p_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g');
BEGIN
    -- Same lock order as invitation transitions: actor, invitation, target profile.
    PERFORM 1 FROM public.profiles AS actor
    WHERE actor.id = p_actor_id AND actor.account_status = 'active' FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.profiles AS actor
        JOIN public.role_permissions AS rp ON rp.role_id = actor.role_id
        JOIN public.permissions AS permission ON permission.id = rp.permission_id
        WHERE actor.id = p_actor_id AND actor.account_status = 'active'
          AND permission.name = 'users.manage'
    ) THEN
        RAISE EXCEPTION 'Account status authorization denied' USING ERRCODE = '42501';
    END IF;
    IF p_user_id = p_actor_id THEN
        RAISE EXCEPTION 'Self account status changes denied' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NULL OR p_account_status IS NULL OR p_account_status NOT IN ('active','suspended')
       OR p_expected_account_status IS NULL OR p_expected_account_status NOT IN ('active','suspended','inactive')
       OR v_reason IS NULL OR v_reason = '' OR pg_catalog.char_length(v_reason) > 500 THEN
        RAISE EXCEPTION 'Invalid account status request' USING ERRCODE = '22023';
    END IF;
    -- Reject administrator targets before an exclusive lock to avoid administrator-to-administrator lock cycles.
    SELECT p.* INTO v_profile FROM public.profiles AS p WHERE p.id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT r.name INTO v_role_name FROM public.roles AS r WHERE r.id = v_profile.role_id;
    IF v_role_name = 'administrator' THEN
        RAISE EXCEPTION 'Administrator account changes denied' USING ERRCODE = '42501';
    END IF;
    SELECT si.* INTO v_invitation FROM public.staff_invitations AS si
    WHERE si.user_id = p_user_id FOR UPDATE;
    SELECT p.* INTO v_profile FROM public.profiles AS p WHERE p.id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT r.name INTO v_role_name FROM public.roles AS r WHERE r.id = v_profile.role_id;
    IF v_role_name = 'administrator' THEN
        RAISE EXCEPTION 'Administrator account changes denied' USING ERRCODE = '42501';
    END IF;
    IF v_profile.account_status <> p_expected_account_status
       OR v_profile.account_status NOT IN ('active','suspended')
       OR v_profile.account_status = p_account_status THEN
        RAISE EXCEPTION 'Stale or ineligible account status transition' USING ERRCODE = 'P0001';
    END IF;
    IF v_role_name = 'customer' THEN
        IF v_invitation.id IS NOT NULL THEN
            RAISE EXCEPTION 'Customer has incompatible invitation proof' USING ERRCODE = 'P0001';
        END IF;
        IF p_account_status = 'active' AND NOT EXISTS (
            SELECT 1 FROM auth.users AS u WHERE u.id = p_user_id AND u.email_confirmed_at IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'Customer email confirmation required' USING ERRCODE = 'P0001';
        END IF;
    ELSIF v_role_name IN ('content_manager','finance','sales_customer_service') THEN
        IF v_invitation.id IS NULL OR v_invitation.status <> 'activated'
           OR v_invitation.approved_role_id <> v_profile.role_id THEN
            RAISE EXCEPTION 'Activated staff onboarding proof required' USING ERRCODE = 'P0001';
        END IF;
    ELSE
        RAISE EXCEPTION 'Account role is ineligible' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.profiles SET account_status = p_account_status, updated_at = pg_catalog.now()
    WHERE id = p_user_id;
    INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,description,metadata)
    VALUES (p_actor_id,'user_account_status_changed','user',p_user_id,
        'Administrator changed account status.',pg_catalog.jsonb_build_object(
          'previous_account_status',v_profile.account_status,'account_status',p_account_status,
          'role_id',v_profile.role_id,'invitation_id',v_invitation.id,'reason',v_reason));
    RETURN pg_catalog.jsonb_build_object('user_id',p_user_id,'account_status',p_account_status);
END;
$function$;
REVOKE ALL ON FUNCTION public.bedos_update_user_status(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_update_user_status(uuid,uuid,text,text,text) TO service_role;
COMMIT;
