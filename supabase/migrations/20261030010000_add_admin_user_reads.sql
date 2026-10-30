-- Approved Module 2 list/detail scope only. No status or role mutations.
BEGIN;
CREATE FUNCTION public.bedos_read_users(
    p_actor_id uuid,
    p_user_id uuid DEFAULT NULL,
    p_page integer DEFAULT 1,
    p_limit integer DEFAULT 25,
    p_role text DEFAULT NULL,
    p_account_status text DEFAULT NULL,
    p_q text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
    v_pattern text;
    v_result jsonb;
BEGIN
    PERFORM 1 FROM public.profiles AS actor
    WHERE actor.id = p_actor_id AND actor.account_status = 'active' FOR SHARE;
    IF NOT FOUND OR NOT EXISTS (
        SELECT 1 FROM public.profiles AS actor
        JOIN public.role_permissions AS rp ON rp.role_id = actor.role_id
        JOIN public.permissions AS permission ON permission.id = rp.permission_id
        WHERE actor.id = p_actor_id AND actor.account_status = 'active'
          AND permission.name = 'users.view'
    ) THEN
        RAISE EXCEPTION 'User read authorization denied' USING ERRCODE = '42501';
    END IF;
    IF p_page IS NULL OR p_page < 1 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
       OR (p_role IS NOT NULL AND p_role NOT IN ('administrator','content_manager','finance','sales_customer_service','customer'))
       OR (p_account_status IS NOT NULL AND p_account_status NOT IN ('active','suspended','inactive'))
       OR pg_catalog.char_length(p_q) > 100 THEN
        RAISE EXCEPTION 'Invalid user query' USING ERRCODE = '22023';
    END IF;
    IF p_q IS NOT NULL AND pg_catalog.btrim(p_q) <> '' THEN
        v_pattern := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
            pg_catalog.btrim(p_q), pg_catalog.chr(92), pg_catalog.chr(92)||pg_catalog.chr(92)),
            '%', pg_catalog.chr(92)||'%'), '_', pg_catalog.chr(92)||'_') || '%';
    END IF;
    WITH filtered AS MATERIALIZED (
        SELECT p.id,p.created_at,
          pg_catalog.jsonb_build_object(
            'id',p.id,'email',u.email,'full_name',p.full_name,'phone',p.phone,
            'account_status',p.account_status,'created_at',p.created_at,'updated_at',p.updated_at,
            'role',CASE WHEN r.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object('id',r.id,'name',r.name) END
          ) || CASE WHEN p_user_id IS NULL THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object(
            'invitation',CASE WHEN si.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
              'status',si.status,'created_at',si.created_at,'activated_at',si.activated_at,'revoked_at',si.revoked_at
            ) END) END AS item
        FROM public.profiles AS p JOIN auth.users AS u ON u.id=p.id
        LEFT JOIN public.roles AS r ON r.id=p.role_id
        LEFT JOIN public.staff_invitations AS si ON si.user_id=p.id AND p_user_id IS NOT NULL
        WHERE (p_user_id IS NULL OR p.id=p_user_id)
          AND (p_role IS NULL OR r.name=p_role)
          AND (p_account_status IS NULL OR p.account_status=p_account_status)
          AND (v_pattern IS NULL OR p.full_name ILIKE v_pattern ESCAPE E'\\' OR u.email ILIKE v_pattern ESCAPE E'\\')
    ), paged AS (
        SELECT * FROM filtered ORDER BY created_at DESC,id DESC
        LIMIT p_limit OFFSET ((p_page::bigint-1)*p_limit)
    )
    SELECT CASE WHEN p_user_id IS NOT NULL THEN (SELECT item FROM filtered)
      ELSE pg_catalog.jsonb_build_object(
        'users',COALESCE((SELECT pg_catalog.jsonb_agg(item ORDER BY created_at DESC,id DESC) FROM paged),'[]'::jsonb),
        'page',p_page,'limit',p_limit,'total',(SELECT pg_catalog.count(*) FROM filtered)) END
      INTO v_result;
    RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.bedos_read_users(uuid,uuid,integer,integer,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bedos_read_users(uuid,uuid,integer,integer,text,text,text) TO service_role;
COMMIT;
