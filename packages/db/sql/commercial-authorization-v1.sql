-- Sprint 4 Phase E — Commercial Execution Authorization (append-only authority).
-- Bridges Subscription → Entitlement → Pricing → Reservation → Billable Execute.
-- Service-write only. No Runtime Recovery / Provider Retry / Billing Portal.

CREATE TABLE IF NOT EXISTS commercial_execution_authorizations (
  commercial_authorization_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  capability_key TEXT NOT NULL,
  execution_identity TEXT NOT NULL,
  entitlement_evidence_id TEXT NOT NULL,
  pricing_rule_key TEXT NOT NULL,
  pricing_rule_version TEXT NOT NULL,
  pricing_rule_integrity_hash TEXT NOT NULL,
  credit_reservation_id UUID NULL
    REFERENCES credit_reservations(credit_reservation_id) ON DELETE RESTRICT,
  authorized_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  authorization_body JSONB NOT NULL,
  CONSTRAINT commercial_execution_authorizations_integrity_unique
    UNIQUE (integrity_hash),
  CONSTRAINT commercial_execution_authorizations_execution_unique UNIQUE (
    org_id,
    workspace_id,
    capability_key,
    execution_identity
  )
);

CREATE INDEX IF NOT EXISTS commercial_execution_authorizations_org_idx
  ON commercial_execution_authorizations (org_id, authorized_at DESC);
CREATE INDEX IF NOT EXISTS commercial_execution_authorizations_workspace_idx
  ON commercial_execution_authorizations (workspace_id, authorized_at DESC);
CREATE INDEX IF NOT EXISTS commercial_execution_authorizations_execution_idx
  ON commercial_execution_authorizations (execution_identity);
