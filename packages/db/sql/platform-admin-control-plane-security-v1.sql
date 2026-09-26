-- Platform Administration and Organization roots are server-owned authority.
-- Browser clients use authenticated server routes; there is no direct Data API
-- contract for these tables. RLS plus revoked client grants is fail-closed.

ALTER TABLE public.platform_admin_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admin_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- These relations have no direct browser/Data API contract. Remove any stale
-- client policy left by an earlier schema generation before revoking grants.
DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'platform_admin_grants',
        'platform_admin_revocations',
        'admin_audit_events',
        'organizations',
        'organization_members'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END $$;

REVOKE ALL PRIVILEGES ON TABLE public.platform_admin_grants FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.platform_admin_revocations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.admin_audit_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.organizations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.organization_members FROM anon, authenticated;

-- No anon/authenticated policies remain. Trusted DATABASE_URL repositories
-- retain owner/server access; Platform Admin resolution never runs in the browser.
