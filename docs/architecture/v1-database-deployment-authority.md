# EmberOS V1 database deployment authority

Authority ID: `EMBEROS-DATABASE-CANONICAL-MIGRATION-BOOKKEEPING-AUTHORITY-01`

## Decision

EmberOS V1 uses **ordered, state-certified hybrid convergence**.

- `packages/db/src/schema/index.ts` is the sole desired-state authority for relational structure.
- Reviewed, ordered repository SQL is the upgrade implementation and the authority for PostgreSQL objects Drizzle does not fully express: functions, triggers, RLS enablement, policies, grants, and specialized immutable-history constraints.
- Structural DDL in an upgrade SQL file is a transition artifact, not a competing desired-state definition. It must be tested from its declared predecessor and its resulting catalog must match the Drizzle desired state.
- Persistent application history inside the target database is not authoritative for V1. Current state is authoritative. Release evidence is the Git revision, ordered manifest and hashes, environment identity, and PostgreSQL catalog certificate.

This decision does not repair the known Post-QC migration defect and does not authorize applying that migration.

## Current architecture inventory

| Mechanism | Responsibility | Mutates schema | Ordered | Idempotent | Persists history | CI | Staging/Production | Classification |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Drizzle schema | Relational desired state | No | N/A | N/A | No | Yes | Runtime compile authority | Authoritative |
| `drizzle-kit push --force` | Disposable database convergence | Yes | No | Convergent | No | Yes | Not in deployment definitions | CI/bootstrap supporting only |
| `drizzle-kit migrate` | Generated ordered migrations | Yes | Yes | Ledger-based | Yes | No | No committed migrations | Dead/unusable for V1 |
| Project SQL files | Upgrade transitions and specialized PostgreSQL objects | Yes | Only through release ordering | Mostly | No | Partially | Manually applied | Supporting transition authority; previously ambiguous ordering |
| Project SQL runners | Execute one SQL file | Yes | One file | Depends on SQL | No | Partially | Manual | Supporting |
| CI PostgreSQL job | Runtime database behavior | Yes, disposable only | Workflow order | N/A | No | Yes | No | Certification supporting |
| Railway/Vercel deploy | Application deployment | No database step | No | N/A | No | No | Yes | Application deployment only |
| Supabase/Drizzle/public ledgers | Application history | No current mechanism | N/A | N/A | N/A | No | Absent | Not authoritative |

## Database object authority matrix

| Object | Canonical desired-state authority | Upgrade/specialized authority |
| --- | --- | --- |
| Tables, columns, types, defaults, primary keys, foreign keys | Drizzle schema | Ordered SQL transition, verified against Drizzle |
| Unique constraints, ordinary checks, ordinary indexes | Drizzle where modeled | Ordered SQL only when deliberately outside Drizzle; catalog verification required |
| Enums/types | Drizzle where modeled | Ordered SQL for PostgreSQL-only types |
| Functions and triggers | Repository SQL | Repository SQL |
| RLS enablement and policies | Repository SQL | Repository SQL |
| Grants | Repository SQL | Repository SQL |
| Specialized immutable-history constraints | Repository SQL | Repository SQL |

An object may appear in transition SQL and Drizzle, but they are not coequal: Drizzle defines the required final relational state; the transition is accepted only when predecessor execution and catalog certification prove convergence to that state.

## Canonical deployment contract

`SOURCE_OF_TRUTH`: Git revision containing the Drizzle desired state, reviewed ordered release SQL, and state-certificate specification.

`STRUCTURAL_SCHEMA_AUTHORITY`: `packages/db/src/schema/index.ts`.

`SPECIALIZED_SQL_AUTHORITY`: reviewed `packages/db/sql/*.sql` files explicitly listed by a release manifest.

`DEPLOYMENT_COMMAND`: execute the release manifest's allowlisted project-owned SQL runners in manifest order, then run its PostgreSQL catalog certificate. There is no implicit directory scan.

`DEPLOYMENT_ORDER`:

1. Verify environment identity, predecessor certificate, revision and SQL hashes.
2. Execute isolated predecessor-schema regression in disposable PostgreSQL.
3. Apply structural transition SQL in manifest order.
4. Apply specialized constraints and indexes.
5. Apply functions and triggers.
6. Apply RLS, policies and grants.
7. Produce and archive the post-application PostgreSQL catalog certificate.

`STATE_VERIFICATION`: inspect PostgreSQL catalogs for tables, columns, types, defaults, PKs, FKs, unique/check constraints, indexes, functions, triggers, RLS, policies, and grants. Command exit status alone is insufficient.

`APPLICATION_HISTORY_AUTHORITY`: no database ledger for V1. Git revision + ordered manifest/hash set + predecessor certificate + resulting catalog certificate form the auditable application evidence.

`DRIFT_DETECTION`: compare a target catalog certificate with the revision-controlled expected certificate; fail closed on missing, additional, or divergent protected objects.

`CI_VALIDATION_MODEL`: create the real predecessor in disposable PostgreSQL, assert the final object is absent, execute each transition through its real CREATE/ALTER path, and then validate catalog state. Drizzle push must not pre-create the object under test.

`STAGING_APPLICATION_MODEL`: same reviewed manifest, environment guard, predecessor check, apply phases, and catalog certificate as Production.

`PRODUCTION_APPLICATION_MODEL`: same model with an additional reviewed approval and backup/recovery evidence. `drizzle-kit push --force` is prohibited for Production upgrades.

## Bookkeeping decision

Persistent ordered migration bookkeeping is **not required for EmberOS V1**. Retrofitting a ledger would require inventing historical application facts for databases already managed through convergence and manual idempotent SQL. That would not prove their state. State-based catalog certification is both smaller and more truthful for the existing V1 estate.

This does not remove deterministic ordering: the release manifest is ordered and immutable at its Git revision. It separates application evidence from database truth rather than pretending a newly created ledger represents historical execution.

## Production safety

`drizzle-kit push --force` is **NOT_ACCEPTABLE_FOR_PRODUCTION**. It may be used only to bootstrap disposable CI databases where destruction is acceptable. Existing application deployment definitions do not run it against Production. Production upgrades must use reviewed allowlisted transitions and state certification.

## CI false-green rule

Migration tests must use an isolated predecessor namespace or disposable database in which the final object is absent. Running `drizzle-kit push` first is not evidence that a transition's CREATE/ALTER path works. The Post-QC predecessor regression intentionally proves that the current defective SQL returns PostgreSQL `42703`, while a bounded in-memory correction to the proven parent `id` can execute and bind the expected FK. The source migration remains unchanged for its dedicated repair ticket.
