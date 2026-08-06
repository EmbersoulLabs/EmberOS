# Story Assembly Definition Persistence (Phase 2B PR 2B.2)

## Decision

The **Execution Plan** remains the only Aggregate Root.

**Story Assembly Definition** is subordinate and immutable. It records deterministic
future execution ordering only:

1. `StoryAssemblyDefinition`
2. `AssemblySceneMembership`

`AssemblyProjection` is derived and is never stored as a mutable row.
`READY_FOR_EXECUTION` is never persisted here.

## Boundary

This document covers Phase 2B PR 2B.2 persistence only. It does not authorize API, UI,
RLS, Queue, Worker, Outbox, Provider Runtime, Story Video, media assembly, export, or
execution unlock.
