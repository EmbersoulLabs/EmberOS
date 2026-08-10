# EmberOS Super Admin Console UI/UX Blueprint V1

Status: **APPROVED / FROZEN DESIGN BASELINE**

## 1. Frozen Design Principles

1. **Exception First** — actionable problems precede vanity metrics.
2. **Business State Before Internal State** — show “Assembly failed” before IDs.
3. **Progressive Disclosure** — technical evidence is collapsed by default.
4. **Safe Action Explanation** — explain what will and will not happen.
5. **No Universal Retry** — recovery is domain-specific.
6. **Reason Before Mutation** — sensitive commands require operator reason.
7. **Auditable UX** — mutation surfaces state that the action is audited.
8. **Customer Data Minimization** — content is hidden unless necessary.
9. **No Hidden Impersonation** — Sprint 4 has no impersonation.
10. **Read Model Is Not Authority** — dashboards do not imply direct mutation.

## 2. Visual Direction and Shell

The Console uses a dedicated dark operational shell, dark neutral surfaces,
restrained EmberOS accents, compact density, minimal glow, Inter typography,
semantic statuses, tables, timelines, and drawers. It is influenced by Linear,
Stripe Dashboard, and Supabase Dashboard, not a neon marketing dashboard.

```text
┌ EmberOS Admin ─ Environment ─ Search ─ Operator ┐
├──────────────┬──────────────────────────┬────────┤
│ Left nav     │ Primary content          │ Drawer │
└──────────────┴──────────────────────────┴────────┘
```

- Sticky top bar: 48–56 px.
- Sidebar: 232–248 px expanded; 56–64 px collapsed.
- Fluid content suitable for operational tables.
- Drawer: 420–520 px, at most 45% desktop viewport.
- The shell visibly differs from `/w/[slug]`.

## 3. Navigation

```text
OPERATIONS
- Overview
- Runtime Operations
- Providers
- Workers & Queues
- Durable Media

CUSTOMERS
- Organizations
- Users & Access

COMMERCIAL
- Billing
- Entitlements
- Credits
- Usage & Cost

GOVERNANCE
- Audit Log
```

Use one outline icon family, visible active states, actionable alert badges,
collapsed tooltips, keyboard access, and breadcrumbs. V2/Future pages remain
hidden rather than appearing as dead navigation.

## 4. Status System

| Status | Meaning | Example |
|---|---|---|
| SUCCESS | Healthy completed result | FSR accepted |
| ACTIVE | Healthy current state | Subscription active |
| WAITING | Expected nonterminal wait | Provider processing |
| WARNING | Degraded, not blocked | Past due/provider degraded |
| ERROR | Terminal/operational failure | Assembly failed |
| BLOCKED | Cannot continue | Credits exhausted |
| RECONCILIATION | Authority uncertain | Acceptance unknown |
| DISABLED | Intentionally unavailable | Capability disabled |
| UNKNOWN | Evidence absent/stale | Worker health unknown |

Badges combine label, icon, color, accessible name, and freshness. Color alone
is insufficient.

## 5. Exception-First Overview

The first viewport answers “What needs attention now?” in this order:

1. critical/action-required incidents;
2. system health;
3. commercial/credit exposure;
4. Provider health; and
5. recent Admin actions.

Cards may show acceptance unknown, stuck Runtime, Stripe failures, stranded
Reservations, offline Workers, storage mismatch, oldest Outbox age, Assembly
failure, and FSR failure. Each shows severity, count, oldest age, affected
Organizations, freshness, and a filtered diagnostic link. Vanity metrics are
secondary.

## 6. Organizations, Workspaces, and Access

The Organizations table shows Organization, Subscription, entitlement summary,
available/reserved Credits, Runtime health, last activity, and restriction.
It supports scoped search, filters, sorting, and cursor pagination without bulk
mutation.

Organization Detail has Overview, Workspaces, Members, Billing, Entitlements,
Credits, Usage, Runtime, and Audit tabs. It answers whether the Organization is
commercially active, may execute, has sufficient Credits, has stuck work, and
what changed.

Workspace Detail shows identity, Organization, members, Campaign count, storage
usage, usage attribution, incidents, and safe recent activity. Customer content
is minimized and cannot be edited.

Users & Access supports user search, membership/invitation state, role
troubleshooting, and Platform Role visibility. Membership changes use a Level 2
dialog showing target, before/after role, impact, reason, and confirmation.
Inline immediate mutation, browser-native `confirm()`, and impersonation are
forbidden.

## 7. Billing and Stripe Events

```text
STRIPE EVIDENCE              EMBEROS SUBSCRIPTION PROJECTION
Customer                     Plan
Latest verified event        Status
Verification                 Current period
Last synchronized            Projection freshness
```

Actions are Request Resync and Retry Projection. Subscription status is never
an editable dropdown. Stale/desynchronized states show source-event and
projection freshness.

Stripe Events show event type, Organization/customer, received time,
verification, projection, and retry state. The drawer exposes safe metadata,
ordering, projection result, and sanitized error. Raw secret-bearing payloads,
signing secrets, and payment-method secrets are excluded.

## 8. Source-Aware Entitlements

Entitlements are not a checkbox grid. Show capability, effective status, plan
source, additional grant, expiry, and last change.

Grant flow includes target Organization, capability, duration, reason, and
effective impact plus:

> This action does not modify the customer's subscription.

Revoke identifies the exact grant source and does not imply that a plan-derived
source is removed.

## 9. Credits, Reservations, and Adjustments

Credit Summary shows Available, Reserved, Settled this period, and Adjustments,
with Wallet, Reservations, Settlements, and Ledger tabs. Wallet balance is a
projection and is never editable.

Credit Adjustment is Level 2 and contains target, type, explicit Add/Deduct
direction, positive amount, reason, reference, current available, and projected
available. It states:

> This creates an immutable Credit Ledger Entry. The wallet balance itself is
> not edited.

The confirmation names the exact effect. Existing settlements are never
edited. Reservation rows include Organization/Workspace, Execution Plan,
Scene/component, amount, age, Provider Execution, and settlement state.
Acceptance-unknown Reservations cannot be arbitrarily released.

## 10. Usage and Cost

The UI separates Provider Usage, Provider Cost, Product Usage, and Customer
Credit Charge. Filters include Organization, Workspace, Provider, capability,
date, and Execution. An Execution detail may show Provider cost, Product usage,
Credits settled, and pricing-rule version without combining them. Margin is V2.

## 11. Runtime Operations and Timeline

Execution Plan is the default entity. Lists show Execution, Organization,
Workspace, Story, Product state, Commercial state, Credits, Provider, Assembly,
FSR, and age, with Stuck, Failed, Reconciliation, Assembling, FSR Missing, and
Credit Issue filters.

```text
✓ Commercial Authorization
✓ Credit Reservation
✓ Runtime Authorization
├─ ✓ Scene 1: Routed → Accepted → Finalized → Durable Media
├─ ✓ Scene 2: Routed → Accepted → Finalized → Durable Media
→ Assembly Processing
○ Final Story Result
```

Each stage expands into time, safe canonical ID, state, sanitized failure,
Worker/Provider where useful, and the eligible recovery action. Raw JSON is not
the default UX.

## 12. Reconciliation and Failure UX

```text
RECONCILIATION REQUIRED

The Provider may have accepted this request, but EmberOS does not yet have
authoritative terminal confirmation.

This will:
✓ query the original Provider request
✓ preserve the existing attempt and Reservation

This will NOT:
✕ resubmit generation
✕ change Provider
✕ create another charge
```

Reason and explicit confirmation are required.

Scene failure, Provider rejection, moderation rejection, timeout, Assembly
failure, FSR projection failure, missing object, hash mismatch, Credit failure,
and Subscription failure each receive a safe headline, operational impact,
technical expansion, and only the valid action. Raw stack traces remain hidden.

## 13. Providers, Workers, Queues, and Durable Media

Provider V1 is read-only: health, configured state, success/failure,
acceptance unknown, latency, Usage, Cost, quota, and freshness. API secrets and
disabled V2 maintenance buttons are absent.

Workers & Queues show heartbeat, build/provenance, queue depth, oldest pending,
Outbox backlog, expired leases, and dead-letter summary. Recovery is contextual;
no raw Redis/BullMQ controls exist.

Durable Media shows owner, Scene Result/Assembly Artifact, storage provider,
immutable identity, hash, attestation, availability, retention, and last
verification. Signed URLs and previews are absent by default.

## 14. Audit Log and Dangerous Actions

Audit rows show actor, action, target, Organization, reason, status, and time;
filters cover actor, action, Organization, target type, date, and result. Drawers
show safe before/after, request ID, idempotency key, and command result. Secrets
are excluded.

| Level | Pattern |
|---|---|
| 1 | Simple contextual confirmation |
| 2 | Target, impact/before-after, reason, explicit confirmation |
| 3 | Strong warning, reason, typed confirmation, future approver slot |

Every dialog includes WHAT WILL HAPPEN, WHAT WILL NOT HAPPEN, TARGET, REASON,
and CONFIRMATION. Browser-native confirmation is prohibited.

## 15. Tables, Drawers, States, Search, and Attention

AdminTable is compact with sticky header, sort, filter, scoped search, cursor
pagination, optional column hiding, horizontal overflow, skeletons, safe empty
states, and read retry. V1 has no bulk financial, entitlement, membership, or
Runtime mutation.

Drawers serve Stripe Events, Reservations, Provider Attempts, Workers,
Queue/Outbox items, and Audit Events. Organizations, Execution Plans, and
Billing Accounts use pages. Drawers trap/restore focus, close with Escape, and
become full-screen on small screens.

Healthy empty states communicate health. Errors show safe code, freshness, and
read retry without destructive action. Permission denial explains that an
active Platform Super Admin assignment is required.

V1 uses scoped page search over safe identifiers. Global fuzzy search and saved
filters are V2. Attention uses nav badges, incident cards, banners, and command
toasts, not another Notification product.

## 16. Accessibility, Responsive Design, and Tokens

Require keyboard navigation, visible focus, semantic tables, `aria-current`,
dialog/drawer focus trapping and return, Escape, screen-reader labels,
non-color state, WCAG AA contrast, reduced motion, validation summaries, and
live command-result announcements.

| Width | Behavior |
|---|---|
| `>=1440px` | Expanded sidebar, full tables, optional drawer |
| `1024–1439px` | Collapsible sidebar, overlay drawer |
| `768–1023px` | Compact navigation, horizontal tables |
| `<768px` | Navigation sheet, stacked summaries, full-screen dialogs/drawers |

Security/confirmation information is never hidden on small screens.

Preserve Navy `#0A2540`, Blue `#2563EB`, Teal `#14B8A6`, Amber `#F59E0B`, and
Inter. Add semantic dark tokens for background, surfaces, border, primary and
secondary text, success, warning, danger, info, reconciliation, and disabled.
Default density is compact/operational with minimal glow.

## 17. Browser Information Security

Never render Provider credentials, Stripe/billing secrets, webhook secrets,
service-role data, authentication tokens, raw signed URLs, unnecessary private
paths, raw Provider requests/responses, raw prompts, or payment details. Copy
buttons are limited to safe IDs and content hashes. Technical metadata is
allowlisted and redacted.

## 18. ASCII Wireframes

```text
ADMIN SHELL
┌ EmberOS Admin ─ Environment ─ Search ─ Operator ┐
├──────────────┬──────────────────────────┬────────┤
│ Navigation   │ Table / Timeline         │ Drawer │
└──────────────┴──────────────────────────┴────────┘

OVERVIEW
[CRITICAL] [RECONCILIATION] [WORKER OFFLINE]
ACTION REQUIRED
SYSTEM | COMMERCIAL | PROVIDER HEALTH
RECENT ADMIN ACTIONS

ORGANIZATIONS
[Search] [Subscription ▾] [Runtime ▾] [Credits ▾]
Organization | Subscription | Entitlements | Credits | Runtime

ORGANIZATION DETAIL
Organization [ACTIVE] [AI STORY] [RESERVED]
Overview | Workspaces | Members | Billing | Entitlements | Credits | Usage | Runtime | Audit

BILLING
STRIPE EVIDENCE | EMBEROS PROJECTION
[Request Resync] [Retry Projection]

ENTITLEMENTS
Capability | Effective | Plan Source | Grant | Expiry

CREDITS
[Available] [Reserved] [Settled] [Adjustments]
Wallet | Reservations | Settlements | Ledger

RUNTIME
Execution | Org | Commercial | Provider | Assembly | FSR | Age

EXECUTION TIMELINE
✓ Commercial → ✓ Reservation → ✓ Runtime
→ Scenes → Assembly → Final Story Result

PROVIDERS
Provider | Health | Success | Unknown | p95 | Usage | Cost

WORKERS / QUEUES
Instance | Heartbeat | Build | State
Queue | Pending | Active | Oldest | Expired | Dead

DURABLE MEDIA
Owner | Object | Hash | Attestation | Retention | Checked

AUDIT
Actor | Action | Target | Organization | Reason | Result | Time

DANGEROUS ACTION
TARGET
WHAT WILL HAPPEN
WHAT WILL NOT HAPPEN
Reason [________________]
[Cancel] [Explicit Confirm]
```

## 19. Key Operator Flows

```text
Platform incident
Overview → Runtime → Execution → Evidence → Recovery → Audit

Credits disappeared
Organization → Credits → Reservation/Settlement → Explain
→ justified adjustment → Audit

AI Story beta access
Organization → Entitlements → Grant → Reason/Confirm → Audit

Stripe out of sync
Billing → Event → Projection → Resync/Retry → Audit

Acceptance unknown
Runtime → Reconciliation → Original Attempt
→ no resubmit/no new charge → Reconcile → Audit
```

## 20. V1, V2, Future, and Implementation Order

### Sprint 4 V1

Dedicated shell/navigation, exception-first Overview, Organization/Workspace/User
diagnostics, Billing/Stripe, Entitlements, Credits, Usage/Cost, Runtime timeline,
narrow recovery, Provider/Worker/Queue health, Durable Media, Audit, scoped
search, accessibility/responsiveness, and no impersonation.

### Sprint 5 V2

Read-only Support Mode, global search/saved filters, Provider maintenance,
account suspension, advanced Billing/refunds, large-adjustment approval,
margin/provider analytics, mutable flags, Security Center, and internal RBAC.

### Future

Separate Admin frontend, four-eyes workflow, case management, advanced
fraud/compliance, and enterprise internal roles.

| Phase | UI scope |
|---|---|
| A | Durable Media diagnostic inputs — released |
| B | Admin identity, shell/navigation, Organizations, Audit foundation |
| C | Billing, Subscription, Stripe Events |
| D | Entitlements, Credits, Reservations, Settlements, Adjustments |
| E | Commercial evidence in Runtime timeline |
| F | Runtime, reconciliation, Providers, Workers/Queues, recovery |
| G | Overview convergence, accessibility/responsive/Admin E2E |
| H | Security, redaction, and production verification |

No UI precedes its canonical read model or command authority. This docs freeze
does not begin implementation.

## 21. Open UX Decisions

These remain open implementation decisions:

1. Exact dark-neutral token values.
2. Final icon library.
3. Whether exact-ID top-bar lookup enters late V1 or V2.
4. Default pagination size.
5. Final drawer width within the approved range.
6. Level 3 typed-confirmation identifier.
7. Health refresh intervals.
8. Internal Admin localization scope.
9. Local-time/UTC presentation details.

They are not silently resolved by this Blueprint.

## 22. Design Risks and Acceptance

Risks include raw-database UX, apparent direct edits, duplicate financial
actions, content exposure, secret leakage, generic Retry, poor dark contrast,
and Sprint scope growth.

Acceptance requires the dedicated shell, V1 navigation, exception-first
Overview, Organization support hub, Billing evidence/projection separation,
source-aware Entitlements, immutable Credit Adjustment UX, Runtime timeline,
safe Reconciliation explanation, standardized dangerous actions, Audit,
redaction, no impersonation, accessibility/responsiveness, explicit V1/V2
scope, and Sprint-aligned delivery.

Implementation status: **NOT STARTED BY THIS DOCUMENTATION FREEZE**.
