-- Sprint 4 Phase B3 — Commercial Persistence (provider-neutral).
-- Org-scoped. Service-write only. No Stripe SDK / webhook / checkout.

CREATE TABLE IF NOT EXISTS billing_accounts (
  billing_account_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  external_customer_reference TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  account JSONB NOT NULL,
  CONSTRAINT billing_accounts_org_unique UNIQUE (org_id),
  CONSTRAINT billing_accounts_integrity_unique UNIQUE (integrity_hash)
);

CREATE INDEX IF NOT EXISTS billing_accounts_org_idx
  ON billing_accounts (org_id);

CREATE TABLE IF NOT EXISTS subscription_events (
  subscription_event_id UUID PRIMARY KEY,
  billing_account_id UUID NOT NULL
    REFERENCES billing_accounts(billing_account_id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_provider TEXT NOT NULL,
  source_external_subscription_id TEXT NOT NULL,
  source_external_customer_id TEXT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  payload_digest TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  event JSONB NOT NULL,
  CONSTRAINT subscription_events_integrity_unique UNIQUE (integrity_hash),
  -- Unique provider-neutral source identity for one accepted event fact.
  CONSTRAINT subscription_events_source_unique UNIQUE (
    source_provider,
    source_external_subscription_id,
    event_type,
    payload_digest
  )
);

CREATE INDEX IF NOT EXISTS subscription_events_org_idx
  ON subscription_events (org_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS subscription_events_account_idx
  ON subscription_events (billing_account_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS subscription_projections (
  subscription_projection_id UUID PRIMARY KEY,
  billing_account_id UUID NOT NULL
    REFERENCES billing_accounts(billing_account_id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  status TEXT NOT NULL
    CHECK (status IN (
      'NONE','INCOMPLETE','TRIALING','ACTIVE','PAST_DUE','PAUSED','CANCELED','UNPAID','UNKNOWN'
    )),
  plan_key TEXT NULL,
  source_provider TEXT NULL,
  source_external_subscription_id TEXT NULL,
  source_external_customer_id TEXT NULL,
  current_period_start TIMESTAMPTZ NULL,
  current_period_end TIMESTAMPTZ NULL,
  projected_at TIMESTAMPTZ NOT NULL,
  source_event_id UUID NULL
    REFERENCES subscription_events(subscription_event_id) ON DELETE RESTRICT,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  projection JSONB NOT NULL,
  CONSTRAINT subscription_projections_account_unique UNIQUE (billing_account_id),
  CONSTRAINT subscription_projections_org_unique UNIQUE (org_id),
  CONSTRAINT subscription_projections_integrity_unique UNIQUE (integrity_hash)
);

CREATE INDEX IF NOT EXISTS subscription_projections_status_idx
  ON subscription_projections (status, projected_at DESC);

CREATE TABLE IF NOT EXISTS entitlement_grants (
  entitlement_grant_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  capability_key TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('PLAN','INTERNAL','SUPPORT','PROMOTIONAL')),
  source_reference TEXT NULL,
  reason TEXT NOT NULL,
  granted_by_user_id UUID NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  grant_body JSONB NOT NULL,
  CONSTRAINT entitlement_grants_integrity_unique UNIQUE (integrity_hash)
);

CREATE INDEX IF NOT EXISTS entitlement_grants_org_idx
  ON entitlement_grants (org_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS entitlement_grants_capability_idx
  ON entitlement_grants (org_id, capability_key, granted_at DESC);

CREATE TABLE IF NOT EXISTS entitlement_revocations (
  entitlement_revocation_id UUID PRIMARY KEY,
  entitlement_grant_id UUID NOT NULL
    REFERENCES entitlement_grants(entitlement_grant_id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  capability_key TEXT NOT NULL,
  source TEXT NOT NULL
    CHECK (source IN ('PLAN','INTERNAL','SUPPORT','PROMOTIONAL')),
  reason TEXT NOT NULL,
  revoked_by_user_id UUID NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  revocation JSONB NOT NULL,
  CONSTRAINT entitlement_revocations_integrity_unique UNIQUE (integrity_hash),
  CONSTRAINT entitlement_revocations_grant_unique UNIQUE (entitlement_grant_id)
);

CREATE INDEX IF NOT EXISTS entitlement_revocations_org_idx
  ON entitlement_revocations (org_id, revoked_at DESC);

-- One effective projection per org at org-scope (workspace_id IS NULL).
-- Workspace-scoped projections use a separate row keyed by (org_id, workspace_id).
CREATE TABLE IF NOT EXISTS effective_entitlement_projections (
  effective_entitlement_projection_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  projected_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  projection JSONB NOT NULL,
  CONSTRAINT effective_entitlement_projections_integrity_unique UNIQUE (integrity_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS effective_entitlement_projections_org_scope_uidx
  ON effective_entitlement_projections (org_id)
  WHERE workspace_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS effective_entitlement_projections_ws_scope_uidx
  ON effective_entitlement_projections (org_id, workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS effective_entitlement_projections_org_idx
  ON effective_entitlement_projections (org_id, projected_at DESC);
