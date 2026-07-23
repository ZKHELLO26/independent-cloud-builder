-- ============================================================
-- ONEVIEW2_SETUP.sql — OneView 2.0 database setup. THE ONE FILE.
-- Supersedes every previous SQL file. Same database as before —
-- your existing data, clients and logins are untouched.
-- Run once. Safe to re-run. Delete all other saved snippets.
--
-- ONE EDIT: near the bottom replace  you@zeikonglobal.com
-- with YOUR dashboard login email (keep quotes). Then Run.
-- ============================================================

-- ─── 0. Base grants ─────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;

-- ─── 0b. Columns needed by the final dashboard ──────────────
ALTER TABLE public.scan_products  ADD COLUMN IF NOT EXISTS default_url text;
ALTER TABLE public.scan_links     ADD COLUMN IF NOT EXISTS fields jsonb;
ALTER TABLE public.dashboard_access ADD COLUMN IF NOT EXISTS email text;
UPDATE public.dashboard_access da SET email = u.email
FROM auth.users u WHERE u.id = da.user_id AND (da.email IS NULL OR da.email = '');

-- The special "landing page" product: one link that shows ALL the
-- client's enabled tools as tiles (like screening.auraehealth.in).
INSERT INTO public.scan_products (code, name, category, icon, color, active)
VALUES ('hub', 'Client landing page (all tools)', 'landing', '🧭', '#0ea5e9', true)
ON CONFLICT (code) DO NOTHING;

-- ─── 1. DROP every policy on our tables (clean slate) ───────
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'organizations','org_products','scan_products','scan_links',
        'dashboard_access','scan_submissions','scan_users',
        'employees_master','doctors_master','user_roles',
        'parameter_visibility','field_definitions','field_options',
        'org_field_visibility','scan_parameters'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- ─── 2. Helper functions ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.dashboard_access
                 WHERE user_id = auth.uid() AND role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.my_org()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_code FROM public.dashboard_access WHERE user_id = auth.uid() LIMIT 1;
$$;

-- IMPORTANT: COALESCE keeps the very first Alkem scans (recorded before
-- org tagging existed) visible. Lovable's version dropped this — that is
-- why older data could vanish.
CREATE OR REPLACE FUNCTION public.can_view_org(p_org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dashboard_access da
    WHERE da.user_id = auth.uid()
      AND (da.role = 'super_admin' OR da.org_code = COALESCE(p_org, 'ALKEM'))
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_org() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_org(text) TO authenticated;

-- ─── 3. Full policy set ─────────────────────────────────────
CREATE POLICY v10_access_read_own ON public.dashboard_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY v10_access_super_all ON public.dashboard_access
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE POLICY v10_org_super_all ON public.organizations
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY v10_org_client_read ON public.organizations
  FOR SELECT TO authenticated USING (code = public.my_org());

CREATE POLICY v10_orgprod_super_all ON public.org_products
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY v10_orgprod_client_read ON public.org_products
  FOR SELECT TO authenticated USING (org_code = public.my_org() AND enabled = true);

CREATE POLICY v10_prod_super_all ON public.scan_products
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY v10_prod_client_read ON public.scan_products
  FOR SELECT TO authenticated USING (active = true);

CREATE POLICY v10_links_super_all ON public.scan_links
  FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY v10_links_client_read ON public.scan_links
  FOR SELECT TO authenticated USING (org_code = public.my_org());

CREATE POLICY v10_scans_read ON public.scan_submissions
  FOR SELECT TO authenticated USING (public.can_view_org(org_code));
CREATE POLICY v10_emp_read ON public.employees_master
  FOR SELECT TO authenticated USING (public.can_view_org(org_code));
CREATE POLICY v10_doc_read ON public.doctors_master
  FOR SELECT TO authenticated USING (public.can_view_org(org_code));

CREATE POLICY v10_roles_read_own ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parameter_visibility','field_definitions','field_options','org_field_visibility','scan_parameters']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY v10_%s_super ON public.%I FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())', t, t);
      EXECUTE format('CREATE POLICY v10_%s_read ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    END IF;
  END LOOP;
END $$;

-- ─── 4. Link functions (now landing-page aware) ─────────────
CREATE OR REPLACE FUNCTION public.get_scan_link(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE l record; o record; v_tools jsonb;
BEGIN
  SELECT * INTO l FROM public.scan_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  SELECT * INTO o FROM public.organizations WHERE code = l.org_code;
  IF NOT l.active THEN RETURN jsonb_build_object('ok', false, 'reason', 'revoked'); END IF;
  IF o.active IS FALSE THEN RETURN jsonb_build_object('ok', false, 'reason', 'org_suspended'); END IF;
  IF l.expires_at IS NOT NULL AND l.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF l.max_scans IS NOT NULL AND l.used_scans >= l.max_scans THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quota_reached');
  END IF;

  -- The client's enabled tools, with each tool's resolved app URL
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', sp.code, 'name', sp.name, 'icon', sp.icon, 'color', sp.color,
           'url', COALESCE(op.scan_url, sp.default_url)
         ) ORDER BY sp.name), '[]'::jsonb)
    INTO v_tools
  FROM public.org_products op
  JOIN public.scan_products sp ON sp.code = op.product_code
  WHERE op.org_code = l.org_code AND op.enabled = true AND sp.active = true
    AND sp.code <> 'hub';

  RETURN jsonb_build_object(
    'ok', true,
    'token', l.token,
    'org_code', l.org_code,
    'org_name', COALESCE(o.name, l.org_code),
    'product_code', l.product_code,
    'is_hub', (l.product_code = 'hub'),
    'label', l.label,
    'fields', l.fields,
    'tools', v_tools
  );
END $$;
GRANT EXECUTE ON FUNCTION public.get_scan_link(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_scan_link(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  UPDATE public.scan_links
  SET used_scans = used_scans + 1
  WHERE token = p_token AND active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND (max_scans IS NULL OR used_scans < max_scans)
  RETURNING true INTO ok;
  RETURN COALESCE(ok, false);
END $$;
GRANT EXECUTE ON FUNCTION public.consume_scan_link(p_token text) TO anon, authenticated, service_role;

-- ─── 5. Re-assert YOUR super admin login ────────────────────
-- >>> CHANGE THE EMAIL BELOW, KEEP THE QUOTES <<<
INSERT INTO public.dashboard_access (user_id, role, org_code, email)
SELECT id, 'super_admin', NULL, email FROM auth.users
WHERE email = 'you@zeikonglobal.com'
ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin', org_code = NULL;

-- ─── 6. Proof it worked ─────────────────────────────────────
SELECT email, role, org_code FROM public.dashboard_access ORDER BY role;
