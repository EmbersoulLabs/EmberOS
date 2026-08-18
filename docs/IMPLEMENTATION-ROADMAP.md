# Implementation Roadmap

This document is the authoritative EmberOS V1 implementation roadmap.

It governs implementation order.

Do not redesign the approved product architecture.

Do not modify Blueprint decisions.

Do not introduce new product modules.

Implementation must follow the Blueprint Repository specifications, UI specifications, workflows, decisions, foundations, and prompt library.

When implementation conflicts with Blueprint:

1. Stop implementation.
2. Report the conflict.
3. Do not silently change product behavior.
4. Resolve through an Architecture Decision or Specification update.

## 1. Product Development Model

The development process is:

Blueprint

↓

Sprint Planning

↓

Implementation

↓

Automated Tests

↓

Code Review

↓

Product Acceptance

↓

Commit

↓

Deployment

### Roles

#### Product Owner

Yuki

Responsibilities:

- Approve Sprint scope.
- Confirm product behavior.
- Perform business acceptance testing.
- Make final product decisions.

#### Technical Planning

ChatGPT

Responsibilities:

- Convert Blueprint specifications into implementation tasks.
- Identify dependencies and risks.
- Define acceptance criteria.
- Review implementation direction.

#### Implementation

Cursor or Codex

Responsibilities:

- Implement approved Sprint tasks.
- Write database migrations.
- Write APIs.
- Build UI.
- Write tests.
- Run validation.
- Report deviations.

#### Independent Review

Codex or another review agent

Responsibilities:

- Check specification compliance.
- Review security.
- Review permission handling.
- Review tests.
- Identify regressions and edge cases.

## 2. Implementation Rules

### 1. Real Data First

Do not use permanent mock implementations for production modules.

Command Center and other operational surfaces must use real application APIs and persisted database data from their first production implementation.

Temporary fixtures are permitted only inside:

- Automated tests.
- Storybook or isolated UI previews.
- Local development seed data.

Temporary fixtures must not become production data sources.

### 2. API First

For each business module, implement in this order:

1. Database schema.
2. Row-level security and permissions.
3. Domain service.
4. API or server action.
5. Input validation.
6. Audit logging.
7. UI integration.
8. Automated tests.
9. User acceptance testing.

### 3. Multi-Workspace Model

Normal Tenant:

- One Workspace.
- One Company Profile.

Agency and Yuki accounts:

- Multiple Workspaces.
- Each Workspace has its own Company Profile.

All business records must be scoped by Workspace.

### 4. AI Production Safety

AI may:

- Analyze executions.
- Recommend Prompt changes.
- Generate Prompt drafts.
- Compare versions.
- Run sandbox tests.
- Run shadow evaluations.

AI must not:

- Directly edit an active production Prompt.
- Publish a Prompt without human approval.
- Silently overwrite Prompt versions.
- Modify production workflows through conversational commands alone.
- Expose hidden model reasoning.

### 5. Prompt Authority

Prompt Library is the authoritative management surface for Prompt changes.

Required lifecycle:

Current Production Version

↓

Generate or Create Draft

↓

Review Diff

↓

Sandbox Test

↓

Compare Results

↓

Human Approval

↓

Publish

↓

Monitor

↓

Rollback when required

Every published Prompt version must be:

- Immutable.
- Versioned.
- Auditable.
- Traceable to executions.
- Reversible through rollback.

## 3. Release Stages

Development is divided into four delivery stages.

### Stage A — Engineering Foundation

Purpose:

Create the secure technical base required by all modules.

### Stage B — Internal Alpha

Purpose:

Complete the first real business workflow:

Business Profile

↓

Campaign

↓

Campaign Assets

↓

Marketing Package

### Stage C — Private Beta

Purpose:

Add the AI Team and production asset creation capabilities.

### Stage D — Paid V1

Purpose:

Complete the usable commercial product with publishing, billing, usage limits, onboarding, and operational administration.

## 4. Phase 0 — Engineering Foundation

### Sprint 0A — Repository and Runtime Foundation

Implement:

- Application repository structure.
- Frontend and backend boundaries.
- Environment variable validation.
- Supabase project connection.
- Local development environment.
- Staging environment.
- Production environment configuration.
- Database migration process.
- Error handling.
- Structured logging.
- Health check endpoint.
- Feature flag foundation.
- Automated test framework.
- Continuous integration checks.
- Linting.
- Type checking.
- Formatting checks.
- Build verification.

Acceptance Criteria:

- Application runs locally.
- Staging deployment succeeds.
- Environment variables are validated.
- Database migrations can be applied and rolled back safely.
- CI blocks invalid builds.
- Errors have traceable request or execution identifiers.

### Sprint 0B — Authentication

Implement:

- Sign up.
- Login.
- Logout.
- Password reset.
- Email verification where required.
- Session refresh.
- Protected routes.
- Authentication error states.
- Disabled account handling.
- Initial user profile.

Acceptance Criteria:

- Unauthenticated users cannot access protected routes.
- Expired sessions are handled correctly.
- Disabled users cannot access the application.
- Authentication events are logged without exposing credentials.

### Sprint 0C — Workspace and Permissions

Implement:

- Workspace entity.
- Workspace membership.
- Workspace roles.
- Permission matrix.
- Normal Tenant restriction.
- Agency multi-Workspace support.
- Yuki multi-Workspace support.
- Workspace switching.
- Workspace-scoped database policies.
- Permission-aware navigation.
- Audit events for membership and role changes.

Acceptance Criteria:

- Records cannot be read across unauthorized Workspaces.
- Normal users cannot create unauthorized additional Workspaces.
- Agency and approved internal accounts can switch Workspaces.
- UI and API enforce the same permission rules.
- Direct API calls cannot bypass permissions.

## 5. Phase 1 — Super Admin Foundation

### Sprint 1A — Super Admin Console MVP

Implement a separate system administration surface.

Super Admin is not part of a customer Workspace.

Modules:

System Overview

- Environment status.
- Application health.
- Queue health.
- Database connectivity.
- Current application version.

Workspace Management

- List Workspaces.
- Search Workspaces.
- View Workspace status.
- Enable Workspace.
- Suspend Workspace.
- View Workspace members.
- View Workspace Company Profile.
- Enter a permitted support context.

User Management

- List users.
- View memberships.
- View roles.
- Enable or disable users.
- Adjust roles with audit logging.

Feature Flags

- View flags.
- Enable or disable flags by environment.
- Enable or disable flags by Workspace when supported.

Audit Log

- Search administrative actions.
- Filter by actor.
- Filter by Workspace.
- Filter by event type.
- View before and after metadata where permitted.

Acceptance Criteria:

- Only authorized Super Admin users can access the console.
- Every write action produces an audit record.
- Workspace suspension takes effect at API level.
- Support access is clearly identified and auditable.
- Super Admin cannot silently modify customer data.

### Sprint 1B — AI Operations Foundation

Create the Super Admin AI Operations area.

Navigation:

```text
Super Admin
├── System
├── Workspaces
├── Users
├── Feature Flags
├── Audit Logs
└── AI Operations
    ├── Operations Assistant
    ├── Execution Console
    ├── Prompt Library
    ├── Prompt Testing
    ├── Workflow Debugger
    ├── Model Router
    ├── Cost Monitor
    └── Incident Center
```

At this stage, create the navigation, permissions, data contracts, and placeholder empty states.

Do not yet implement full AI workflow execution.

Acceptance Criteria:

- AI Operations is restricted to authorized roles.
- Customer Workspace users cannot access it.
- Every future operational action has an auditable contract.
- The structure supports later incremental implementation.

## 6. Phase 2 — Business Profile

### Sprint 2 — Business Profile

Blueprint authority:

- SPEC-001.
- Corresponding UI-SPEC.
- Business Profile decisions and workflow.

Implement:

Database

- Workspace Company Profile.
- Business name.
- Email.
- Phone.
- WhatsApp.
- Country.
- Address.
- Postal code.
- Timezone.
- Logo.
- Brand colors.
- Brand fonts.
- Preferred languages.
- Completion status.
- Updated by.
- Updated at.

API

- Read Business Profile.
- Create Business Profile.
- Update Business Profile.
- Upload or replace logo.
- Validate required information.
- Return non-blocking warnings.
- Permission checks.
- Audit logging.

UI

- Business Profile form.
- Required and optional fields.
- Logo upload.
- Brand preview.
- Language controls.
- Validation warning panel.
- Save state.
- Unsaved change protection.
- Loading, empty, error, and permission states.

Acceptance Criteria:

- Data persists through real API calls.
- Business Profile is Workspace-scoped.
- Campaign creation can continue with non-blocking warnings where approved.
- Required contact and location rules match the Blueprint.
- No permanent mock data is used.

## 7. Phase 3 — Campaign Core

### Sprint 3A — Campaign Management

Blueprint authority:

- SPEC-002.
- Corresponding UI-SPEC.
- Campaign workflow.

Implement:

Database

- Campaign.
- Campaign name.
- Objective.
- Status.
- Workspace ID.
- Created by.
- Updated by.
- Created at.
- Updated at.
- Archived at.
- Soft deleted at.
- Restore deadline.

API

- Create Campaign.
- List Campaigns.
- Read Campaign.
- Update Campaign.
- Archive Campaign.
- Restore Campaign.
- Soft delete Campaign.
- Campaign warnings.
- Audit log.

UI

- Campaign list.
- Campaign creation.
- Campaign detail.
- Campaign editing.
- Archive.
- Restore.
- Delete confirmation.
- Empty states.
- Permission states.

Acceptance Criteria:

- Campaigns are Workspace-scoped.
- Soft deletion follows the approved retention period.
- Campaign history is auditable.
- Campaign objective and name rules match the Specification.

### Sprint 3B — Campaign Assets

Absorb the approved functionality from the deprecated standalone Asset Upload specification.

Implement:

- Image upload.
- Video upload.
- Audio upload.
- PDF upload.
- File validation.
- MIME validation.
- Size validation.
- Storage path management.
- Asset metadata.
- Asset preview.
- Asset processing status.
- Asset deletion.
- Campaign association.
- Asset audit records.
- Secure signed access where required.

Acceptance Criteria:

- Campaign requires at least one approved asset type where specified.
- Assets cannot be accessed across Workspaces.
- Failed uploads are recoverable.
- Asset state is returned through real APIs.
- Deprecated standalone Asset Upload is not rebuilt as a separate module.

## 8. Phase 4 — Command Center With Real APIs

### Sprint 4 — Command Center

Blueprint authority:

- SPEC-011 Command Center.
- UI-SPEC-003 Command Center.

USER DECISION

Command Center must connect directly to real APIs and persisted data.

Do not implement the production Command Center using hardcoded KPI values or permanent mock data.

Implement backend APIs first.

API Endpoints or Server Operations:

Workspace Summary

- Active Campaign count.
- Draft Campaign count.
- Campaigns requiring action.
- Marketing Packages by lifecycle status.
- Assets processing.
- Recent failures.
- Recent completed work.
- Usage indicators where available.

Today's Focus

- Prioritized actionable items.
- Missing Business Profile information.
- Campaigns waiting for assets.
- Marketing Packages requiring review.
- Failed AI executions when available.
- Publishing tasks when available.
- Billing or usage warnings when available.

Recent Activities

- Campaign created.
- Campaign updated.
- Asset uploaded.
- Asset processing completed.
- Marketing Package generated.
- Approval completed.
- Publishing action.
- Administrative action where user-visible.

Workflow Entry Points

- Complete Business Profile.
- Create Campaign.
- Upload Assets.
- Generate Marketing Package.
- Continue review.
- Retry permitted failed action.

Frontend:

- Header.
- Sidebar.
- Up to six KPI cards.
- Today's Focus primary workspace.
- Recent Activities.
- On-demand Context Panel.
- Responsive layouts.
- Empty states.
- Loading states.
- Partial failure states.
- Permission-aware content.
- No Dead End UX.

Data Rules:

- KPI definitions must be documented.
- Each KPI must have a real data source.
- Each response must be Workspace-scoped.
- APIs must support empty Workspaces.
- Partial API failure must not blank the entire page.
- Cached data must clearly define invalidation behavior.

Acceptance Criteria:

- All displayed operational data originates from real APIs.
- KPI values can be verified against database records.
- Today's Focus leads to a valid action.
- No card leads to a dead end.
- User permissions change visible actions correctly.
- Command Center works before the AI Team is fully implemented.
- Future modules can extend the API without replacing its core contract.

## 9. Phase 5 — Prompt and AI Infrastructure

### Sprint 5A — Prompt Library V1

Prompt Library is the authoritative Prompt management system.

Implement:

Prompt Entity

- Prompt ID.
- Prompt key.
- Prompt name.
- Category.
- Skill association.
- Scope.
- Status.
- Description.

Prompt Version

- Version number.
- Prompt content.
- System instructions.
- Variables schema.
- Output schema reference.
- Model compatibility.
- Created by.
- Created at.
- Change reason.
- Parent version.
- Status.

Statuses:

- Draft.
- Testing.
- Approved.
- Published.
- Retired.

Required operations:

- Create Prompt.
- Create Draft Version.
- Edit Draft.
- Compare Versions.
- Validate Variables.
- Run Sandbox Test.
- Record Test Results.
- Request Approval.
- Publish Version.
- Rollback to Previous Version.
- Retire Version.
- View Execution Usage.

Production Safety:

- Published versions are immutable.
- Editing a published Prompt creates a new Draft.
- Only approved roles can publish.
- Rollback creates an auditable production switch.
- All AI executions store the exact Prompt version used.

Acceptance Criteria:

- Production Prompt cannot be directly edited.
- Previous Prompt versions remain accessible.
- Version diff is visible.
- Publish and rollback are auditable.
- Executions are traceable to Prompt versions.

### Sprint 5B — AI Provider Abstraction and Router

Implement:

- Provider interface.
- Model registry.
- Model capabilities.
- Structured output support.
- Routing policy.
- Cost metadata.
- Timeout policy.
- Retry policy.
- Fallback policy.
- Rate limit handling.
- Usage recording.
- Error classification.
- Idempotency.
- Execution correlation ID.
- Provider health status.

Acceptance Criteria:

- Business code does not directly depend on one provider.
- Every call records model, provider, usage, latency, and result state.
- Structured output is validated.
- Retries do not create duplicate business records.
- Failures are visible in AI Operations.

## 10. Phase 6 — Marketing Package

### Sprint 6A — Marketing Package Domain Model

Blueprint authority:

- SPEC-005.
- UI-SPEC-005.

Implement:

- Marketing Package.
- Campaign association.
- Package version.
- Lifecycle status.
- Package sections.
- Section version data.
- Prompt version references.
- Model references.
- Downstream references.
- Synchronization state.
- Created by.
- Approved by.
- Audit history.

Lifecycle:

- Draft.
- In Review.
- Approved.
- Archived.

Rules:

- Marketing Package is the Campaign's single source of marketing truth.
- Approved versions are traceable.
- Downstream modules reference a specific Package version.
- New versions do not silently overwrite downstream assets.
- Users receive synchronization warnings.

### Sprint 6B — Marketing Package Workspace

Implement the approved structured workspace.

Cards appear in the Blueprint-defined fixed order.

Support:

- Accordion cards.
- Structured fields.
- Independent section editing.
- Independent section saving.
- Section validation.
- Approval bar.
- Lifecycle transition.
- Version history.
- Compare versions.
- Synchronization warnings.
- Responsive UI.

Do not implement it as:

- Generic AI chat.
- Rich text document editor.
- Unstructured response page.

### Sprint 6C — Marketing Package AI Generation

Implement:

- Generate complete Marketing Package.
- Generate section.
- Regenerate section.
- Preserve user-edited sections.
- Validate structured output.
- Display warnings.
- Store Prompt version.
- Store model and provider.
- Store cost and latency.
- Compare generated versions.
- Approve selected version.

Acceptance Criteria:

- User can trace every generated section to an execution.
- Regenerating one section does not overwrite unrelated sections.
- Invalid AI output does not corrupt the current Package.
- Approved versions remain available for downstream use.

## 11. Phase 7 — AI Team Coordination Engine

### Sprint 7A — Coordination Engine Foundation

Official name:

AI Team Coordination Engine

Implement:

- Workflow definition.
- Workflow version.
- Workflow step.
- Skill definition.
- Input contract.
- Output contract.
- Dependency graph.
- Execution state.
- Step state.
- Retry.
- Timeout.
- Failure handling.
- Human approval checkpoint.
- Cancellation.
- Idempotency.
- Execution events.

Execution states:

- Pending.
- Running.
- Waiting for Input.
- Waiting for Approval.
- Completed.
- Failed.
- Cancelled.

### Sprint 7B — AI Skills

Implement approved Skills incrementally:

- Business Analyzer.
- Marketing Strategist.
- Content Planner.
- Copywriter.
- Hook Generator.
- CTA Generator.
- Hashtag Generator.
- Quality Reviewer.

Each Skill must define:

- Purpose.
- Inputs.
- Outputs.
- Prompt key.
- Prompt version.
- Validation schema.
- Retry policy.
- Failure behavior.
- Cost recording.

### Sprint 7C — AI Execution Console

Add to Super Admin AI Operations.

Implement:

- Execution list.
- Search.
- Filter.
- Workflow status.
- Skill status.
- Prompt version.
- Model.
- Provider.
- Token or usage count.
- Estimated cost.
- Duration.
- Input summary.
- Validated output.
- Error.
- Retry.
- Cancel where safe.
- Correlation ID.
- Execution timeline.

Do not expose hidden chain-of-thought or private model reasoning.

## 12. Phase 8 — AI Operations Assistant

### Sprint 8A — Read-Only Operations Assistant

USER DECISION

Super Admin needs a conversational interface for interacting with the AI operations system.

The assistant is an operational interface, not a general-purpose chatbot.

Initial capabilities must be read-only:

- Explain why an execution failed.
- Summarize workflow status.
- Find failed executions.
- Show Prompt version used.
- Show model and provider used.
- Show cost summary.
- Compare execution outcomes.
- Identify repeated failure patterns.
- Navigate to relevant records.

Example:

User:

Why did Campaign 287 fail?

Assistant:

- Identifies the failed workflow.
- Identifies the failed step.
- Displays the validated error.
- Shows Prompt version and model.
- Provides links or actions to inspect records.

Acceptance Criteria:

- Answers are grounded in stored system data.
- Every answer identifies its source records.
- The assistant does not invent execution details.
- The assistant respects Super Admin permissions.
- Queries are auditable.

### Sprint 8B — Controlled Operations Actions

After read-only behavior is stable, add controlled actions:

- Retry failed execution.
- Cancel safe execution.
- Generate incident summary.
- Generate Prompt improvement proposal.
- Create Prompt Draft.
- Open Prompt comparison.
- Run Sandbox Test.
- Run Shadow Test.

Every write action requires:

1. Explicit action preview.
2. Permission check.
3. Human confirmation.
4. Audit record.
5. Result confirmation.

The assistant must not directly publish Prompt changes.

## 13. Phase 9 — Prompt Improvement Workflow

### Sprint 9 — AI-Assisted Prompt Improvement

USER DECISION

Prompt changes may be initiated through AI Operations Assistant, but actual Prompt management must occur through Prompt Library.

Required workflow:

1. Super Admin asks the Operations Assistant to analyze a quality issue.
2. Assistant queries:

- Recent executions.
- Quality scores.
- Failure patterns.
- Prompt versions.
- Model changes.
- Input distribution.
- Output validation failures.

3. Assistant provides a grounded diagnosis.
4. Assistant may recommend Prompt changes.
5. User selects:

Generate Draft

6. System creates a new Prompt Version with status:

Draft

7. Prompt Library opens the new Draft.
8. User reviews:

- Diff from current version.
- Proposed change reason.
- Variables.
- Output schema.
- Model compatibility.

9. User runs Sandbox Tests.
10. System compares:

- Current production version.
- New Draft version.

11. User may run Shadow Evaluation against approved historical cases.
12. Human reviewer approves the Draft.
13. Authorized user publishes the version.
14. New production executions use the published version.
15. System monitors quality and error rates.
16. Authorized user may rollback when required.

Prohibited:

- Chat message directly modifying a published Prompt.
- AI automatically publishing a Prompt.
- Overwriting production Prompt content.
- Deleting historical Prompt versions.
- Changing Prompt without audit history.

Acceptance Criteria:

- AI can generate a Draft but cannot publish it.
- Draft creation records the source analysis.
- Diff is visible.
- Tests are recorded.
- Publish requires explicit human action.
- Rollback is supported.
- Every execution identifies its Prompt version.

## 14. Phase 10 — Photo Scene V1

Architecture freeze: `docs/architecture/photo-scene-v1.md` (EMBEROS-PHOTO-SCENE-01A, 2026-08-17). Phase 10 is **IMPLEMENTATION_COMPLETE / RELEASE_PENDING**. Sprint 10A is CLOSED / PASS. Sprint 10B is **CLOSED / PASS**. Sprint 10C is **CLOSED / PASS**. Sprint 10D is **CLOSED / PASS**. Photo Scene V1 product loop is implemented. EMBEROS-PHOTO-SCENE-V1-PROD-01 is CONDITIONAL PASS. `PHOTO_SCENE_V1_BOUNDED_ASSEMBLY` is **BUILT / VALIDATED** on `release/photo-scene-v1-bounded` from `eea988d`. Do not mark RELEASED / FROZEN. Next is EMBEROS-PHOTO-SCENE-V1-PROD-03 production deploy + certification.

Photo Scene V1 is Creative Studio V1. Do not create a parallel Creative Studio product.

### Sprint 10A — Creative Asset Foundation

Status: CLOSED / PASS (EMBEROS-PHOTO-SCENE-10A)

Reuse existing `assets` + `campaign_asset_refs`. Roles in `metadata.photoScene`. No `creative_assets`, `creative_studio_jobs`, official scene table, or generation table.

Implement:

- Creative Asset entity.
- Workspace association.
- Campaign association.
- Asset type.
- Asset metadata.
- Folder or category.
- Generation history.
- Source asset references.
- Version references.

### Sprint 10B — Product Extraction

Status: CLOSED / PASS (EMBEROS-PHOTO-SCENE-10B-RUNTIME-ZERO-PAID-API)

`V1_BACKGROUND_REMOVAL_PROVIDER = photoroom`. Live provider quality remains inherited from `c72c343` (8/8 PNG+alpha, mean 4.95/5, median 875ms, configured $0.02). Durable runtime was certified separately against authorized preview Postgres + Redis + BullMQ using the deterministic adapter only: `PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER=true`, `PHOTOROOM_NETWORK_CALL_COUNT=0`, `CERT_RUNTIME_EXTERNAL_COST=USD 0`.

This deterministic run does **not** prove live-provider end-to-end persistence. Combined 10B evidence is sufficient: live quality CERTIFIED + durable runtime CERTIFIED. See `docs/architecture/photo-scene-provider-cert.md`.

Next is 10C Official Scene Library.

Durable `photo_scene_generations` extraction authority, private PNG output, retry/reuse, tenant isolation, and a provider-neutral adapter are implemented.

Implement:

- Product image upload.
- Background removal.
- Product extraction.
- Transparent output.
- Processing state.
- Quality validation.
- Retry.
- Manual correction entry point where approved.

### Sprint 10C — Official Scene Library

Status: CLOSED / PASS (EMBEROS-PHOTO-SCENE-10C)

Global official scene catalog with immutable `sceneId` + `sceneVersion`. Tenant users may select published versions and freeze placement. They cannot mutate the catalog. 10C does not create a marketing image and does not call paid image APIs.

Next is 10D Marketing Image Generation (CLOSED / PASS).

Implement:

- Curated official scenes.
- Scene categories.
- Scene preview.
- Scene selection.
- Product placement.
- Basic sizing and positioning.
- Save output.

### Sprint 10D — Marketing Image Generation

Status: CLOSED / PASS (EMBEROS-PHOTO-SCENE-10D)

Deterministic compositor on existing `photo_scene_generations` (`operation=marketing_image`). Reuses 10B `extracted_product`. Official scene + 10C placement + brand/marketing snapshots freeze before compose. Durable `marketing_image` asset in private `campaign-assets`. Signed preview/download. Retry keeps generation id. Generate Again creates a new id. Photoroom is not recalled for composition.

V1 composition authority: `DETERMINISTIC_COMPOSITOR`. No Flux / OpenAI image / custom AI scene generation.

PHOTO_SCENE_V1: IMPLEMENTATION_COMPLETE / RELEASE_PENDING. PHOTO_SCENE_V1_BOUNDED_ASSEMBLY: BUILT / VALIDATED. Next is PROD-03 production deploy + certification.

Implement:

- Platform dimensions.
- Logo placement.
- Brand colors.
- Text overlay.
- Campaign association.
- Marketing Package version reference.
- Save as Creative Asset.

V1 must use official scenes as the default.

Advanced AI-generated custom scenes remain a premium future capability.

## 15. Phase 11 — Video Studio V1

### Sprint 11A — Video Upload and Processing

Implement:

- Large video upload.
- Upload progress.
- Compression.
- Validation.
- Audio extraction.
- Scene detection.
- Transcription.
- Processing status.
- Failure recovery.

### Sprint 11B — Highlight Detection

Implement:

- Candidate segment detection.
- Marketing relevance scoring.
- Hook identification.
- Poor footage warning.
- Replacement recommendation.
- Clip ranking.
- Selection of three to five outputs.

### Sprint 11C — Video Generation

Implement:

- Trim.
- Subtitle.
- Chinese and English subtitles.
- TTS.
- BGM.
- Transitions.
- Cover.
- FFmpeg rendering.
- Campaign and Package references.

### Sprint 11D — Video Card Editing

Implement:

- Replace BGM.
- Adjust BGM start.
- Adjust audio levels.
- Edit subtitles.
- Regenerate subtitles.
- Replace TTS.
- Replace cover.
- Regenerate final video.

### Sprint 11E — Video Quality Review

Validate:

- Opening hook.
- Subtitle length.
- Audio balance.
- Scene quality.
- CTA presence.
- Brand consistency.
- Output readiness.

Warnings should be actionable and non-destructive.

## 16. Phase 12 — Publishing

### Sprint 12A — Publishing Manifest

Implement:

- Publishing ID.
- Immutable Publishing Manifest.
- Campaign ID and version.
- Marketing Package ID and version.
- Asset versions.
- Platform.
- Caption.
- Hashtags.
- Scheduled time.
- Publishing status.
- Created by.
- Audit metadata.

Published manifests are immutable.

Changes create a new version or new manifest according to Specification.

### Sprint 12B — Publishing Hub

Implement:

- Draft.
- Ready.
- Scheduled.
- Published.
- Failed.
- Manual publishing flow.
- Publishing queue.
- Platform limitations.
- Retry rules.
- Publishing audit history.

Do not require all social platform APIs before initial V1 launch.

Manual-assisted publishing is permitted where platform APIs are unavailable.

## 17. Phase 13 — Marketing Intelligence

### Sprint 13A — Performance Data

Implement:

- Post records.
- Views.
- Engagement.
- Clicks.
- Leads.
- Sales.
- Manual data entry.
- CSV import.
- Platform data adapters.

### Sprint 13B — Marketing Intelligence

Implement:

- Campaign performance.
- Content performance.
- Platform comparison.
- Best-performing hooks.
- Best-performing content formats.
- Trend indicators.
- Recommended next action.

Recommendations must distinguish:

- Observed data.
- AI inference.
- Missing data.

## 18. Phase 14 — Commercialization

### Sprint 14A — Stripe and Subscription

USER DECISION

Stripe is included in V1.

Implement:

- Plans.
- Subscription.
- Trial.
- Stripe Checkout.
- Customer Portal.
- Webhooks.
- Subscription status.
- Failed payment handling.
- Plan change.
- Cancellation.
- Billing audit records.

### Sprint 14B — Usage and Cost Control

Implement:

- AI usage limits.
- Image limits.
- Video limits.
- Storage limits.
- Workspace usage.
- Cost limits.
- Limit warnings.
- Hard-stop rules where approved.
- Super Admin usage visibility.
- Provider cost reconciliation.

### Sprint 14C — Onboarding

Implement:

- Workspace setup.
- Business Profile.
- First Campaign.
- First Asset upload.
- First Marketing Package.
- Guided next actions.
- Empty state guidance.
- Completion tracking.

## 19. Super Admin Delivery Sequence

Super Admin must be implemented incrementally.

Initial Foundation:

Sprint 1A

- Workspace management.
- User management.
- Feature flags.
- Audit logs.
- System status.

AI Foundation:

Sprint 1B

- AI Operations structure.
- Permissions.
- Navigation.
- Data contracts.

Operational Visibility:

Sprint 7C

- AI Execution Console.

Conversational Operations:

Sprint 8A

- Read-only Operations Assistant.

Controlled Actions:

Sprint 8B

- Retry.
- Incident summary.
- Draft generation.
- Test initiation.

Prompt Improvement:

Sprint 9

- Analysis.
- Draft creation.
- Testing.
- Human publish.
- Rollback.

Commercial Operations:

Sprint 14

- Subscription.
- Usage.
- Cost.
- Billing visibility.

Do not attempt to complete the entire Super Admin product in one Sprint.

## 20. Release Boundaries

### Internal Alpha

Required:

- Engineering Foundation.
- Authentication.
- Workspace and permissions.
- Super Admin MVP.
- Business Profile.
- Campaign.
- Campaign Assets.
- Command Center with real APIs.
- Prompt Library foundation.
- AI Router foundation.
- Marketing Package.

Primary test flow:

Business Profile

↓

Campaign

↓

Assets

↓

Marketing Package

### Private Beta

Required:

- Internal Alpha.
- AI Team Coordination Engine.
- AI Execution Console.
- AI Operations Assistant read-only mode.
- Photo Scene V1.

Test businesses:

- Florist.
- Handmade crafts.
- Restaurant.

Validation model:

1. Operate the system for test users.
2. Teach users.
3. Observe users operating independently.
4. Improve UX based on actual behavior.

### Paid V1

Required:

- Private Beta.
- Prompt improvement workflow.
- Video Studio V1.
- Publishing Manifest.
- Publishing Hub.
- Stripe.
- Usage controls.
- Onboarding.
- Required privacy, security, and operational controls.

Marketing Intelligence may continue to mature after initial paid launch, provided required performance recording is available.

## 21. Definition of Done for Each Sprint

A Sprint is not complete until all applicable items pass:

### Specification

- Implementation matches the authoritative SPEC.
- UI matches the authoritative UI-SPEC.
- Prompt behavior matches Prompt Library definitions.
- No unauthorized product redesign.

### Database

- Migration created.
- Migration tested.
- Constraints defined.
- Workspace scoping enforced.
- Rollback considered.

### Security

- Authentication enforced.
- Authorization enforced.
- Row-level security tested.
- Sensitive data excluded from logs.
- Admin actions audited.

### API

- Input validation.
- Error contracts.
- Idempotency where required.
- Permission checks.
- Pagination where required.
- Real data source.

### Frontend

- Loading state.
- Empty state.
- Error state.
- Permission state.
- Responsive behavior.
- Accessibility basics.
- No Dead End UX.

### AI

- Prompt version recorded.
- Model and provider recorded.
- Structured output validated.
- Cost recorded.
- Retry behavior defined.
- Failure is visible.
- No direct production Prompt mutation.

### Testing

- Unit tests.
- Integration tests.
- Permission tests.
- API tests.
- Critical UI tests.
- Regression tests.
- Manual acceptance checklist.

### Operations

- Logs are available.
- Audit records are available.
- Errors can be diagnosed.
- Feature can be disabled safely when applicable.
- Deployment notes are documented.

### Git

- Working tree reviewed.
- No unrelated files.
- Diff check passes.
- Commit message is scoped.
- Commit is pushed only after acceptance.

## 22. Codex Execution Behavior

For every Sprint, Codex must first return:

1. Blueprint files reviewed.
2. Existing implementation inspected.
3. Dependencies.
4. Proposed files to create.
5. Proposed files to modify.
6. Database changes.
7. API changes.
8. UI changes.
9. Security considerations.
10. Test plan.
11. Risks.
12. Acceptance criteria.

Codex must not start implementation when:

- A required Specification is missing.
- Blueprint documents conflict.
- Database ownership is unclear.
- Permission behavior is undefined.
- The task requires a new product decision.

When blocked, return:

BLOCKED

Reason

Required Decision

Affected Files

Do not guess.

## 23. First Implementation Target

Begin with:

Phase 0

Engineering Foundation

Before implementation:

Inspect the current EmberOS Repository.

Determine which Phase 0 capabilities already exist.

Do not recreate completed work.

Return a gap analysis grouped as:

- Complete.
- Partial.
- Missing.
- Incorrect or inconsistent.
- Recommended first implementation task.

Do not modify files during the initial gap analysis.

## Current overlay status — AI Story Self-Use V1

Ticket `EMBEROS-AI-STORY-EXEC-02` (2026-08-19).

`AI_STORY_SELF_USE_V1_BOUNDED_ASSEMBLY` is **BUILT / VALIDATED** on `release/ai-story-self-use-v1-bounded` from production pin `b447f539400f2765958c1c94add708a979c86604`. Source authority is `release/sprint-4-phase-b` @ `cfaa8950e682b0cd512514d52a4e7d9c5113cd60` (patch-extract only; no full-branch merge).

AI Story remains NOT RELEASED. This overlay is not deployed and does not apply production schema.

Video Studio V1 and Photo Scene V1 files are unchanged except a bounded AI Story entry on the existing campaign dashboard.

Next implementation ticket: `EMBEROS-AI-STORY-EXEC-03` (Super Admin / Agency execute without Stripe/credit activation). Follow-ups remain EXEC-05, EXEC-04, EXEC-06. See `docs/releases/ai-story-self-use-v1-bounded-assembly.md`.
