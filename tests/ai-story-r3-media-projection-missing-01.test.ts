import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  GeneratedSceneMediaReadModelSchema,
  ProjectedSceneResultSchema,
} from "../packages/shared/src";
import { assertSceneMediaResultAuthority } from "../apps/web/src/lib/ai-story-scene-media-playback";

const workspaceId = "a12f7a1e-5825-41f2-a710-26807184fb98";
const executionPlanId = "8831afe0-e22b-561e-ba8a-9087996a9113";
const sceneExecutionId = "0209531f-1385-55b5-bf52-a4439c2ceb1e";
const providerAttemptId = "9ad011bd-afe6-57cd-828e-e1facd3d3f08";
const sceneResultId = "a652f317-69f5-5bb3-b4c1-7835df0eb28a";

function resultFixture() {
  return ProjectedSceneResultSchema.parse({
    sceneResultId,
    executionPlanId,
    sceneRuntimeId: "11111111-1111-4111-8111-111111111111",
    sceneExecutionId,
    sceneId: "scene-001",
    sceneOrder: 0,
    ownership: {
      orgId: "22222222-2222-4222-8222-222222222222",
      workspaceId,
      campaignId: "8d1bdda0-fabc-48b2-9936-cc16224f98e3",
      storyId: "36430b98-5f2b-425a-a176-0c9205f3a74c",
      storyVersionId: "138db6eb-9001-4ceb-a79f-68079af2a186",
      animationPackageId: "33333333-3333-4333-8333-333333333333",
      executionPlanId,
    },
    status: "SUCCEEDED",
    failureClassification: null,
    mediaReference: {
      uri: `${workspaceId}/ai-story/scenes/${sceneResultId}.mp4`,
      contentHash: `sha256:${"a".repeat(64)}`,
      mediaType: "video/mp4",
    },
    durationMs: 5000,
    acceptedAt: "2026-08-22T00:00:00.000Z",
    integrityHash: `sha256:${"b".repeat(64)}`,
    contractVersion: "1",
    providerExecutionId: "provider-execution-1",
    providerAttemptId,
    providerFinalizationReference: "finalization-1",
    providerUsageReference: "usage-1",
    providerCostReference: "cost-1",
    projectedAt: "2026-08-22T00:00:01.000Z",
    projectionVersion: 1,
  });
}

describe("R3 existing Scene media projection", () => {
  it("projects browser-safe identity without a durable object key", () => {
    const media = GeneratedSceneMediaReadModelSchema.parse({
      mediaId: sceneResultId,
      sceneResultId,
      sceneExecutionId,
      providerAttemptId,
      mediaType: "video/mp4",
      contentType: "video/mp4",
      deliveryUrl: "https://example.test/signed-scene-media",
      expiresAt: "2026-08-22T00:10:00.000Z",
      deliveryStatus: "READY",
      safeError: null,
    });
    expect(media.sceneResultId).toBe(sceneResultId);
    expect(media).not.toHaveProperty("objectKey");
    expect(media).not.toHaveProperty("storagePath");
  });

  it("requires exact workspace, plan, Scene, result, and attempt binding", () => {
    const result = resultFixture();
    const authority = {
      workspaceId,
      executionPlanId,
      sceneExecutionId,
      providerAttemptId,
      sceneResultId,
      result,
    };
    expect(assertSceneMediaResultAuthority(authority)).toContain(workspaceId);
    expect(() =>
      assertSceneMediaResultAuthority({ ...authority, providerAttemptId: "wrong-attempt" })
    ).toThrow(/identity/);
    expect(() =>
      assertSceneMediaResultAuthority({
        ...authority,
        workspaceId: "44444444-4444-4444-8444-444444444444",
      })
    ).toThrow(/identity/);
  });

  it("uses short-lived private delivery and never regenerates on preview failure", async () => {
    const signer = await readFile(
      "apps/web/src/lib/ai-story-scene-media-playback.ts",
      "utf8"
    );
    const route = await readFile(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route.ts",
      "utf8"
    );
    expect(signer).toContain("AI_STORY_SCENE_PLAYBACK_TTL_SECONDS = 10 * 60");
    expect(signer).toContain("createSignedUrl");
    expect(route).toContain('deliveryStatus: "UNAVAILABLE"');
    expect(route).not.toContain("postCanonicalExecute");
    expect(route).not.toContain("retry");
  });

  it("renders manual video controls and a safe delivery error", async () => {
    const source = await readFile(
      "apps/web/src/components/ai-story/GeneratedSceneReviewPanel.tsx",
      "utf8"
    );
    expect(source).toContain("<video");
    expect(source).toContain("controls");
    expect(source).toContain('preload="metadata"');
    expect(source).not.toContain("autoPlay");
    expect(source).toContain("generated-scene-media-error");
  });
});
