import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFinalStoryDelivery, FinalStoryDeliveryError } from "../apps/web/src/lib/ai-story-final-story-delivery";

const ids = {
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  executionPlanId: "10000000-0000-4000-8000-000000000005",
  artifactId: "10000000-0000-4000-8000-000000000006",
  jobId: "10000000-0000-4000-8000-000000000007",
};

function dependencies(overrides: Record<string, unknown> = {}) {
  const ctx = { ...ids, userId: "user", storyTitle: "My Launch / Story", db: {}, plan: {} };
  const result = {
    ...ids,
    finalStoryResultId: "10000000-0000-4000-8000-000000000008",
    assemblyArtifactId: ids.artifactId,
    assemblyJobId: ids.jobId,
    outputMediaReference: `${ids.workspaceId}/ai-story/final.mp4`,
    contentHash: "sha256:final",
    ownership: { ...ids },
  };
  const artifact = {
    artifactId: ids.artifactId,
    assemblyJobId: ids.jobId,
    executionPlanId: ids.executionPlanId,
    artifactReference: result.outputMediaReference,
    contentHash: result.contentHash,
    mediaType: "video/mp4",
    ownership: { ...ids },
  };
  return {
    authorize: vi.fn().mockResolvedValue(ctx),
    getResult: vi.fn().mockResolvedValue(result),
    getArtifact: vi.fn().mockResolvedValue(artifact),
    mint: vi.fn().mockResolvedValue({ downloadUrl: "https://signed.example/final?token=short", expiresInSeconds: 900 }),
    ...overrides,
  } as any;
}

const input = { userId: "user", campaignId: ids.campaignId, storyId: ids.storyId, executionPlanId: ids.executionPlanId };

describe("RC-FIX-002 canonical Final Story Result delivery", () => {
  it("keeps preview and exposes an eligibility-bound loading/error/retry download UX", () => {
    const viewer = readFileSync("apps/web/src/components/ai-story/FinalStoryResultViewer.tsx", "utf8");
    expect(viewer).toMatch(/data-testid="final-story-video"/);
    expect(viewer).toMatch(/model\?\.playbackUrl[\s\S]*data-testid="final-story-download"/);
    expect(viewer).toMatch(/disabled=\{downloadLoading\}/);
    expect(viewer).toMatch(/final-story-download-error[\s\S]*downloadRetry/);
    expect(viewer).not.toMatch(/objectKey|storageKey|providerUrl/);
  });

  it("uses the existing private bucket abstraction and signed download disposition", () => {
    const signer = readFileSync("apps/web/src/lib/ai-story-final-story-playback.ts", "utf8");
    expect(signer).toMatch(/createSignedUrl\([\s\S]*\{ download: input\.filename \}/);
    expect(signer).toMatch(/FINAL_STORY_PLAYBACK_TTL_SECONDS = 60 \* 15/);
    expect(signer).not.toMatch(/serviceRoleKey|SUPABASE_SERVICE_ROLE_KEY/);
  });
  it("delivers only the persisted FSR media with finite expiry and sanitized filename", async () => {
    const deps = dependencies();
    const delivery = await createFinalStoryDelivery(input, deps);
    expect(delivery).toEqual({ downloadUrl: expect.stringContaining("signed.example"), filename: "My-Launch-Story-final.mp4", expiresInSeconds: 900 });
    expect(deps.authorize).toHaveBeenCalledWith({ ...input, minRole: "client_viewer" });
    expect(deps.mint).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: ids.workspaceId, outputMediaReference: `${ids.workspaceId}/ai-story/final.mp4`, expiresInSeconds: 900 }));
  });

  it.each([
    ["FREE", "AI_STORY_ACCESS_DENIED"], ["PRO", "AI_STORY_ACCESS_DENIED"],
    ["OUTSIDER", "FORBIDDEN"], ["WRONG_WORKSPACE", "NOT_FOUND"],
    ["WRONG_ORGANIZATION", "NOT_FOUND"], ["REVOKED_ADMIN", "AI_STORY_ACCESS_DENIED"],
  ])("propagates the existing access boundary for %s", async (_case, code) => {
    const denied = Object.assign(new Error("denied"), { code, status: 403 });
    await expect(createFinalStoryDelivery(input, dependencies({ authorize: vi.fn().mockRejectedValue(denied) }))).rejects.toMatchObject({ code });
  });

  it("returns not-ready when no accepted FSR exists", async () => {
    await expect(createFinalStoryDelivery(input, dependencies({ getResult: vi.fn().mockResolvedValue(null) }))).rejects.toMatchObject({ code: "FINAL_STORY_RESULT_NOT_READY", status: 404 });
  });

  it("fails closed for wrong story, execution plan, or tenant ownership", async () => {
    const base = dependencies();
    const record = await base.getResult(ids.executionPlanId);
    for (const change of [{ storyId: crypto.randomUUID() }, { executionPlanId: crypto.randomUUID() }, { orgId: crypto.randomUUID() }]) {
      await expect(createFinalStoryDelivery(input, dependencies({ getResult: vi.fn().mockResolvedValue({ ...record, ...change }) }))).rejects.toBeInstanceOf(FinalStoryDeliveryError);
    }
  });

  it("rejects missing or mismatched durable assembly media", async () => {
    await expect(createFinalStoryDelivery(input, dependencies({ getArtifact: vi.fn().mockResolvedValue(null) }))).rejects.toMatchObject({ code: "FINAL_STORY_MEDIA_UNAVAILABLE", status: 409 });
    const deps = dependencies();
    const artifact = await deps.getArtifact(ids.artifactId);
    await expect(createFinalStoryDelivery(input, dependencies({ getArtifact: vi.fn().mockResolvedValue({ ...artifact, artifactReference: `${ids.workspaceId}/forged.mp4` }) }))).rejects.toMatchObject({ code: "FINAL_STORY_MEDIA_UNAVAILABLE" });
  });

  it("does not accept a client storage key and surfaces signing failure without provider detail", async () => {
    const deps = dependencies({ mint: vi.fn().mockRejectedValue(new Error("provider secret detail")) });
    await expect(createFinalStoryDelivery({ ...input, storageKey: "foreign/key.mp4" } as any, deps)).rejects.toThrow("provider secret detail");
    expect(deps.mint).toHaveBeenCalledWith(expect.objectContaining({ outputMediaReference: `${ids.workspaceId}/ai-story/final.mp4` }));
  });
});
