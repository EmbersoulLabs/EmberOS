# EmberOS Super Admin Console Blueprint V1

Status: **APPROVED / FROZEN DESIGN BASELINE**

## 1. Product and Authority Boundary

The Console is an internal operational surface inside the existing EmberOS
application under `/admin`. It uses the existing Auth system, backend, database,
and canonical domain services.

> **SUPER ADMIN IS NOT DATABASE GOD MODE.**

```text
Super Admin UI
→ Admin API
→ Admin Authorization
→ Canonical Admin Command / Domain Service
→ Existing Domain Authority
→ Persistence
→ Immutable Admin Audit Event
```

The browser MUST NOT perform arbitrary mutation of canonical runtime, billing,
subscription, entitlement, credit, usage, cost, or provider records.

## 2. Identity and Authorization

```text
PLATFORM ROLE
≠ ORGANIZATION ROLE
≠ WORKSPACE ROLE
≠ COMMERCIAL ENTITLEMENT
```

Sprint 4 V1 uses one persistent platform role: `PLATFORM_SUPER_ADMIN`. The
existing email allowlist may remain only as an emergency bootstrap mechanism;
it is not the normal platform-role authority.

```text
Supabase Authentication
→ Authenticated User
→ Active Platform Role Assignment
→ /admin Layout Authorization
→ Admin API Authorization
→ Read Policy or Command Policy
```

Every Admin API independently authorizes the caller. Middleware is
defense-in-depth. Browser state cannot assert a platform role. Service-role
credentials never reach the browser. One broad Platform Super Admin role is
sufficient for the small V1 operator group when command policies, reasons,
confirmation tiers, and immutable audit are enforced. Full internal RBAC is
future scope.

Platform Super Admin status MUST NOT silently grant commercial entitlement.
Internal product access uses an audited internal entitlement grant.

### Frozen AI Story entitlement decision

AI Story access is intended for:

- Agency entitlement; or
- an audited internal/Super Admin entitlement grant.

Free and Pro MUST NOT automatically receive AI Story access.

## 3. Console Scope

### Sprint 4 V1

- Overview
- Organizations, Workspaces, Members, and Users & Access
- Billing Accounts, Subscriptions, and Stripe Events
- Entitlements
- Credits, Reservations, Settlements, and Adjustments
- Usage & Cost
- Runtime Operations
- Provider health
- Workers & Queues
- Durable Media
- basic Security summaries
- Audit Log

### Sprint 5 V2

- explicit read-only Support Mode
- full account suspension
- advanced subscription/refund support
- Provider maintenance/drain
- governed mutable feature flags
- margin/provider analytics
- advanced Security Operations
- internal capability-based Admin permissions

### Future

- separate Admin application extraction
- four-eyes approval
- formal case management
- enterprise internal roles
- advanced compliance and regional controls

## 4. Organization, Workspace, and Membership Operations

Admin may read Organization/Workspace identity, membership, subscription,
entitlement, Credits, Usage/Cost attribution, Runtime, storage metadata, and
support identifiers.

Sprint 4 permits narrow commands to restrict or resume **new billable
execution**. This is not full suspension and does not block login, hide
historical results, cancel accepted Provider work, or delete data. Customer
business content MUST NOT be silently edited.

Membership add/change/remove operations use canonical commands containing the
target, actor, reason, before/after state, request/idempotency identity, audit
event, and domain invariants such as last-admin protection. Direct membership
updates/deletes are not an approved Admin boundary.

Unrestricted impersonation and hidden identity switching are forbidden.
Password resets use the existing authentication-provider flow.

## 5. Billing and Subscription Administration

```text
Verified Stripe Event
→ Billing / Subscription Projection
→ Entitlement Projection
→ Product Authorization
```

Admin may read Billing Account, Stripe customer mapping, verified events,
webhook failures, Subscription Projection, and projection freshness.

Allowed commands:

- `RequestSubscriptionResync`
- `RetryStripeProjection`
- server-created Billing Portal session where authorized

Admin MUST NOT manually set Subscription `ACTIVE`, fabricate Stripe evidence,
mark invoices paid, or edit Subscription Projection. Commercial exceptions use
audited entitlement grants rather than fake subscription state.

## 6. Entitlement Administration

The effective Entitlement Projection is read-only. Access changes are
append-only grant/revocation facts. Each grant includes Organization,
capability, source, reason, actor, created timestamp, optional expiry, request
identity, and integrity/audit reference.

Canonical commands are `GrantEntitlement` and `RevokeEntitlement`. Revocation
targets a specific source and never deletes history.

## 7. Credit Administration

Admin MUST NOT update `wallet.balance`.

```text
AdjustCredits
→ Immutable Credit Ledger Entry
→ Wallet Projection
→ Immutable Admin Audit Event
```

Adjustment types may include `GRANT`, `COMPENSATION`, `CORRECTION`,
`PROMOTIONAL`, and `REVERSAL`. Every entry records Organization, wallet, amount,
unit, reason, actor, reference, timestamp, idempotency identity, and integrity
evidence. Existing settlements are never edited; corrections use compensating
entries.

Refund policy and large-adjustment approval thresholds remain open product
policy decisions.

## 8. Usage and Cost Authority

The Console keeps these concepts separate:

1. Provider Usage
2. Provider Cost
3. Customer Product Usage
4. Customer Credit Charge

Provider Usage and Cost ledgers remain immutable operational truth. They MUST
NOT be treated as customer price or Credit balance. Read models may aggregate
by Organization, Workspace, Provider, model, capability, date, execution, and
attempt. Margin analytics are Sprint 5 V2.

## 9. Execution Plan-Centered Runtime Operations

```text
Execution Plan
→ Commercial Authorization
→ Runtime Authorization
→ Credit Reservation
→ Scene Scheduling
→ Routing Decision
→ Provider Outbox
→ Dispatch
→ Provider Execution / Attempt
→ Worker Evidence
→ Production Finalizer
→ Usage / Cost
→ Scene Result
→ Durable Media Attestation
→ Assembly Job / Artifact
→ Final Story Result
→ Runtime Projection
```

Admin views expose safe classifications, timestamps, correlations, and
recovery eligibility. Credentials, raw Provider bodies, raw prompts, and
unnecessary customer content are forbidden.

## 10. Runtime Recovery

Recovery reuses canonical identity. There is no generic Retry Everything.

| Action | Policy |
|---|---|
| Reconcile `ACCEPTANCE_UNKNOWN` | Query the original Provider request; never resubmit blindly |
| Requeue expired Outbox lease | Reuse the accepted Outbox identity |
| Retry Scene Projection | Rebuild projection only |
| Retry Finalizer | Consume immutable Worker Execution Result only |
| Retry Assembly infrastructure failure | Replay the same eligible Assembly Job; never regenerate Scenes |
| Retry FSR Projection | Rebuild projection only |
| Release stranded reservation | Only with authoritative proof that no billable acceptance occurred |
| Force Provider resubmit/change Provider | FORBIDDEN |
| Delete/modify Runtime evidence or Finalizer result | FORBIDDEN |

## 11. Provider, Worker, Queue, and Durable Media Operations

Sprint 4 Provider operations are read-only for Seedance, MiniMax, and future
canonical Providers: health, configured state, latency, success/failure,
acceptance unknown, Usage, Cost, and quota where available. Secrets are never
returned. Maintenance/drain/enable/disable are Sprint 5 V2 and never reroute an
accepted execution.

Worker/Queue views show heartbeat, build/provenance, queue depth, oldest work,
Outbox backlog, expired leases, stuck Dispatches, Assembly backlog, and billing
webhook backlog. The Console is not a raw Redis/BullMQ surface.

Durable Media views show Workspace storage, Scene attestation, Assembly
Artifacts, object availability, hash, storage health, and retention. Signed
URLs are transport-only and are not returned by default. Canonical accepted
media cannot be directly deleted from Admin V1.

## 12. Feature Flag and Security Governance

Sprint 4 may display safe deployment/capability rollout state but does not
create a full mutable feature-flag product. Future mutations require actor,
reason, before/after state, timestamp, and audit.

Security views may show failed authentication patterns, rate limits, ownership
denials, webhook signature failures, and safe credential configured status.
Secret values are never displayed.

## 13. Immutable Admin Audit Event

Every sensitive accepted command creates an append-only event containing:

- event ID;
- actor and Platform Role;
- action;
- target type/ID;
- Organization/Workspace where applicable;
- reason;
- safe before/after references;
- request and idempotency IDs;
- command status;
- timestamp; and
- integrity hash.

No update/delete repository is permitted. Secrets, tokens, signed URLs, raw
Provider payloads, and payment details are excluded. Sensitive command
acceptance fails closed if its required Audit Event cannot be accepted.

## 14. Dangerous Action Levels

| Level | Type | Requirement |
|---|---|---|
| 0 | Read | No confirmation |
| 1 | Low-risk recovery | Contextual confirmation; idempotent command |
| 2 | Financial, entitlement, membership, restriction | Explicit reason and confirmation |
| 3 | High-risk platform operation | Reason, typed confirmation, strong warning; future second approver |

Sprint 4 does not require four-eyes approval but leaves room for it.

## 15. Read / Command / Forbidden Matrix

| Target | Read | Canonical command | Direct mutation/delete |
|---|---|---|---|
| Organization | Yes | Restrict/resume new execution | Forbidden |
| Workspace | Yes | None in V1 | Forbidden |
| User/Membership | Yes | Audited add/change/remove | Forbidden |
| Subscription/Billing Event | Yes | Resync/projection retry | Forbidden |
| Entitlement | Yes | Grant/revoke facts | Forbidden |
| Credit Wallet | Yes | Immutable adjustment entry | Forbidden |
| Reservation | Yes | Reconcile/release when proven | Forbidden |
| Settlement | Yes | Compensating entry only | Forbidden |
| Usage/Cost | Yes | None | Forbidden |
| Runtime Authorization | Yes | None | Forbidden |
| Provider Execution | Yes | Reconcile original execution | Forbidden |
| Worker/Scene Result | Yes | Projection replay where eligible | Forbidden |
| Media Attestation | Yes | Diagnostic only | Forbidden |
| Assembly Job/Artifact | Yes | Eligible infrastructure replay | Forbidden |
| Final Story Result | Yes | Projection replay only | Forbidden |
| Provider config | Read-only V1 | V2 | Forbidden in V1 |
| Queue/Outbox | Yes | Expired-lease recovery | Forbidden |
| Feature Flag | Read-only V1 | V2 | Forbidden in V1 |
| Admin Audit Event | Yes | Created by accepted command | Forbidden |

## 16. Canonical Admin Commands

Sprint 4 commands are:

- `GrantEntitlement`
- `RevokeEntitlement`
- `AdjustCredits`
- `RestrictOrganizationExecution`
- `ResumeOrganizationExecution`
- `RequestSubscriptionResync`
- `RetryStripeProjection`
- `ReconcileProviderExecution`
- `RequeueExpiredOutbox`
- `RetrySceneProjection`
- `RetryAssemblyInfrastructureFailure`
- `RetryFinalStoryResultProjection`
- `ReleaseStrandedReservation` when non-acceptance is proven

Each command defines authority, preconditions, deterministic/idempotent
identity, effects, failure model, and audit policy.

## 17. RLS, Service Role, and Cross-Tenant Safety

```text
Authenticated Super Admin Browser
→ Admin API
→ Platform Authorization
→ Target / Command Validation
→ Server Domain Repository
→ Service Role only where required
→ Canonical Persistence
→ Admin Audit Event
```

Server-mediated cross-tenant reads are preferred. There is no generic browser
RLS bypass. Service role does not waive domain validation and never reaches the
browser.

Every sensitive cross-tenant request is attributable to actor,
request/session, target Organization/Workspace, and reason where required.
Admin data never leaks into normal Workspace APIs or caches.

Sprint 4 V1 uses Admin-only diagnostic pages. It has no impersonation and no
“view as Workspace.” Explicit read-only Support Mode may be evaluated in
Sprint 5. Full impersonation remains forbidden.

## 18. Overview and Information Architecture

The exception-first Overview may show stuck Runtime, acceptance unknown,
Stripe/projection failures, stranded reservations, Provider/Worker health,
Outbox/Assembly backlog, FSR failures, storage health, and recent Admin actions.
Vanity metrics are secondary.

```text
/admin
├── Overview
├── Organizations
├── Users & Access
├── Billing
├── Entitlements
├── Credits
├── Usage & Cost
├── Runtime Operations
├── Providers
├── Workers & Queues
├── Durable Media
└── Audit Log
```

## 19. Explicit Non-Scope

- Content Planner, Photo Scene, Social Publishing, or Video Studio editing
- Campaign content editing
- Prompt Library or Knowledge Base redesign
- Enterprise SSO/SCIM or mobile-store billing
- full analytics or feature-flag platform
- arbitrary SQL, database, Redis, Queue, Provider, or file browser
- unrestricted impersonation
- direct mutation/deletion of immutable canonical records

## 20. Sprint Mapping and Open Decisions

| Phase | Admin scope |
|---|---|
| A | Durable Media foundation/diagnostic inputs — released |
| B | Commercial contracts, Platform Admin identity, shell/navigation, Audit foundation |
| C | Stripe/Billing/Subscription surfaces |
| D | Entitlements, Credits, Reservations, and Settlements |
| E | Commercial authorization evidence in Runtime timeline |
| F | Runtime/Provider/Worker/Queue diagnostics and recovery |
| G | Overview convergence and Admin/customer E2E |
| H | Security, deployment, and release verification |

No Admin UI precedes its canonical read model or command authority. This docs
freeze does not begin Phase B.

Open policy decisions remain: maximum Credit adjustment, future second
approver threshold, refund/compensation policy, bootstrap Admin retirement,
restriction messaging, sensitive media support access, Audit retention, and
Paid Beta versus GA MFA. They do not authorize implementation assumptions.

Implementation status: **NOT STARTED BY THIS DOCUMENTATION FREEZE**.
