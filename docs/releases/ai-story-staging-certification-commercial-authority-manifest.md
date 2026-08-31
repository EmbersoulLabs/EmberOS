# AI Story STAGING certification commercial authority

Ticket: `EMBEROS-AI-STORY-STAGING-CERTIFICATION-COMMERCIAL-AUTHORITY-SCHEMA-ATOMIC-BUDGET-QUOTA-01`

The canonical relationship is an internal, revocable, STAGING-only certification scope. It is not a customer subscription, Agency projection, plan change, or product-credit price.

Authority matrix:

| Object | Source of truth | Ownership | Mutability | Audit | Concurrency |
| --- | --- | --- | --- | --- | --- |
| Certification scope/funding | `certification_commercial_scopes` | organization + workspace + capability | ACTIVE → CLOSED/REVOKED; counters advance transactionally | append-only events | scope row locked `FOR UPDATE` |
| Provider USD pricing | `provider_usd_pricing_rules` | BytePlus ModelArk model + request dimensions | versioned/effective, immutable version | integrity hash + source URL | exact dimension lookup |
| Budget/quota reservation | `certification_commercial_reservations` | scope + protected Worker Attempt | terminal state machine | append-only events | scope lock + unique execution identity |
| Settlement/release history | `certification_commercial_events` | scope/reservation | append only | self-evident immutable event | unique reservation/event type |

Ordered migration authority: `packages/db/releases/certification-commercial-authority-v1-staging.json`.

Provider monetary cost is estimated from BytePlus's official token-rate formula and request dimensions. Reservations round upward to cents; successful settlement uses provider-reported completion tokens when available. Product credits remain a separate authority.

Runtime order:

1. Billing account and exact active certification scope.
2. Effective `ai_story.execute` entitlement.
3. Versioned Provider USD pricing evidence.
4. Commercial authorization fact.
5. Atomic budget + global submission-slot claim before Adapter `submit`.
6. Provider outcome settlement or charge release.

Automatic paid retry remains disabled. Revocation rejects new reservations, preserves settled history, and requires open reservations to be resolved first.
