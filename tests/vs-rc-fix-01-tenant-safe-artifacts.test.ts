import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STORAGE_PATHS } from "../packages/shared/src/constants";
import {
  VIDEO_ARTIFACT_SIGNED_URL_TTL_SECONDS,
  resolveExpectedVideoArtifactKey,
  signCreativeDownload,
  signCreativeExportPack,
  signTaskExportPack,
  withSignedCreativeArtifacts,
} from "../apps/web/src/lib/video-artifact-delivery";
import {
  MAX_SIGNED_URL_REFRESH_ATTEMPTS,
  initialPreviewDeliveryState,
  previewArtifactIdentity,
  recordPreviewDeliveryFailure,
  recordPreviewDeliverySuccess,
  recordPreviewRefreshFailure,
} from "../apps/web/src/lib/bounded-preview-delivery";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const WS = "10000000-0000-4000-8000-000000000001";
const OTHER_WS = "20000000-0000-4000-8000-000000000001";
const CAMPAIGN = "30000000-0000-4000-8000-000000000001";
const CREATIVE = "40000000-0000-4000-8000-000000000001";
const TASK = "50000000-0000-4000-8000-000000000001";

const preview = STORAGE_PATHS.preview(WS, CAMPAIGN, CREATIVE);
const final = STORAGE_PATHS.export(WS, CAMPAIGN, CREATIVE);
const cover = STORAGE_PATHS.cover(WS, CAMPAIGN, CREATIVE);
const twoK = STORAGE_PATHS.export2k(WS, CAMPAIGN, CREATIVE);
const creative = {
  id: CREATIVE,
  workspaceId: WS,
  campaignId: CAMPAIGN,
  videoUrl: preview,
  videoExportUrl: final,
  coverUrl: cover,
  platformAdaptations: { _renditions: { "2k": twoK } },
};

describe("VS-RC-FIX-01 tenant-safe Video Studio artifacts", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_STORAGE_BUCKET = "campaign-assets";
  });

  it("uses one server-owned ten-minute delivery TTL", () => {
    expect(VIDEO_ARTIFACT_SIGNED_URL_TTL_SECONDS).toBe(600);
  });

  it("mints preview, final, cover and rendition delivery from exact stable keys", async () => {
    const signer = vi.fn(async (key: string) => `https://signed.test/${encodeURIComponent(key)}`);
    const delivered = await withSignedCreativeArtifacts(creative, signer);
    expect(signer.mock.calls.map(([key]) => key)).toEqual([preview, final, cover, twoK]);
    expect(delivered.videoUrl).toContain("signed.test");
    expect(delivered.coverUrl).toContain("signed.test");
    expect((delivered.platformAdaptations?._renditions as Record<string, string>)["2k"]).toContain("signed.test");
    expect(creative.videoUrl).toBe(preview);
  });

  it("supports only the exact configured historical public URL", () => {
    const legacy = `https://project.supabase.co/storage/v1/object/public/campaign-assets/${preview}`;
    expect(resolveExpectedVideoArtifactKey(legacy, preview)).toBe(preview);
    expect(() => resolveExpectedVideoArtifactKey(`https://evil.test/${preview}`, preview)).toThrow();
    expect(() => resolveExpectedVideoArtifactKey(`${legacy}-other`, preview)).toThrow();
  });

  it("rejects a different-workspace object substitution", () => {
    const foreign = STORAGE_PATHS.preview(OTHER_WS, CAMPAIGN, CREATIVE);
    expect(() => resolveExpectedVideoArtifactKey(foreign, preview)).toThrow(
      "Invalid or unauthorized"
    );
  });

  it("rejects arbitrary object keys instead of signing client input", async () => {
    const signer = vi.fn();
    await expect(
      signCreativeDownload(creative, "720p", `${WS}/campaigns/${CAMPAIGN}/source/private.mp4`, signer)
    ).rejects.toThrow();
    expect(signer).not.toHaveBeenCalled();
  });

  it("issues individual downloads for the exact authorized rendition", async () => {
    const signer = vi.fn(async (key: string) => `signed:${key}`);
    await expect(signCreativeDownload(creative, "720p", preview, signer)).resolves.toBe(`signed:${preview}`);
    await expect(signCreativeDownload(creative, "1080p", final, signer)).resolves.toBe(`signed:${final}`);
    await expect(signCreativeDownload(creative, "2k", twoK, signer)).resolves.toBe(`signed:${twoK}`);
  });

  it("requires the exact task-owned ZIP object", async () => {
    const pack = STORAGE_PATHS.taskExportPack(WS, CAMPAIGN, TASK, "720p");
    const signer = vi.fn(async (key: string) => `signed:${key}`);
    await expect(signTaskExportPack({ taskId: TASK, workspaceId: WS, campaignId: CAMPAIGN, resolution: "720p", reference: pack }, signer)).resolves.toBe(`signed:${pack}`);
    await expect(signTaskExportPack({ taskId: TASK, workspaceId: WS, campaignId: CAMPAIGN, resolution: "720p", reference: STORAGE_PATHS.taskExportPack(OTHER_WS, CAMPAIGN, TASK, "720p") }, signer)).rejects.toThrow();
  });

  it("requires the exact Creative-owned export pack", async () => {
    const pack = STORAGE_PATHS.exportPack(WS, CAMPAIGN, CREATIVE);
    await expect(signCreativeExportPack({ creativeId: CREATIVE, workspaceId: WS, campaignId: CAMPAIGN, reference: `${pack}.other` }, vi.fn())).rejects.toThrow();
  });

  it("refreshes signed delivery without changing or regenerating the artifact", async () => {
    let request = 0;
    const signer = vi.fn(async (key: string) => `signed:${key}?request=${++request}`);
    const first = await signCreativeDownload(creative, "720p", preview, signer);
    const second = await signCreativeDownload(creative, "720p", preview, signer);
    expect(first).not.toBe(second);
    expect(signer.mock.calls.map(([key]) => key)).toEqual([preview, preview]);
    expect(read("apps/web/src/lib/video-artifact-delivery.ts")).not.toMatch(/enqueueRender|enqueueExport/);
  });

  it("refreshes ZIP delivery without regenerating the export pack", async () => {
    const pack = STORAGE_PATHS.taskExportPack(WS, CAMPAIGN, TASK, "1080p");
    const signer = vi.fn(async (key: string) => `signed:${key}`);
    await signTaskExportPack({ taskId: TASK, workspaceId: WS, campaignId: CAMPAIGN, resolution: "1080p", reference: pack }, signer);
    await signTaskExportPack({ taskId: TASK, workspaceId: WS, campaignId: CAMPAIGN, resolution: "1080p", reference: pack }, signer);
    expect(signer).toHaveBeenCalledTimes(2);
    expect(signer.mock.calls.every(([key]) => key === pack)).toBe(true);
  });

  it("fails closed when signing fails and contains no public fallback", async () => {
    await expect(withSignedCreativeArtifacts(creative, async () => { throw new Error("signing unavailable"); })).rejects.toThrow("signing unavailable");
    const delivery = read("apps/web/src/lib/video-artifact-delivery.ts");
    expect(delivery).not.toMatch(/getPublicUrl|\/object\/public\/.+return/);
  });

  it("authenticates and checks workspace authority before route-level signing", () => {
    for (const path of [
      "apps/web/src/app/api/tasks/[id]/route.ts",
      "apps/web/src/app/api/creatives/[id]/route.ts",
      "apps/web/src/app/api/creatives/[id]/download/route.ts",
      "apps/web/src/app/api/tasks/[id]/export/route.ts",
    ]) {
      const source = read(path);
      const authCall = source.indexOf("requireAuth()");
      expect(authCall).toBeGreaterThanOrEqual(0);
      expect(source.indexOf("requireWorkspaceRole(", authCall)).toBeGreaterThan(authCall);
      expect(source.indexOf("withSignedCreativeArtifacts") >= 0 || source.indexOf("signCreativeDownload") >= 0 || source.indexOf("signTaskExportPack") >= 0).toBe(true);
    }
    expect(read("apps/web/src/app/api/portal/[token]/route.ts")).toMatch(/validatePortalToken[\s\S]*withSignedCreativeArtifacts/);
  });

  it("keeps service-role signing server-only and render identity untouched", () => {
    const helper = read("apps/web/src/lib/video-artifact-delivery.ts");
    expect(helper).toContain("createAdminClient");
    expect(helper).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    for (const path of [
      "packages/shared/src/editing-plan-v1.ts",
      "packages/agents/src/editing-director-v1.ts",
      "packages/shared/src/render.ts",
    ]) {
      expect(read(path)).not.toContain("VIDEO_ARTIFACT_SIGNED_URL_TTL_SECONDS");
    }
  });

  it("persists stable object references and removes public authority from production render/export", () => {
    expect(read("apps/worker/src/processors/render-handler.ts")).not.toContain("publicStorageUrl");
    expect(read("apps/worker/src/processors/export-handler.ts")).not.toContain("publicStorageUrl");
    const worker = read("apps/worker/src/processors/index.ts");
    expect(worker).not.toContain("publicStorageUrl");
    expect(worker).toContain("downloadStorageReference");
  });
});

describe("VS-RC-FIX-01E1 bounded preview delivery convergence", () => {
  const artifact = { id: CREATIVE, renderCacheFingerprint: "render-v1", updatedAt: "2026-08-15T00:00:00.000Z" };
  const identity = previewArtifactIdentity(artifact);

  it("allows exactly one automatic signed URL refresh per artifact", () => {
    expect(MAX_SIGNED_URL_REFRESH_ATTEMPTS).toBe(1);
    const first = recordPreviewDeliveryFailure(initialPreviewDeliveryState(identity), identity);
    expect(first).toMatchObject({ shouldRefresh: true, state: { refreshAttempts: 1, status: "REFRESHING" } });
    const second = recordPreviewDeliveryFailure(first.state, identity);
    expect(second).toMatchObject({ shouldRefresh: false, state: { refreshAttempts: 1, status: "TERMINAL_PREVIEW_ERROR" } });
    const third = recordPreviewDeliveryFailure(second.state, identity);
    expect(third.shouldRefresh).toBe(false);
  });

  it("does not reset the budget when only the signed URL changes", () => {
    const first = recordPreviewDeliveryFailure(undefined, identity);
    const sameArtifact = previewArtifactIdentity({ ...artifact, videoUrl: "https://signed.test/new" });
    const second = recordPreviewDeliveryFailure(first.state, sameArtifact);
    expect(sameArtifact).toBe(identity);
    expect(second.shouldRefresh).toBe(false);
  });

  it("grants a fresh budget to a genuinely new render artifact", () => {
    const exhausted = recordPreviewDeliveryFailure(
      recordPreviewDeliveryFailure(undefined, identity).state,
      identity
    ).state;
    const nextIdentity = previewArtifactIdentity({ ...artifact, renderCacheFingerprint: "render-v2" });
    const next = recordPreviewDeliveryFailure(exhausted, nextIdentity);
    expect(nextIdentity).not.toBe(identity);
    expect(next).toMatchObject({ shouldRefresh: true, state: { refreshAttempts: 1, status: "REFRESHING" } });
  });

  it("successful refreshed media remains ready without another refresh", () => {
    const refreshed = recordPreviewDeliveryFailure(undefined, identity).state;
    const ready = recordPreviewDeliverySuccess(refreshed, identity);
    expect(ready).toMatchObject({ refreshAttempts: 1, status: "READY" });
    expect(recordPreviewDeliveryFailure(ready, identity).shouldRefresh).toBe(false);
  });

  it("a failed authorized refresh converges immediately to terminal preview error", () => {
    const refreshing = recordPreviewDeliveryFailure(undefined, identity).state;
    expect(recordPreviewRefreshFailure(refreshing, identity)).toMatchObject({
      refreshAttempts: 1,
      status: "TERMINAL_PREVIEW_ERROR",
    });
  });

  it("wires all three surfaces to the bounded helper without render, export or public fallback", () => {
    for (const path of [
      "apps/web/src/components/pipeline/ClipPreviewGrid.tsx",
      "apps/web/src/app/w/[slug]/creatives/[id]/page.tsx",
      "apps/web/src/app/portal/[token]/page.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("recordPreviewDeliveryFailure");
      expect(source).toContain("TERMINAL_PREVIEW_ERROR");
      expect(source).not.toMatch(/enqueueRender|enqueueExport|getPublicUrl|\/object\/public\//);
    }
  });
});
