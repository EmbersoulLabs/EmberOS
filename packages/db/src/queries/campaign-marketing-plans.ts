import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  CampaignCreativeModuleSchema,
  CampaignMarketingPlanContentSchema,
  type CampaignMarketingPlanContent,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";
import { CampaignContentIterationError } from "./campaign-content-iterations";

type Db = ReturnType<typeof getDb>;
export type CampaignMarketingPlanScope = { orgId: string; workspaceId: string; campaignId: string; actorUserId: string };
const MUTATION_ROLES = new Set(["admin", "operator", "editor"]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }

async function assertScope(db: Pick<Db, "execute">, scope: CampaignMarketingPlanScope, mutation: boolean) {
  const rows = await db.execute<{ role: string }>(sql`select wm.role from campaigns c join workspace_members wm on wm.workspace_id=c.workspace_id and wm.org_id=c.org_id where c.id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid and c.workspace_id=${scope.workspaceId}::uuid and wm.user_id=${scope.actorUserId}::uuid limit 1`);
  const role = rows[0]?.role;
  if (!role) throw new CampaignContentIterationError("CAMPAIGN_SCOPE_DENIED", "Campaign does not resolve inside the actor Workspace");
  if (mutation && !MUTATION_ROLES.has(role)) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_ROLE_DENIED", "Workspace role cannot mutate Marketing Plans");
}

export class CampaignMarketingPlanService {
  constructor(private readonly db: Db = getDb()) {}

  async list(scope: CampaignMarketingPlanScope, iterationId: string) {
    await assertScope(this.db, scope, false);
    return this.db.select().from(schema.campaignMarketingPlanVersions).where(and(
      eq(schema.campaignMarketingPlanVersions.iterationId, iterationId),
      eq(schema.campaignMarketingPlanVersions.orgId, scope.orgId),
      eq(schema.campaignMarketingPlanVersions.workspaceId, scope.workspaceId),
      eq(schema.campaignMarketingPlanVersions.campaignId, scope.campaignId),
    )).orderBy(asc(schema.campaignMarketingPlanVersions.revision));
  }

  async createRevision(scope: CampaignMarketingPlanScope, iterationId: string, input: { expectedIterationVersion: number; expectedLatestRevision: number; idempotencyKey: string; content: CampaignMarketingPlanContent }) {
    const content = CampaignMarketingPlanContentSchema.parse(input.content);
    const contentFingerprint = fingerprint(content);
    return this.db.transaction(async (tx) => {
      await assertScope(tx, scope, true);
      const [iteration] = await tx.select().from(schema.campaignContentIterations).where(and(eq(schema.campaignContentIterations.id, iterationId), eq(schema.campaignContentIterations.workspaceId, scope.workspaceId), eq(schema.campaignContentIterations.campaignId, scope.campaignId))).for("update").limit(1);
      if (!iteration) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_NOT_FOUND", "Iteration does not resolve inside the Campaign scope");
      const commandFingerprint = fingerprint({ kind: "PLAN_PROPOSED", content });
      const [existingFact] = await tx.select().from(schema.campaignWorkflowFacts).where(and(eq(schema.campaignWorkflowFacts.iterationId, iterationId), eq(schema.campaignWorkflowFacts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existingFact) {
        if (existingFact.commandFingerprint !== commandFingerprint) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_IDEMPOTENCY_CONFLICT", "Idempotency key was reused with different Plan content");
        const [reused] = await tx.select().from(schema.campaignMarketingPlanVersions).where(and(eq(schema.campaignMarketingPlanVersions.iterationId, iterationId), eq(schema.campaignMarketingPlanVersions.contentFingerprint, contentFingerprint))).limit(1);
        return { plan: reused!, iteration, reused: true };
      }
      if (iteration.state !== "PLANNING") throw new CampaignContentIterationError("CAMPAIGN_ITERATION_TRANSITION_INVALID", "Marketing Plans can only be revised while the iteration is PLANNING");
      if (iteration.version !== input.expectedIterationVersion) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_VERSION_CONFLICT", "Iteration changed before the Plan revision was saved");
      const [latest] = await tx.select().from(schema.campaignMarketingPlanVersions).where(eq(schema.campaignMarketingPlanVersions.iterationId, iterationId)).orderBy(sql`${schema.campaignMarketingPlanVersions.revision} desc`).limit(1);
      if ((latest?.revision ?? 0) !== input.expectedLatestRevision) throw new CampaignContentIterationError("CAMPAIGN_MARKETING_PLAN_REVISION_CONFLICT", "A newer Marketing Plan revision already exists");
      if (content.assetIds.length) {
        const linked = await tx.select({ id: schema.assets.id }).from(schema.assets).leftJoin(schema.campaignAssetRefs, and(eq(schema.campaignAssetRefs.assetId, schema.assets.id), eq(schema.campaignAssetRefs.campaignId, scope.campaignId))).where(and(inArray(schema.assets.id, content.assetIds), eq(schema.assets.workspaceId, scope.workspaceId), isNull(schema.assets.deletedAt), sql`(${schema.assets.campaignId}=${scope.campaignId}::uuid or ${schema.campaignAssetRefs.campaignId}=${scope.campaignId}::uuid)`));
        if (new Set(linked.map((row) => row.id)).size !== new Set(content.assetIds).size) throw new CampaignContentIterationError("CAMPAIGN_ASSET_REF_DENIED", "Plan assets must belong to this Campaign and Workspace");
      }
      const [profile] = await tx.select().from(schema.businessProfiles).where(and(eq(schema.businessProfiles.workspaceId, scope.workspaceId), isNull(schema.businessProfiles.deletedAt))).limit(1);
      if (!profile) throw new CampaignContentIterationError("BUSINESS_PROFILE_REQUIRED", "An authoritative Business Profile is required");
      const profileRecord = profile as unknown as Record<string, unknown>;
      const businessFacts = Object.fromEntries(content.businessFactRefs.map((key) => {
        if (!(key in profileRecord) || profileRecord[key] == null || profileRecord[key] === "") throw new CampaignContentIterationError("CAMPAIGN_MARKETING_PLAN_FACT_UNAUTHORIZED", `Business Profile fact ${key} is unavailable`);
        return [key, profileRecord[key]];
      }));
      const revision = (latest?.revision ?? 0) + 1;
      const [plan] = await tx.insert(schema.campaignMarketingPlanVersions).values({ orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, iterationId, revision, content, contentFingerprint, businessProfileVersion: profile.version, businessFacts, createdBy: scope.actorUserId }).returning();
      const nextVersion = iteration.version + 1;
      const [updated] = await tx.update(schema.campaignContentIterations).set({ version: nextVersion, updatedAt: new Date() }).where(and(eq(schema.campaignContentIterations.id, iterationId), eq(schema.campaignContentIterations.version, iteration.version))).returning();
      if (!updated) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_VERSION_CONFLICT", "Plan revision lost a concurrent race");
      await tx.insert(schema.campaignWorkflowFacts).values({ orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, iterationId, factType: "PLAN_PROPOSED", sequenceNumber: nextVersion, fromState: "PLANNING", toState: null, iterationVersion: nextVersion, payload: { planId: plan!.id, revision, businessProfileVersion: profile.version }, idempotencyKey: input.idempotencyKey, commandFingerprint, actorUserId: scope.actorUserId });
      return { plan: plan!, iteration: updated, reused: false };
    });
  }

  async approve(scope: CampaignMarketingPlanScope, iterationId: string, input: { planId: string; expectedRevision: number; expectedIterationVersion: number; selectedModule: string; idempotencyKey: string }) {
    const selectedModule = CampaignCreativeModuleSchema.parse(input.selectedModule);
    return this.db.transaction(async (tx) => {
      await assertScope(tx, scope, true);
      const [iteration] = await tx.select().from(schema.campaignContentIterations).where(and(eq(schema.campaignContentIterations.id, iterationId), eq(schema.campaignContentIterations.workspaceId, scope.workspaceId), eq(schema.campaignContentIterations.campaignId, scope.campaignId))).for("update").limit(1);
      if (!iteration) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_NOT_FOUND", "Iteration not found");
      const commandFingerprint = fingerprint({ kind: "PLAN_APPROVED", planId: input.planId, revision: input.expectedRevision, selectedModule });
      const [existingFact] = await tx.select().from(schema.campaignWorkflowFacts).where(and(eq(schema.campaignWorkflowFacts.iterationId, iterationId), eq(schema.campaignWorkflowFacts.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existingFact) {
        if (existingFact.commandFingerprint !== commandFingerprint) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_IDEMPOTENCY_CONFLICT", "Approval idempotency key was reused");
        const [plan] = await tx.select().from(schema.campaignMarketingPlanVersions).where(eq(schema.campaignMarketingPlanVersions.id, input.planId)).limit(1);
        return { plan: plan!, iteration, reused: true };
      }
      if (iteration.state !== "PLANNING" || iteration.version !== input.expectedIterationVersion) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_VERSION_CONFLICT", "Iteration changed before Plan approval");
      const [latest] = await tx.select().from(schema.campaignMarketingPlanVersions).where(eq(schema.campaignMarketingPlanVersions.iterationId, iterationId)).orderBy(sql`${schema.campaignMarketingPlanVersions.revision} desc`).limit(1);
      if (!latest || latest.id !== input.planId || latest.revision !== input.expectedRevision || latest.status !== "DRAFT") throw new CampaignContentIterationError("CAMPAIGN_MARKETING_PLAN_REVISION_CONFLICT", "Only the latest exact draft revision can be approved");
      const [plan] = await tx.update(schema.campaignMarketingPlanVersions).set({ status: "APPROVED", selectedModule, approvedBy: scope.actorUserId, approvedAt: new Date() }).where(and(eq(schema.campaignMarketingPlanVersions.id, latest.id), eq(schema.campaignMarketingPlanVersions.status, "DRAFT"))).returning();
      const nextVersion = iteration.version + 1;
      const [updated] = await tx.update(schema.campaignContentIterations).set({ state: "PLAN_APPROVED", version: nextVersion, updatedAt: new Date() }).where(and(eq(schema.campaignContentIterations.id, iterationId), eq(schema.campaignContentIterations.version, iteration.version))).returning();
      if (!updated) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_VERSION_CONFLICT", "Plan approval lost a concurrent race");
      await tx.insert(schema.campaignWorkflowFacts).values({ orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, iterationId, factType: "PLAN_APPROVED", sequenceNumber: nextVersion, fromState: "PLANNING", toState: "PLAN_APPROVED", iterationVersion: nextVersion, payload: { planId: latest.id, revision: latest.revision, selectedModule }, idempotencyKey: input.idempotencyKey, commandFingerprint, actorUserId: scope.actorUserId });
      return { plan: plan!, iteration: updated, reused: false };
    });
  }
}
