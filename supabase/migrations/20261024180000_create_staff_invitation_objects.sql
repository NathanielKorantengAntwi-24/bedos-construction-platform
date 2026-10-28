-- BEDOS MODULE 2 - STAFF INVITATION DATABASE OBJECTS
-- DRAFT ONLY: NOT YET TESTED OR APPROVED FOR PRODUCTION

BEGIN;

-- Staff invitation table, constraints, indexes and RLS.
CREATE TABLE public.staff_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    invited_by uuid NOT NULL,
    approved_role_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    activated_by uuid,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    password_baseline_digest text,
    password_baseline_recorded_at timestamp with time zone,
    retry_attempt_count integer DEFAULT 0 NOT NULL,
    last_retry_at timestamp with time zone,
    last_retry_method text,
    last_retry_completed_at timestamp with time zone,
    last_retry_accepted boolean,
    CONSTRAINT staff_invitation_activation_consistency CHECK ((((status = 'activated'::text) AND (activated_at IS NOT NULL) AND (activated_by IS NOT NULL)) OR ((status <> 'activated'::text) AND (activated_at IS NULL) AND (activated_by IS NULL)))),
    CONSTRAINT staff_invitation_password_baseline_consistency CHECK (((password_baseline_digest IS NULL) = (password_baseline_recorded_at IS NULL))),
    CONSTRAINT staff_invitation_revocation_consistency CHECK ((((status = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL)) OR ((status <> 'revoked'::text) AND (revoked_at IS NULL) AND (revoked_by IS NULL)))),
    CONSTRAINT staff_invitations_last_retry_method_check CHECK ((last_retry_method = ANY (ARRAY['invite'::text, 'recovery'::text]))),
    CONSTRAINT staff_invitations_retry_attempt_count_check CHECK ((retry_attempt_count >= 0)),
    CONSTRAINT staff_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'activated'::text, 'revoked'::text])))
);


--
-- Name: staff_invitations staff_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_pkey PRIMARY KEY (id);


--
-- Name: staff_invitations staff_invitations_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_user_id_key UNIQUE (user_id);


--
-- Name: staff_invitations_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_invitations_status_created_idx ON public.staff_invitations USING btree (status, created_at);


--
-- Name: staff_invitations staff_invitations_activated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES public.profiles(id);


--
-- Name: staff_invitations staff_invitations_approved_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_approved_role_id_fkey FOREIGN KEY (approved_role_id) REFERENCES public.roles(id);


--
-- Name: staff_invitations staff_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id);


--
-- Name: staff_invitations staff_invitations_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.profiles(id);


--
-- Name: staff_invitations staff_invitations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_invitations
    ADD CONSTRAINT staff_invitations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: staff_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

-- Staff invitation RPC definitions.
CREATE OR REPLACE FUNCTION public.bedos_activate_staff_invitation(p_user_id uuid, p_actor_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_invitation_id uuid;
    v_role_id uuid;
    v_role_name text;
    v_profile_id uuid;
BEGIN
    IF p_user_id IS NULL OR p_actor_id IS NULL OR p_user_id = p_actor_id THEN
        RAISE EXCEPTION 'Invalid staff activation identifiers'
            USING ERRCODE = '22023';
    END IF;

    -- Lock the acting administrator while revalidating privileges.
    PERFORM 1 FROM public.profiles AS actor
    WHERE actor.id = p_actor_id AND actor.account_status = 'active'
    FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1
        FROM public.profiles AS actor
        JOIN public.role_permissions AS rp ON rp.role_id = actor.role_id
        JOIN public.permissions AS permission ON permission.id = rp.permission_id
        WHERE actor.id = p_actor_id
          AND actor.account_status = 'active'
          AND permission.name = 'users.manage'
    ) THEN
        RAISE EXCEPTION 'Staff activation authorization denied'
            USING ERRCODE = '42501';
    END IF;

    -- Serializes competing activation and revocation requests.
    SELECT si.id, si.approved_role_id
      INTO v_invitation_id, v_role_id
    FROM public.staff_invitations AS si
    WHERE si.user_id = p_user_id AND si.status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending staff invitation not found'
            USING ERRCODE = '22023';
    END IF;

    SELECT r.name INTO v_role_name
    FROM public.roles AS r WHERE r.id = v_role_id;

    IF v_role_name IS NULL OR v_role_name NOT IN (
        'content_manager', 'finance', 'sales_customer_service'
    ) THEN
        RAISE EXCEPTION 'Invitation role is not eligible for activation'
            USING ERRCODE = '22023';
    END IF;

    -- Email ownership and a real password change after invitation are required.
    IF NOT EXISTS (
        SELECT 1 FROM auth.users AS u
        WHERE u.id = p_user_id
          AND u.email_confirmed_at IS NOT NULL
          AND COALESCE(u.encrypted_password, '') <> ''
          AND EXISTS (
              SELECT 1 FROM public.staff_invitations AS proof
              WHERE proof.id = v_invitation_id
                AND proof.status = 'pending'
                AND proof.password_baseline_digest IS NOT NULL
                AND pg_catalog.md5(COALESCE(u.encrypted_password, '')::text)
                    <> proof.password_baseline_digest
          )
    ) THEN
        RAISE EXCEPTION 'Invited user has not finished email and password setup'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.profiles AS target
    SET account_status = 'active', updated_at = pg_catalog.now()
    WHERE target.id = p_user_id
      AND target.account_status = 'inactive'
      AND target.role_id = v_role_id
    RETURNING target.id INTO v_profile_id;

    IF v_profile_id IS NULL THEN
        RAISE EXCEPTION 'Invited profile is not eligible for activation'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.staff_invitations
    SET status = 'activated', activated_at = pg_catalog.now(),
        activated_by = p_actor_id
    WHERE id = v_invitation_id AND status = 'pending';

    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, description, metadata
    ) VALUES (
        p_actor_id, 'staff_invitation_activated', 'user', p_user_id,
        'Administrator activated invited staff account.',
        pg_catalog.jsonb_build_object(
            'invitation_id', v_invitation_id,
            'approved_role_id', v_role_id,
            'approved_role_name', v_role_name
        )
    );

    RETURN v_invitation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bedos_authorize_staff_invitation(p_user_id uuid, p_invited_by uuid, p_approved_role_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_role_name text;
    v_invitation_id uuid;
BEGIN
    -- Reject missing identifiers and self-invitations.
    IF p_user_id IS NULL
       OR p_invited_by IS NULL
       OR p_approved_role_id IS NULL
       OR p_user_id = p_invited_by
    THEN
        RAISE EXCEPTION 'Invalid staff invitation identifiers'
            USING ERRCODE = '22023';
    END IF;

    -- Verify administrator authorization using trusted database roles.
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles AS actor
        JOIN public.role_permissions AS rp
            ON rp.role_id = actor.role_id
        JOIN public.permissions AS permission
            ON permission.id = rp.permission_id
        WHERE actor.id = p_invited_by
          AND actor.account_status = 'active'
          AND permission.name = 'users.manage'
    ) THEN
        RAISE EXCEPTION 'Staff invitation authorization denied'
            USING ERRCODE = '42501';
    END IF;

    -- Restrict this workflow to approved ordinary staff roles.
    SELECT role.name
    INTO v_role_name
    FROM public.roles AS role
    WHERE role.id = p_approved_role_id;

    IF v_role_name IS NULL
       OR v_role_name NOT IN (
           'content_manager',
           'finance',
           'sales_customer_service'
       )
    THEN
        RAISE EXCEPTION 'Role is not eligible for staff invitation'
            USING ERRCODE = '22023';
    END IF;

    -- Lock and verify the target profile before recording approval.
    PERFORM 1
    FROM public.profiles AS target
    WHERE target.id = p_user_id
      AND target.account_status = 'inactive'
      AND target.role_id = p_approved_role_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target staff profile is not eligible'
            USING ERRCODE = '22023';
    END IF;

    -- Create the trusted invitation record.
    INSERT INTO public.staff_invitations (
        user_id,
        invited_by,
        approved_role_id,
        status
    )
    VALUES (
        p_user_id,
        p_invited_by,
        p_approved_role_id,
        'pending'
    )
    RETURNING id INTO v_invitation_id;

    -- Record administrator authorization in the same transaction.
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        description,
        metadata
    )
    VALUES (
        p_invited_by,
        'staff_invitation_authorized',
        'user',
        p_user_id,
        'Administrator authorized staff invitation.',
        pg_catalog.jsonb_build_object(
            'invitation_id', v_invitation_id,
            'approved_role_id', p_approved_role_id,
            'approved_role_name', v_role_name
        )
    );

    RETURN v_invitation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bedos_finish_staff_invitation_retry(p_user_id uuid, p_actor_id uuid, p_attempt_number integer, p_accepted boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_invitation_id uuid;
    v_method text;
BEGIN
    IF p_user_id IS NULL OR p_actor_id IS NULL OR p_accepted IS NULL
       OR p_attempt_number IS NULL OR p_attempt_number < 1
    THEN
        RAISE EXCEPTION 'Invalid staff invitation retry result'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.profiles AS actor
    WHERE actor.id = p_actor_id AND actor.account_status = 'active'
    FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.profiles AS actor
        JOIN public.role_permissions AS rp ON rp.role_id = actor.role_id
        JOIN public.permissions AS perm ON perm.id = rp.permission_id
        WHERE actor.id = p_actor_id AND actor.account_status = 'active'
          AND perm.name = 'users.manage'
    ) THEN
        RAISE EXCEPTION 'Retry result authorization denied'
            USING ERRCODE = '42501';
    END IF;

    -- May finish even if revoked while email dispatch was in flight.
    UPDATE public.staff_invitations AS si
    SET last_retry_completed_at = pg_catalog.now(),
        last_retry_accepted = p_accepted
    WHERE si.user_id = p_user_id
      AND si.retry_attempt_count = p_attempt_number
      AND si.last_retry_completed_at IS NULL
    RETURNING si.id, si.last_retry_method INTO v_invitation_id, v_method;

    IF v_invitation_id IS NULL THEN
        RAISE EXCEPTION 'Stale or already completed retry result'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, description, metadata
    ) VALUES (
        p_actor_id,
        CASE WHEN p_accepted THEN 'staff_invitation_retry_accepted'
             ELSE 'staff_invitation_retry_failed' END,
        'user', p_user_id,
        'Supabase Auth invitation recovery email request completed.',
        pg_catalog.jsonb_build_object(
            'invitation_id', v_invitation_id,
            'attempt_number', p_attempt_number,
            'method', v_method,
            'accepted_by_auth', p_accepted
        )
    );

    RETURN v_invitation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bedos_prepare_staff_invitation_retry(p_user_id uuid, p_actor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_invitation public.staff_invitations%ROWTYPE;
    v_email text;
    v_confirmed boolean;
    v_method text;
    v_attempt integer;
BEGIN
    IF p_user_id IS NULL OR p_actor_id IS NULL OR p_user_id = p_actor_id THEN
        RAISE EXCEPTION 'Invalid staff invitation retry identifiers'
            USING ERRCODE = '22023';
    END IF;

    -- Lock actor and revalidate permission in the database, not merely in the API.
    PERFORM 1 FROM public.profiles AS actor
    WHERE actor.id = p_actor_id AND actor.account_status = 'active'
    FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.profiles AS actor
        JOIN public.role_permissions AS rp ON rp.role_id = actor.role_id
        JOIN public.permissions AS perm ON perm.id = rp.permission_id
        WHERE actor.id = p_actor_id AND actor.account_status = 'active'
          AND perm.name = 'users.manage'
    ) THEN
        RAISE EXCEPTION 'Staff invitation retry authorization denied'
            USING ERRCODE = '42501';
    END IF;

    -- Lock target invitation to serialize retries and competing activation/revocation.
    SELECT * INTO v_invitation
    FROM public.staff_invitations AS si
    WHERE si.user_id = p_user_id AND si.status = 'pending'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending invitation not eligible for retry'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles AS p
        JOIN public.roles AS r ON r.id = p.role_id
        WHERE p.id = p_user_id
          AND p.account_status = 'inactive'
          AND p.role_id = v_invitation.approved_role_id
          AND r.name IN ('content_manager', 'finance', 'sales_customer_service')
    ) THEN
        RAISE EXCEPTION 'Invited profile is not eligible for retry'
            USING ERRCODE = '22023';
    END IF;

    IF v_invitation.last_retry_at IS NOT NULL
       AND v_invitation.last_retry_at > pg_catalog.now() - INTERVAL '60 seconds'
    THEN
        RAISE EXCEPTION 'Invitation retry cooldown in effect'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT u.email, (u.email_confirmed_at IS NOT NULL)
      INTO v_email, v_confirmed
    FROM auth.users AS u
    WHERE u.id = p_user_id
      AND u.raw_user_meta_data ->> 'bedos_staff_onboarding_pending' = 'true';
    IF v_email IS NULL OR pg_catalog.btrim(v_email) = '' THEN
        RAISE EXCEPTION 'Invited Auth user is not eligible for retry'
            USING ERRCODE = '22023';
    END IF;

    v_method := CASE WHEN v_confirmed THEN 'recovery' ELSE 'invite' END;
    v_attempt := v_invitation.retry_attempt_count + 1;

    -- A baseline must exist BEFORE a new email is requested. Never overwrite it.
    -- This requires a subsequent password change before activation.
    UPDATE public.staff_invitations AS si
    SET password_baseline_digest = COALESCE(
            si.password_baseline_digest,
            (SELECT pg_catalog.md5(COALESCE(u.encrypted_password, '')::text)
             FROM auth.users AS u WHERE u.id = p_user_id)
        ),
        password_baseline_recorded_at = COALESCE(
            si.password_baseline_recorded_at,
            pg_catalog.now()
        ),
        retry_attempt_count = v_attempt,
        last_retry_at = pg_catalog.now(),
        last_retry_method = v_method,
        last_retry_completed_at = NULL,
        last_retry_accepted = NULL
    WHERE si.id = v_invitation.id;

    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, description, metadata
    ) VALUES (
        p_actor_id, 'staff_invitation_retry_requested', 'user', p_user_id,
        'Administrator requested a staff onboarding email retry.',
        pg_catalog.jsonb_build_object(
            'invitation_id', v_invitation.id,
            'attempt_number', v_attempt,
            'method', v_method
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'invitation_id', v_invitation.id,
        'user_id', p_user_id,
        'email', v_email,
        'method', v_method,
        'attempt_number', v_attempt
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.bedos_record_staff_invitation_password_baseline(p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_invitation_id uuid;
    v_role_id uuid;
    v_digest text;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Missing invitation user ID' USING ERRCODE = '22023';
    END IF;

    SELECT si.id, si.approved_role_id
      INTO v_invitation_id, v_role_id
      FROM public.staff_invitations AS si
      WHERE si.user_id = p_user_id
        AND si.status = 'pending'
        AND si.password_baseline_digest IS NULL
      FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending invitation is not eligible for password baseline'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles AS p
        WHERE p.id = p_user_id
          AND p.account_status = 'inactive'
          AND p.role_id = v_role_id
    ) THEN
        RAISE EXCEPTION 'Invitation profile is not eligible'
            USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.md5(COALESCE(u.encrypted_password, '')::text)
      INTO v_digest
      FROM auth.users AS u
      WHERE u.id = p_user_id;

    IF v_digest IS NULL THEN
        RAISE EXCEPTION 'Invitation Auth user not found' USING ERRCODE = '22023';
    END IF;

    UPDATE public.staff_invitations
       SET password_baseline_digest = v_digest,
           password_baseline_recorded_at = pg_catalog.now()
     WHERE id = v_invitation_id;

    RETURN v_invitation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bedos_revoke_staff_invitation(p_user_id uuid, p_actor_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_invitation_id uuid;
    v_role_id uuid;
BEGIN
    IF p_user_id IS NULL OR p_actor_id IS NULL OR p_user_id = p_actor_id THEN
        RAISE EXCEPTION 'Invalid invitation revocation identifiers'
            USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.profiles AS actor
    WHERE actor.id = p_actor_id AND actor.account_status = 'active'
    FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1
        FROM public.profiles AS actor
        JOIN public.role_permissions AS rp ON rp.role_id = actor.role_id
        JOIN public.permissions AS permission ON permission.id = rp.permission_id
        WHERE actor.id = p_actor_id
          AND actor.account_status = 'active'
          AND permission.name = 'users.manage'
    ) THEN
        RAISE EXCEPTION 'Invitation revocation authorization denied'
            USING ERRCODE = '42501';
    END IF;

    SELECT si.id, si.approved_role_id
      INTO v_invitation_id, v_role_id
    FROM public.staff_invitations AS si
    WHERE si.user_id = p_user_id AND si.status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pending staff invitation not found'
            USING ERRCODE = '22023';
    END IF;

    -- Do not revoke an already active staff account using an invitation route.
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles AS target
        WHERE target.id = p_user_id
          AND target.account_status = 'inactive'
          AND target.role_id = v_role_id
    ) THEN
        RAISE EXCEPTION 'Invited profile is not eligible for revocation'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.staff_invitations
    SET status = 'revoked', revoked_at = pg_catalog.now(),
        revoked_by = p_actor_id
    WHERE id = v_invitation_id AND status = 'pending';

    INSERT INTO public.audit_logs (
        actor_id, action, entity_type, entity_id, description, metadata
    ) VALUES (
        p_actor_id, 'staff_invitation_revoked', 'user', p_user_id,
        'Administrator revoked a pending staff invitation.',
        pg_catalog.jsonb_build_object(
            'invitation_id', v_invitation_id,
            'approved_role_id', v_role_id
        )
    );

    RETURN v_invitation_id;
END;
$function$;

-- Restrict staff invitation table access.
REVOKE ALL ON TABLE public.staff_invitations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.staff_invitations TO service_role;

-- Restrict SECURITY DEFINER function execution.
REVOKE ALL ON FUNCTION public.bedos_activate_staff_invitation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_activate_staff_invitation(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.bedos_authorize_staff_invitation(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_authorize_staff_invitation(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.bedos_finish_staff_invitation_retry(uuid, uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_finish_staff_invitation_retry(uuid, uuid, integer, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.bedos_prepare_staff_invitation_retry(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_prepare_staff_invitation_retry(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.bedos_record_staff_invitation_password_baseline(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_record_staff_invitation_password_baseline(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.bedos_revoke_staff_invitation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_revoke_staff_invitation(uuid, uuid) TO service_role;

COMMIT;
