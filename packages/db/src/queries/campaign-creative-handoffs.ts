import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { CampaignMarketingPlanContentSchema, campaignCreativeDestinationReference } from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";
import { CampaignContentIterationError } from "./campaign-content-iterations";

type Db = ReturnType<typeof getDb>;
export type CampaignCreativeHandoffScope = { orgId: string; workspaceId: string; campaignId: string; actorUserId: string };
const MUTATION_ROLES = new Set(["admin", "operator", "editor"]);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function assertScope(db: Pick<Db, "execute">, scope: CampaignCreativeHandoffScope, mutation: boolean) {
  const rows = await db.execute<{ role: string }>(sql`select wm.role from campaigns c join workspace_members wm on wm.workspace_id=c.workspace_id and wm.org_id=c.org_id where c.id=${scope.campaignId}::uuid and c.org_id=${scope.orgId}::uuid and c.workspace_id=${scope.workspaceId}::uuid and wm.user_id=${scope.actorUserId}::uuid limit 1`);
  const role = rows[0]?.role;
  if (!role) throw new CampaignContentIterationError("CAMPAIGN_SCOPE_DENIED", "Campaign does not resolve inside the actor Workspace");
  if (mutation && !MUTATION_ROLES.has(role)) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_ROLE_DENIED", "Workspace role cannot initialize Creative Modules");
}

export class CampaignCreativeHandoffService {
  constructor(private readonly db: Db = getDb()) {}

  async list(scope: CampaignCreativeHandoffScope, iterationId?: string) {
    await assertScope(this.db, scope, false);
    return this.db.select().from(schema.campaignCreativeHandoffs).where(and(
      eq(schema.campaignCreativeHandoffs.orgId, scope.orgId),
      eq(schema.campaignCreativeHandoffs.workspaceId, scope.workspaceId),
      eq(schema.campaignCreativeHandoffs.campaignId, scope.campaignId),
      iterationId ? eq(schema.campaignCreativeHandoffs.iterationId, iterationId) : undefined,
    )).orderBy(asc(schema.campaignCreativeHandoffs.createdAt));
  }

  async createOrResume(scope: CampaignCreativeHandoffScope, input: { iterationId: string; approvedPlanId: string; idempotencyKey: string }) {
    return this.db.transaction(async (tx) => {
      await assertScope(tx, scope, true);
      const [iteration] = await tx.select().from(schema.campaignContentIterations).where(and(
        eq(schema.campaignContentIterations.id, input.iterationId), eq(schema.campaignContentIterations.orgId, scope.orgId),
        eq(schema.campaignContentIterations.workspaceId, scope.workspaceId), eq(schema.campaignContentIterations.campaignId, scope.campaignId),
      )).for("update").limit(1);
      if (!iteration) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_NOT_FOUND", "Content Iteration does not resolve inside this Campaign");
      const [plan] = await tx.select().from(schema.campaignMarketingPlanVersions).where(and(
        eq(schema.campaignMarketingPlanVersions.id, input.approvedPlanId),
        eq(schema.campaignMarketingPlanVersions.iterationId, input.iterationId),
        eq(schema.campaignMarketingPlanVersions.workspaceId, scope.workspaceId),
        eq(schema.campaignMarketingPlanVersions.campaignId, scope.campaignId),
      )).limit(1);
      if (!plan || plan.status !== "APPROVED" || !plan.selectedModule) throw new CampaignContentIterationError("CAMPAIGN_HANDOFF_PLAN_NOT_APPROVED", "Handoff requires the exact approved Plan revision and user-selected module");
      const content = CampaignMarketingPlanContentSchema.parse(plan.content);
      const commandFingerprint = digest({ iterationId: input.iterationId, approvedPlanId: plan.id, selectedModule: plan.selectedModule });
      const [sameKey] = await tx.select().from(schema.campaignCreativeHandoffs).where(and(
        eq(schema.campaignCreativeHandoffs.iterationId, input.iterationId), eq(schema.campaignCreativeHandoffs.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (sameKey && sameKey.commandFingerprint !== commandFingerprint) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_IDEMPOTENCY_CONFLICT", "Handoff idempotency key was reused for a different destination");
      const [existing] = sameKey ? [sameKey] : await tx.select().from(schema.campaignCreativeHandoffs).where(eq(schema.campaignCreativeHandoffs.iterationId, input.iterationId)).limit(1);
      if (existing) {
        if (existing.approvedPlanId !== plan.id || existing.selectedModule !== plan.selectedModule) throw new CampaignContentIterationError("CAMPAIGN_HANDOFF_DESTINATION_CONFLICT", "Iteration is already bound to another approved Plan or module");
        return { handoff: existing, iteration, reused: true };
      }
      if (iteration.state !== "PLAN_APPROVED") throw new CampaignContentIterationError("CAMPAIGN_HANDOFF_STATE_INVALID", "Only a newly approved Plan can initialize its Creative Module");
      if (content.assetMode === "ASSET_BASED") {
        const linked = await tx.select({ id: schema.assets.id }).from(schema.assets).leftJoin(schema.campaignAssetRefs, and(eq(schema.campaignAssetRefs.assetId, schema.assets.id), eq(schema.campaignAssetRefs.campaignId, scope.campaignId))).where(and(
          inArray(schema.assets.id, content.assetIds), eq(schema.assets.workspaceId, scope.workspaceId), isNull(schema.assets.deletedAt),
          sql`(${schema.assets.campaignId}=${scope.campaignId}::uuid or ${schema.campaignAssetRefs.campaignId}=${scope.campaignId}::uuid)`,
        ));
        if (new Set(linked.map((row) => row.id)).size !== new Set(content.assetIds).size) throw new CampaignContentIterationError("CAMPAIGN_HANDOFF_ASSET_UNAVAILABLE", "An approved Plan asset is no longer authorized or available");
      }
      const destinationReference = campaignCreativeDestinationReference(plan.selectedModule as "VIDEO_STUDIO" | "PHOTO_SCENE" | "AI_STORY", scope.campaignId);
      const [handoff] = await tx.insert(schema.campaignCreativeHandoffs).values({
        orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId,
        iterationId: input.iterationId, approvedPlanId: plan.id, selectedModule: plan.selectedModule,
        assetMode: content.assetMode, assetIds: content.assetIds,
        businessProfileSnapshotRef: `marketing-plan:${plan.id}:business-profile:v${plan.businessProfileVersion}`,
        idempotencyKey: input.idempotencyKey, commandFingerprint, destinationReference, createdBy: scope.actorUserId,
      }).returning();
      if (!handoff) throw new CampaignContentIterationError("CAMPAIGN_HANDOFF_CREATE_FAILED", "Creative Module handoff was not persisted");
      const nextVersion = iteration.version + 1;
      const [updated] = await tx.update(schema.campaignContentIterations).set({ state: "CREATIVE_IN_PROGRESS", version: nextVersion, updatedAt: new Date() }).where(and(
        eq(schema.campaignContentIterations.id, iteration.id), eq(schema.campaignContentIterations.version, iteration.version),
      )).returning();
      if (!updated) throw new CampaignContentIterationError("CAMPAIGN_ITERATION_VERSION_CONFLICT", "Handoff lost a concurrent race");
      await tx.insert(schema.campaignWorkflowFacts).values({
        orgId: scope.orgId, workspaceId: scope.workspaceId, campaignId: scope.campaignId, iterationId: iteration.id,
        factType: "MODULE_SELECTED", sequenceNumber: nextVersion, fromState: "PLAN_APPROVED", toState: "CREATIVE_IN_PROGRESS",
        iterationVersion: nextVersion, payload: { handoffId: handoff.id, planId: plan.id, revision: plan.revision, selectedModule: plan.selectedModule, destinationReference },
        idempotencyKey: input.idempotencyKey, commandFingerprint, actorUserId: scope.actorUserId,
      });
      return { handoff, iteration: updated, reused: false };
    });
  }
}
