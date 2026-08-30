-- Sprint 4 Phase D — Credits & Settlement persistence (accounting authority).
-- Wallet is a projection. Ledger / Settlement / Release / Usage are append-only.
-- Service-write only. No Commercial Authorization / Execute / Stripe / Admin adjustment UI.

CREATE TABLE IF NOT EXISTS credit_wallets (
  credit_wallet_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  available_balance INTEGER NOT NULL,
  reserved_balance INTEGER NOT NULL CHECK (reserved_balance >= 0),
  currency_unit TEXT NOT NULL CHECK (currency_unit = 'credit'),
  projected_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  wallet JSONB NOT NULL,
  CONSTRAINT credit_wallets_org_unique UNIQUE (org_id),
  CONSTRAINT credit_wallets_integrity_unique UNIQUE (integrity_hash)
);

CREATE INDEX IF NOT EXISTS credit_wallets_org_idx ON credit_wallets (org_id);

CREATE TABLE IF NOT EXISTS credit_ledger_entries (
  credit_ledger_entry_id UUID PRIMARY KEY,
  credit_wallet_id UUID NOT NULL
    REFERENCES credit_wallets(credit_wallet_id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN (
      'GRANT','COMPENSATION','CORRECTION','PROMOTIONAL','REVERSAL',
      'SETTLEMENT_DEBIT','RELEASE_CREDIT'
    )),
  amount INTEGER NOT NULL,
  currency_unit TEXT NOT NULL CHECK (currency_unit = 'credit'),
  reason TEXT NOT NULL,
  actor_user_id UUID NULL,
  reference_type TEXT NULL,
  reference_id TEXT NULL,
  pricing_rule_key TEXT NULL,
  pricing_rule_version TEXT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  entry JSONB NOT NULL,
  CONSTRAINT credit_ledger_entries_integrity_unique UNIQUE (integrity_hash),
  CONSTRAINT credit_ledger_entries_idempotency_unique UNIQUE (
    credit_wallet_id,
    idempotency_key
  )
);

CREATE INDEX IF NOT EXISTS credit_ledger_entries_org_idx
  ON credit_ledger_entries (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_ledger_entries_wallet_idx
  ON credit_ledger_entries (credit_wallet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_reservations (
  credit_reservation_id UUID PRIMARY KEY,
  credit_wallet_id UUID NOT NULL
    REFERENCES credit_wallets(credit_wallet_id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency_unit TEXT NOT NULL CHECK (currency_unit = 'credit'),
  status TEXT NOT NULL
    CHECK (status IN ('PENDING','ACCEPTED','SETTLED','RELEASED')),
  pricing_rule_key TEXT NULL,
  pricing_rule_version TEXT NULL,
  execution_identity TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  reservation JSONB NOT NULL,
  CONSTRAINT credit_reservations_integrity_unique UNIQUE (integrity_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS credit_reservations_execution_uidx
  ON credit_reservations (credit_wallet_id, execution_identity)
  WHERE execution_identity IS NOT NULL;

CREATE INDEX IF NOT EXISTS credit_reservations_org_idx
  ON credit_reservations (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS credit_reservations_status_idx
  ON credit_reservations (credit_wallet_id, status);

CREATE TABLE IF NOT EXISTS credit_settlements (
  credit_settlement_id UUID PRIMARY KEY,
  credit_wallet_id UUID NOT NULL
    REFERENCES credit_wallets(credit_wallet_id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  credit_reservation_id UUID NOT NULL
    REFERENCES credit_reservations(credit_reservation_id) ON DELETE RESTRICT,
  credit_ledger_entry_id UUID NOT NULL
    REFERENCES credit_ledger_entries(credit_ledger_entry_id) ON DELETE RESTRICT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency_unit TEXT NOT NULL CHECK (currency_unit = 'credit'),
  billable_effect_reference TEXT NOT NULL,
  pricing_rule_key TEXT NULL,
  pricing_rule_version TEXT NULL,
  settled_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  settlement JSONB NOT NULL,
  CONSTRAINT credit_settlements_integrity_unique UNIQUE (integrity_hash),
  CONSTRAINT credit_settlements_reservation_unique UNIQUE (credit_reservation_id),
  CONSTRAINT credit_settlements_effect_unique UNIQUE (
    credit_wallet_id,
    billable_effect_reference
  )
);

CREATE INDEX IF NOT EXISTS credit_settlements_org_idx
  ON credit_settlements (org_id, settled_at DESC);

CREATE TABLE IF NOT EXISTS credit_releases (
  credit_release_id UUID PRIMARY KEY,
  credit_wallet_id UUID NOT NULL
    REFERENCES credit_wallets(credit_wallet_id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  credit_reservation_id UUID NOT NULL
    REFERENCES credit_reservations(credit_reservation_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  released_at TIMESTAMPTZ NOT NULL,
  actor_user_id UUID NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  release_body JSONB NOT NULL,
  CONSTRAINT credit_releases_integrity_unique UNIQUE (integrity_hash),
  CONSTRAINT credit_releases_reservation_unique UNIQUE (credit_reservation_id)
);

CREATE INDEX IF NOT EXISTS credit_releases_org_idx
  ON credit_releases (org_id, released_at DESC);

CREATE TABLE IF NOT EXISTS product_usage_events (
  product_usage_event_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  capability_key TEXT NOT NULL,
  execution_identity TEXT NOT NULL,
  pricing_rule_key TEXT NULL,
  pricing_rule_version TEXT NULL,
  commercial_authorization_id UUID NULL,
  quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  event JSONB NOT NULL,
  CONSTRAINT product_usage_events_integrity_unique UNIQUE (integrity_hash),
  CONSTRAINT product_usage_events_execution_unique UNIQUE (
    org_id,
    execution_identity,
    capability_key
  )
);

CREATE INDEX IF NOT EXISTS product_usage_events_org_idx
  ON product_usage_events (org_id, occurred_at DESC);
