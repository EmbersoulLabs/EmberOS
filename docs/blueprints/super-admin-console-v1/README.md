# EmberOS Super Admin Console V1

Status: **APPROVED / FROZEN DESIGN BASELINE**

## Documents

- [Architecture Blueprint](./architecture.md)
- [UI/UX Blueprint](./ui-ux.md)

## Authority

These documents define the approved Super Admin Console V1 product, security,
operational, and UI/UX boundaries. Implementation MUST follow existing
canonical EmberOS domain authorities.

This Blueprint MUST NOT be interpreted as permission to create parallel
billing, subscription, entitlement, credit, runtime, or provider authorities.
No Admin UI may precede the canonical read model or command authority it
operates on.

The Console remains inside the existing EmberOS application under `/admin` for
V1. A separate Admin application is future scope, not Sprint 4.

## Sprint Mapping

| Phase | Console relationship |
|---|---|
| Phase A | Durable Media foundation — released before this Blueprint freeze |
| Phase B | Commercial contracts, Platform Admin identity, Admin shell/navigation, and Audit foundation |
| Phase C | Stripe and Billing UI |
| Phase D | Entitlements and Credits UI |
| Phase E | Commercial authorization stages in the Runtime timeline |
| Phase F | Operational diagnostics and recovery UI |
| Phase G | Customer E2E and Admin UX convergence |
| Phase H | Release and security verification |

This documentation freeze does not start Phase B and does not modify the
released Phase A implementation.
