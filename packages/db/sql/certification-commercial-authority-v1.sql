BEGIN;

CREATE TABLE certification_commercial_scopes (
  certification_scope_id UUID PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment = 'STAGING'),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  capability_key TEXT NOT NULL CHECK (capability_key = 'ai_story.execute'),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','CLOSED','REVOKED')),
  max_provider_cost_usd NUMERIC(12,2) NOT NULL CHECK (max_provider_cost_usd > 0),
  max_provider_submissions INTEGER NOT NULL CHECK (max_provider_submissions > 0),
  spent_provider_cost_usd NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (spent_provider_cost_usd >= 0),
  reserved_provider_cost_usd NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (reserved_provider_cost_usd >= 0),
  consumed_provider_submissions INTEGER NOT NULL DEFAULT 0 CHECK (consumed_provider_submissions >= 0),
  reserved_provider_submissions INTEGER NOT NULL DEFAULT 0 CHECK (reserved_provider_submissions >= 0),
  created_by UUID NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  integrity_hash TEXT NOT NULL UNIQUE,
  contract_version TEXT NOT NULL,
  scope_body JSONB NOT NULL,
  CONSTRAINT certification_commercial_scope_identity_unique UNIQUE(environment,org_id,workspace_id,capability_key),
  CONSTRAINT certification_commercial_scope_budget_check CHECK (spent_provider_cost_usd + reserved_provider_cost_usd <= max_provider_cost_usd),
  CONSTRAINT certification_commercial_scope_quota_check CHECK (consumed_provider_submissions + reserved_provider_submissions <= max_provider_submissions)
);
CREATE INDEX certification_commercial_scope_workspace_idx ON certification_commercial_scopes(workspace_id,status);

CREATE TABLE provider_usd_pricing_rules (
  provider_usd_pricing_rule_id UUID PRIMARY KEY,
  provider_key TEXT NOT NULL,
  model_id TEXT NOT NULL,
  generation_mode TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  aspect_ratio TEXT NOT NULL,
  resolution TEXT NOT NULL,
  input_video_included BOOLEAN NOT NULL CHECK (input_video_included = FALSE),
  output_width_pixels INTEGER NOT NULL CHECK (output_width_pixels > 0),
  output_height_pixels INTEGER NOT NULL CHECK (output_height_pixels > 0),
  output_frame_rate INTEGER NOT NULL CHECK (output_frame_rate > 0),
  currency TEXT NOT NULL CHECK (currency='USD'),
  usd_per_million_tokens NUMERIC(12,4) NOT NULL CHECK (usd_per_million_tokens > 0),
  cost_basis TEXT NOT NULL CHECK (cost_basis='OFFICIAL_TOKEN_RATE_ESTIMATE'),
  source_url TEXT NOT NULL,
  version TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL UNIQUE,
  contract_version TEXT NOT NULL,
  pricing_body JSONB NOT NULL,
  CONSTRAINT provider_usd_pricing_identity_unique UNIQUE(provider_key,model_id,generation_mode,duration_seconds,aspect_ratio,resolution,version)
);
CREATE INDEX provider_usd_pricing_lookup_idx ON provider_usd_pricing_rules(provider_key,model_id,generation_mode,effective_from DESC);

CREATE TABLE certification_commercial_reservations (
  certification_reservation_id UUID PRIMARY KEY,
  certification_scope_id UUID NOT NULL REFERENCES certification_commercial_scopes(certification_scope_id) ON DELETE RESTRICT,
  provider_usd_pricing_rule_id UUID NOT NULL REFERENCES provider_usd_pricing_rules(provider_usd_pricing_rule_id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  execution_identity TEXT NOT NULL,
  reserved_cost_usd NUMERIC(12,2) NOT NULL CHECK (reserved_cost_usd > 0),
  settled_cost_usd NUMERIC(12,2) CHECK (settled_cost_usd >= 0),
  status TEXT NOT NULL CHECK (status IN ('RESERVED','SUBMITTED','SETTLED','RELEASED')),
  created_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  integrity_hash TEXT NOT NULL UNIQUE,
  contract_version TEXT NOT NULL,
  reservation_body JSONB NOT NULL,
  CONSTRAINT certification_reservation_execution_unique UNIQUE(certification_scope_id,execution_identity)
);
CREATE INDEX certification_reservation_scope_status_idx ON certification_commercial_reservations(certification_scope_id,status);

CREATE TABLE certification_commercial_events (
  certification_commercial_event_id UUID PRIMARY KEY,
  certification_scope_id UUID NOT NULL REFERENCES certification_commercial_scopes(certification_scope_id) ON DELETE RESTRICT,
  certification_reservation_id UUID REFERENCES certification_commercial_reservations(certification_reservation_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('CREATED','RESERVED','SUBMITTED','SETTLED','RELEASED','CLOSED','REVOKED')),
  cost_usd NUMERIC(12,2),
  actor_user_id UUID,
  reason TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL UNIQUE,
  event_body JSONB NOT NULL
);
CREATE INDEX certification_commercial_events_scope_idx ON certification_commercial_events(certification_scope_id,occurred_at);
CREATE UNIQUE INDEX certification_commercial_events_reservation_type_unique ON certification_commercial_events(certification_reservation_id,event_type) WHERE certification_reservation_id IS NOT NULL;

ALTER TABLE certification_commercial_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_usd_pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_commercial_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_commercial_events ENABLE ROW LEVEL SECURITY;

COMMIT;
