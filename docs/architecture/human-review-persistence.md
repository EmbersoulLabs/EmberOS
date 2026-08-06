# Human Review Persistence (Phase 2B PR 2B.1)

## Decision

The **Execution Plan** remains the only Aggregate Root.

Human Review is a **logical aggregate** owned by the Execution Plan. Persistence is
**append-only facts** only:

1. `ReviewOpenedFact`
2. `SceneIntentReviewDecision`
3. `StoryReviewDecision`

`LogicalReviewProjection` is derived from facts and is never stored as a mutable row.

## Logical states

- `UNDER_REVIEW`
- `APPROVED`
- `REJECTED`

`READY_FOR_EXECUTION` is **not** a review state.

## Boundary

This document covers Phase 2B PR 2B.1 persistence only. It does not authorize Assembly
Definition, API, UI, RLS, Queue, Worker, Outbox, Provider Runtime, or execution unlock.
