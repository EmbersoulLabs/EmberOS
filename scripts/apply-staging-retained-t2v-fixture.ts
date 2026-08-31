/**
 * Idempotently append the retained V1 certification T2V Scene through the
 * canonical approved-package revision service. STAGING only; no Provider or
 * commercial authority is touched.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  AnimationPackagePayloadSchema,
  validatePlanningConsistency,
} from "@ceo-agent/shared";
import {
  createApprovedAnimationPackageRevision,
  validateApprovedAnimationPackageRevision,
} from "../apps/web/src/lib/ai-story-planning-service";

const TICKET_ID =
  "EMBEROS-AI-STORY-STAGING-RETAINED-CERTIFICATION-T2V-SCENE-FIXTURE-REPAIR-01";
const ORG_ID = "93f3e971-248e-470a-a2b2-1ea7bf33a9c7";
const WORKSPACE_ID = "3af079b8-e3c3-4eaa-a81b-f03405a2cfc0";
const CAMPAIGN_ID = "73c428ee-c768-42fa-8700-4ca975a7b68a";
const STORY_ID = "78aa7ccc-6377-475a-80a6-949b1a0b735e";
const PREVIOUS_STORY_VERSION_ID = "18a911ca-9443-4923-8f36-41e5aa76296c";
const PREVIOUS_ANIMATION_PACKAGE_ID = "d032ab35-1c38-4bce-8571-38093a4f88e5";
const ACTOR_USER_ID = "09080e3d-1baa-490d-b867-0316d99ae9e4";
const T2V_SCENE_ID = "6d5e4dd7-caf5-4b62-bb3e-d5eef96aee55";
const T2V_BEAT_ID = "7f093f5b-f25c-4a52-b8bc-9079007105c7";
const T2V_SHOT_ID = "a48f74a6-715d-437b-96f7-2340540263b9";

function buildRevisedPayload(previousRaw: unknown) {
  const previous = AnimationPackagePayloadSchema.parse(previousRaw);
  const next = structuredClone(previous);
  next.storyBeats.push({
    id: T2V_BEAT_ID,
    name: "Spring atmospheric transition",
    purpose: "Certify explicit reference-free text-to-video execution",
    order: next.storyBeats.length,
    summary:
      "Morning light moves through a calm spring environment, establishing a transition without product or media identity conditioning.",
  });
  next.scenePlan.push({
    id: T2V_SCENE_ID,
    beatIds: [T2V_BEAT_ID],
    purpose:
      "Establish a pure textual spring transition suitable for reference-free T2V certification.",
    durationSec: 5,
    transition: "Gentle dissolve",
    continuityNotes:
      "Entry: calm early-spring morning. Exit: warmer light and forward visual momentum. No product, first-frame, or media-reference continuity is required.",
    order: next.scenePlan.length,
    generationAuthority: {
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      referenceAssetIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    },
  });
  next.shotPlan.push({
    id: T2V_SHOT_ID,
    sceneId: T2V_SCENE_ID,
    beatIds: [T2V_BEAT_ID],
    cameraType: "Wide establishing shot",
    cameraMovement: "Slow controlled drift",
    composition: "Open vertical composition with layered spring foliage and morning light",
    framing: "9:16 vertical",
    lensSuggestion: "35mm equivalent",
    durationSec: 5,
    focus: "Atmospheric spring light and environmental motion",
    emotion: "Hopeful and calm",
    information: "Time, light, and mood transition without product identity",
    order: 0,
  });
  return validateApprovedAnimationPackageRevision(previous, next);
}

async function main() {
  if ((process.env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() !== "staging") {
    throw new Error("STAGING_ENVIRONMENT_REQUIRED");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  const db = getDb();
  const [previousPackage] = await db
    .select()
    .from(schema.aiStoryAnimationPackages)
    .where(eq(schema.aiStoryAnimationPackages.id, PREVIOUS_ANIMATION_PACKAGE_ID))
    .limit(1);
  if (!previousPackage) throw new Error("PREVIOUS_ANIMATION_PACKAGE_REQUIRED");
  const payload = buildRevisedPayload(previousPackage.payload);
  const consistency = validatePlanningConsistency(payload);
  if (!consistency.consistent) {
    throw new Error(`ANIMATION_PACKAGE_INCONSISTENT:${consistency.issues.join("|")}`);
  }
  const dryRun = !process.argv.includes("--apply");
  if (dryRun) {
    console.log(
      JSON.stringify({
        result: "PASS",
        mode: "DRY_RUN",
        previousStoryVersionId: PREVIOUS_STORY_VERSION_ID,
        previousAnimationPackageId: PREVIOUS_ANIMATION_PACKAGE_ID,
        previousSceneCount: AnimationPackagePayloadSchema.parse(previousPackage.payload).scenePlan.length,
        newSceneCount: payload.scenePlan.length,
        t2vSceneId: T2V_SCENE_ID,
        generationAuthority: payload.scenePlan.at(-1)?.generationAuthority,
        consistency: consistency.consistent,
      })
    );
    return;
  }
  const result = await createApprovedAnimationPackageRevision(db, {
    orgId: ORG_ID,
    workspaceId: WORKSPACE_ID,
    campaignId: CAMPAIGN_ID,
    storyId: STORY_ID,
    expectedStoryVersionId: PREVIOUS_STORY_VERSION_ID,
    expectedAnimationPackageId: PREVIOUS_ANIMATION_PACKAGE_ID,
    actorUserId: ACTOR_USER_ID,
    correlationId: TICKET_ID,
    reason: "AI Story V1 STAGING retained certification fixture repair",
    payload,
  });
  console.log(
    JSON.stringify({
      result: "PASS",
      mode: "APPLY",
      idempotent: result.idempotent,
      storyVersionId: result.version.id,
      storyVersionNumber: result.version.versionNumber,
      animationPackageId: result.animationPackage.id,
      animationPackageStatus: result.animationPackage.status,
      t2vSceneId: T2V_SCENE_ID,
      sceneCount: AnimationPackagePayloadSchema.parse(result.animationPackage.payload).scenePlan.length,
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "T2V_FIXTURE_APPLICATION_FAILED");
  process.exitCode = 1;
});
