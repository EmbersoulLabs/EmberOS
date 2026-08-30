-- Sprint 4 Phase B2 — Platform Administration persistence.
-- Platform-scoped (not workspace-tenant). Append-only grants/revocations/audit.
-- No UPDATE/DELETE product paths except grant status materialization on revoke.

CREATE TABLE IF NOT EXISTS platform_admin_grants (
  platform_admin_assignment_id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  platform_role TEXT NOT NULL
    CHECK (platform_role = 'PLATFORM_SUPER_ADMIN'),
  status TEXT NOT NULL
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  granted_at TIMESTAMPTZ NOT NULL,
  granted_by_user_id UUID NULL,
  reason TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  assignment JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_grants_integrity_unique UNIQUE (integrity_hash)
);

-- At most one ACTIVE grant per (user_id, platform_role).
CREATE UNIQUE INDEX IF NOT EXISTS platform_admin_grants_active_user_role_uidx
  ON platform_admin_grants (user_id, platform_role)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS platform_admin_grants_user_idx
  ON platform_admin_grants (user_id, granted_at DESC);

CREATE INDEX IF NOT EXISTS platform_admin_grants_status_idx
  ON platform_admin_grants (status, granted_at DESC);

CREATE TABLE IF NOT EXISTS platform_admin_revocations (
  platform_admin_revocation_id UUID PRIMARY KEY,
  platform_admin_assignment_id UUID NOT NULL
    REFERENCES platform_admin_grants(platform_admin_assignment_id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  platform_role TEXT NOT NULL
    CHECK (platform_role = 'PLATFORM_SUPER_ADMIN'),
  revoked_at TIMESTAMPTZ NOT NULL,
  revoked_by_user_id UUID NOT NULL,
  reason TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  revocation JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_admin_revocations_integrity_unique UNIQUE (integrity_hash),
  -- One revocation fact per assignment.
  CONSTRAINT platform_admin_revocations_assignment_unique UNIQUE (platform_admin_assignment_id)
);

CREATE INDEX IF NOT EXISTS platform_admin_revocations_user_idx
  ON platform_admin_revocations (user_id, revoked_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  admin_audit_event_id UUID PRIMARY KEY,
  command_id UUID NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('COMMAND_ACCEPTED', 'COMMAND_SUCCEEDED', 'COMMAND_FAILED')),
  command_status TEXT NOT NULL
    CHECK (command_status IN ('ACCEPTED', 'SUCCEEDED', 'FAILED')),
  actor_user_id UUID NOT NULL,
  platform_admin_assignment_id UUID NOT NULL
    REFERENCES platform_admin_grants(platform_admin_assignment_id) ON DELETE RESTRICT,
  platform_role TEXT NOT NULL
    CHECK (platform_role = 'PLATFORM_SUPER_ADMIN'),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  org_id UUID NULL,
  workspace_id UUID NULL,
  reason TEXT NOT NULL,
  before_reference JSONB NULL,
  after_reference JSONB NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  event JSONB NOT NULL,
  CONSTRAINT admin_audit_events_integrity_unique UNIQUE (integrity_hash)
);

-- Replay/idempotency convergence for identical audit acceptance.
CREATE UNIQUE INDEX IF NOT EXISTS admin_audit_events_command_event_uidx
  ON admin_audit_events (command_id, event_type);

CREATE UNIQUE INDEX IF NOT EXISTS admin_audit_events_idempotency_event_uidx
  ON admin_audit_events (idempotency_key, event_type, action);

CREATE INDEX IF NOT EXISTS admin_audit_events_actor_idx
  ON admin_audit_events (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_events_assignment_idx
  ON admin_audit_events (platform_admin_assignment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_events_org_idx
  ON admin_audit_events (org_id, created_at DESC)
  WHERE org_id IS NOT NULL;
