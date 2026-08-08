import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateNewAssetAgainstExisting } from "../apps/web/src/lib/campaign-assets";

const source = (path: string) => readFileSync(resolve(path), "utf8");

function video(durationSec: number) {
  return {
    id: crypto.randomUUID(),
    type: "video",
    durationSec: String(durationSec),
    metadata: {},
    createdAt: new Date(),
  } as never;
}

describe("independent Asset analysis", () => {
  it("enqueues the same bounded, idempotent job from both image confirm paths", () => {
    const queue = source("packages/queue/src/index.ts");
    const campaignConfirm = source(
      "apps/web/src/app/api/campaigns/[id]/assets/[assetId]/confirm/route.ts"
    );
    const libraryConfirm = source(
      "apps/web/src/app/api/workspaces/[id]/library/[assetId]/confirm/route.ts"
    );
    expect(queue).toContain('const jobId = `asset-analysis-${data.assetId}`');
    expect(queue).toContain('state === "failed"');
    expect(queue).toContain("existing.retry()");
    expect(queue).toContain("attempts: 3");
    expect(campaignConfirm).toContain("enqueueImageAnalysisAfterConfirm");
    expect(libraryConfirm).toContain("enqueueImageAnalysisAfterConfirm");
    expect(libraryConfirm).toContain("enqueueProbe");
  });

  it("persists structured states and invokes existing vision and naming capabilities", () => {
    const handler = source("apps/worker/src/processors/asset-analysis-handler.ts");
    for (const state of ["analyzing", "completed", "failed"]) {
      expect(handler).toContain(`status: "${state}"`);
    }
    expect(handler).toContain("prepareVisionFromStorage");
    expect(handler).toContain("runVisionAgent");
    expect(handler).toContain("visionAnalysis: analysis");
    expect(handler).toContain("refreshAssetDisplayNameFromVision");
  });

  it("keeps manual names authoritative while allowing analysis metadata updates", () => {
    const naming = source("apps/worker/src/asset-auto-name.ts");
    const handler = source("apps/worker/src/processors/asset-analysis-handler.ts");
    expect(naming).toContain('metadata.displayNameSource === "manual"');
    expect(naming).toContain("<> 'manual'");
    expect(handler).toContain("coalesce(");
    expect(handler).not.toContain("displayNameSource:");
  });

  it("advertises the asset-analysis consumer in the runtime heartbeat", () => {
    expect(source("apps/worker/src/runtime-heartbeat.ts")).toContain('"asset-analysis"');
    expect(source("apps/web/src/app/api/health/runtime/route.ts")).toContain(
      "assetAnalysisConsumer"
    );
  });
});

describe("video upload validation", () => {
  it("accepts a sub-minute video", () => {
    expect(validateNewAssetAgainstExisting([], "video", 59.9)).toEqual({ ok: true });
  });

  it("accepts a video between one and ten minutes", () => {
    expect(validateNewAssetAgainstExisting([], "video", 599.9)).toEqual({ ok: true });
  });

  it("rejects an over-limit video in seconds", () => {
    expect(validateNewAssetAgainstExisting([], "video", 600.1)).toMatchObject({
      ok: false,
      code: "VIDEO_TOO_LONG",
    });
  });

  it("accepts three sequential valid uploads when their combined duration is valid", () => {
    expect(
      validateNewAssetAgainstExisting([video(120), video(180)], "video", 60)
    ).toEqual({ ok: true });
  });

  it("reports combined duration separately from the per-file limit", () => {
    expect(
      validateNewAssetAgainstExisting([video(300), video(250)], "video", 60)
    ).toMatchObject({ ok: false, code: "COMBINED_DURATION_TOO_LONG" });
  });

  it("checks the configured storage limit and exposes readable signed-upload errors", () => {
    const storage = source("apps/web/src/lib/storage-upload-validation.ts");
    const xhr = source("apps/web/src/lib/upload-with-progress.ts");
    expect(storage).toContain("getBucket");
    expect(storage).toContain('code: "FILE_TOO_LARGE"');
    expect(storage).toContain('code: "MIME_NOT_ALLOWED"');
    expect(xhr).toContain("Upload rejected");
    expect(xhr).toContain("Check file size and type");
  });
});
