# AI Story Canonical RLS (Sprint 3 / Phase 2B / PR 2B.3)

## Purpose

PostgreSQL Row Level Security independently enforces Organization + Workspace membership and the Execution Plan ownership chain for canonical AI Story tables.

RLS is a **defense-in-depth** layer. Canonical repositories still validate ownership and integrity in application code. Service-role / database-owner connections may **bypass RLS** as infrastructure behavior — that is **not** authorization. Authorization for product paths remains repository ownership checks + authenticated-role RLS for direct client SQL.

## Apply

```bash
pnpm --filter @ceo-agent/db run sql:ai-story-rls
```

Script: `packages/db/scripts/apply-ai-story-canonical-rls-v1.ts`  
SQL: `packages/db/sql/ai-story-canonical-rls-v1.sql`

The migration is idempotent: every policy is `DROP POLICY IF EXISTS` then `CREATE POLICY`. Re-applying replaces defective policies safely (including prior shadowed / workspace-wide Snapshot policies).

## Helper

| Function | Role |
|---|---|
| `user_workspace_ids()` | Workspaces the JWT `auth.uid()` caller belongs to |

## Policy matrix

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `ai_story_execution_plans` | org+ws | org+ws + campaign/story/version/package chain | none | none |
| `ai_story_scene_executions` | org+ws | org+ws + plan ownership match + chain | none | none |
| `ai_story_scene_intent_validation_results` | org+ws | org+ws + plan/scene match | none | none |
| `ai_story_review_opened_facts` | org+ws | org+ws + plan ownership match + chain | none | none |
| `ai_story_scene_intent_review_facts` | org+ws | org+ws + plan/scene ownership match + chain | none | none |
| `ai_story_story_review_facts` | org+ws | org+ws + plan ownership match + chain | none | none |
| `ai_story_assembly_definitions` | org+ws | org+ws + plan ownership match + chain | none | none |
| `ai_story_assembly_scene_memberships` | org+ws | org+ws + assembly/scene same-plan + plan match | none | none |
| `ai_story_scene_instruction_snapshots` | **relationship-scoped** | **none** (authenticated) | none | none |

No `FOR UPDATE`, `FOR DELETE`, or `FOR ALL` policies exist on these tables.

## Column-shadowing rule (critical)

Inside `EXISTS` subqueries, unqualified column names resolve to the **inner** alias when both outer and inner tables share names (`org_id`, `workspace_id`, `campaign_id`, …). That produces tautologies such as:

```sql
c.workspace_id = c.workspace_id  -- WRONG (both sides = campaigns)
```

All `WITH CHECK` / relationship predicates therefore use **fully qualified outer table names**, e.g.:

```sql
plan.org_id = ai_story_scene_executions.org_id
AND plan.campaign_id = ai_story_scene_executions.campaign_id
AND plan.id = ai_story_scene_executions.execution_plan_id
```

Never allow both sides of an equality to resolve to the same inner alias.

## Ownership chain (INSERT WITH CHECK)

For scene / review / assembly inserts, RLS requires:

1. Authenticated user is a member of the inserted `workspace_id`, and inserted `org_id` matches that workspace’s organization.
2. Referenced Execution Plan exists and its ownership columns equal the **inserted row** columns (qualified outer table).
3. Campaign, Story, Story Version, and Animation Package rows exist and match the inserted ownership chain.
4. For scene-intent reviews: Scene Execution belongs to the same plan and ownership columns match.
5. For memberships: Assembly Definition and Scene Execution share the same Execution Plan; ownership columns match both; plan ownership matches.

Duplicated ownership columns and FK chain must **both** match. RLS rejects mismatches even when SQL bypasses repositories.

## Instruction Snapshot security

Snapshots are content-addressed and **must not** be workspace-wide readable.

### SELECT (authenticated)

Allowed only when `EXISTS` proves:

1. A Scene Execution references `instruction_hash = snapshot.content_hash`.
2. That Scene’s `org_id` / `workspace_id` match the Snapshot’s duplicated ownership columns.
3. The Scene’s Execution Plan exists and matches the Scene ownership chain (campaign / story / version / package).
4. Campaign / Story / Version / Package chain rows are valid.
5. Caller is a member of that Scene’s workspace (and org matches workspace).

A Snapshot known only by content hash, or referenced only from another workspace, is not visible.

### INSERT / UPDATE / DELETE (authenticated)

**No** authenticated INSERT, UPDATE, or DELETE policies on `ai_story_scene_instruction_snapshots`.

Canonical repositories persist Snapshots using the service role / database owner (RLS bypass). That bypass is infrastructure, not product authorization. Repositories still run ownership and integrity validation.

Do not expose a public Snapshot creation API.

## Service role model

| Actor | RLS | Repository validation |
|---|---|---|
| Authenticated JWT client | Enforced | N/A for direct SQL; product paths still use repos |
| Service role / table owner | Bypassed (Postgres) | **Required** — ownership + integrity still enforced in code |

## Out of scope (PR 2B.3)

Queue, Worker, Dispatcher, Outbox, Provider Runtime, Seedance, MiniMax, Upscale, Story Video, Export, Billing, Usage, API, UI, Review/Assembly identity models, Execution unlock, Phase 3.
