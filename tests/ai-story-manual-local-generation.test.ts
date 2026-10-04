import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AiStoryLocalGenerationPackageSchema } from "@ceo-agent/shared";
import {
  assertLocalGenerationDuration,
  inspectLocalGenerationMp4,
} from "../apps/web/src/lib/ai-story-local-generation-media";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function mp4(duration = 8, timescale = 1) {
  const bytes = Buffer.alloc(80);
  bytes.writeUInt32BE(16, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("isom", 8, "ascii");
  bytes.writeUInt32BE(32, 16);
  bytes.write("mvhd", 20, "ascii");
  bytes.writeUInt8(0, 24);
  bytes.writeUInt32BE(timescale, 36);
  bytes.writeUInt32BE(duration * timescale, 40);
  return bytes;
}

describe("Manual Local Generation handoff certification", () => {
  it("validates MP4 bytes and reads their real mvhd duration", () => {
    const inspected = inspectLocalGenerationMp4(mp4(8));
    expect(inspected.durationSec).toBe(8);
    expect(inspected.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects non-MP4 bytes", () => {
    expect(() => inspectLocalGenerationMp4(Buffer.from("not a video"))).toThrow("LOCAL_GENERATION_MEDIA_TYPE_INVALID");
  });

  it("enforces bounded upload duration tolerance", () => {
    expect(() => assertLocalGenerationDuration({ actualSec: 8.5, targetSec: 8 })).not.toThrow();
    expect(() => assertLocalGenerationDuration({ actualSec: 13, targetSec: 8 })).toThrow("LOCAL_GENERATION_MEDIA_DURATION_OUT_OF_RANGE");
  });

  it("normal Animate selects MANUAL_LOCAL without constructing the Provider Router", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts");
    expect(route).toContain('executionMode: "MANUAL_LOCAL"');
    expect(route).not.toContain("resolveCanonicalWebExecuteProviderAuthority");
    expect(route).not.toContain("createCanonicalProductMaterialSchedulingCoordinator");
  });

  it("manual Execute returns before commercial reservation and scheduling", () => {
    const source = read("packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts");
    const local = source.indexOf('executionMode === "MANUAL_LOCAL"');
    expect(local).toBeGreaterThan(0);
    expect(local).toBeLessThan(source.indexOf("commercialAuth.authorizeExecutionPlanExecute", local));
    expect(local).toBeLessThan(source.indexOf("releases.initialize", local));
    expect(local).toBeLessThan(source.indexOf("scheduling.scheduleAuthorizedScene", local));
  });

  it("does not enable Seedance or Runway fallback", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts");
    expect(route).toContain("seedanceAutoFallback: false");
    expect(route).toContain("runwayAutoFallback: false");
    expect(route).toContain("cloudVideoProviderCostUsd: 0");
  });

  it("persists immutable packages and exact-unit outputs with additive DDL", () => {
    const sql = read("packages/db/sql/ai-story-manual-local-generation-handoff-v1.sql");
    expect(sql).toContain("CREATE TABLE ai_story_local_generation_packages");
    expect(sql).toContain("CREATE TABLE ai_story_local_generation_outputs");
    expect(sql).toContain("LOCAL_GENERATION_PACKAGE_IMMUTABLE");
    expect(sql).not.toMatch(/DROP\s+TABLE|TRUNCATE/i);
  });

  it("output confirmation cannot bind an upload from another Unit", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/output/route.ts");
    expect(route).toContain("LOCAL_GENERATION_OUTPUT_WRONG_UNIT");
    expect(route).toContain("metadata.localGenerationUnitId !== resolved.item.unitId");
  });

  it("uploaded media remains pending QC and never auto-passes", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/output/route.ts");
    const worker = read("apps/worker/src/ai-story-local-media-worker-cycle.ts");
    expect(worker).toContain('qcState:"PENDING"');
    expect(worker).not.toContain('qcState:"PASS"');
    expect(route).toContain('kind: "VALIDATE_OUTPUT"');
    expect(route).toContain("automaticProviderRetry: false");
  });

  it("downloads only references frozen into the exact package", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/references/[assetId]/route.ts");
    expect(route).toContain("item?.references.find");
    expect(route).toContain("candidate.assetId === assetId");
  });

  it("the UI exposes prompt, full instructions, package, references, and MP4 upload", () => {
    const ui = read("apps/web/src/components/ai-story/LocalGenerationPanel.tsx") + read("apps/web/src/components/ai-story/local-generation-operator-feedback.ts");
    for (const label of ["Copy Prompt", "Copy Full Instructions", "Download Unit Package", "Download ", "Upload Generated Video", "Not recorded on this package"]) {
      expect(ui).toContain(label);
    }
  });

  it("the UI reports zero cloud Provider cost without claiming local electricity is free", () => {
    const ui = read("apps/web/src/components/ai-story/LocalGenerationPanel.tsx");
    expect(ui).toContain("Cloud video Provider cost: $0");
    expect(ui).toContain("Local GPU cost: not metered by EmberOS V1");
    expect(ui).not.toContain("Local GPU cost: $0");
  });

  it("historical Seedance contracts remain in place", () => {
    expect(read("packages/agents/src/ai-story/seedance-canonical-adapter.ts").length).toBeGreaterThan(1_000);
    expect(read("packages/agents/src/ai-story/canonical-execute-router.ts")).toContain("ProviderRouter");
  });

  it("contains no Mini Fan, Pink, Yuki, or H3-specific decision in production package compilation", () => {
    const source = read("packages/agents/src/ai-story/local-generation-package.ts");
    expect(source).not.toMatch(/Mini Fan|Pink|Yuki/i);
    expect(source).toContain("MINIMAX_H3_NATIVE_DIALOGUE");
    expect(source).toContain("request.structuredRequest.generateAudio");
  });

  it("the manifest rejects contradictory audio authority", () => {
    const result = AiStoryLocalGenerationPackageSchema.safeParse({
      version: "local-generation-package.v1",
      generateAudio: true,
      audioBlocked: true,
    });
    expect(result.success).toBe(false);
  });
});
