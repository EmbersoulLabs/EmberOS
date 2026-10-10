import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  approveActionLabel,
  attachmentFilename,
  continuityStatusLabel,
  copyActionLabel,
  downloadActionLabel,
  fetchAuthorizedDownload,
  operatorRequirementLabel,
  operatorSpeakerLabel,
  postQcTerminalLabel,
  qcActionLabel,
  uploadActionLabel,
  visibleOperatorRequirements,
  writeOperatorClipboard,
} from "../apps/web/src/components/ai-story/local-generation-operator-feedback";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const prompt = "Introduce the character and setting.\nKeep the pavlova box closed.";
const instructions = "WORKFLOW\nMINIMAX_H3_NATIVE_DIALOGUE\nDIALOGUE\nYuki says exactly, on screen:\n\"Look at this beautiful fruit pavlova\"";

describe("Local Generation operator feedback", () => {
  it("copies the exact prompt and shows success", async () => {
    const writeText = vi.fn(async (value: string) => { expect(value).toBe(prompt); });
    const result = await writeOperatorClipboard(prompt, { writeText }, () => false);
    expect(result).toEqual({ ok: true });
    expect(copyActionLabel("Copy Prompt", "busy")).toBe("Copying…");
    expect(copyActionLabel("Copy Prompt", "success")).toBe("Copied ✓");
  });

  it("copies the exact instructions", async () => {
    const writeText = vi.fn(async (value: string) => { expect(value).toBe(instructions); });
    await writeOperatorClipboard(instructions, { writeText }, () => false);
    expect(writeText).toHaveBeenCalledWith(instructions);
    expect(copyActionLabel("Copy Full Instructions", "success")).toBe("Copied ✓");
  });

  it("shows copy failure when the clipboard and fallback both fail", async () => {
    const result = await writeOperatorClipboard(prompt, { writeText: async () => { throw new Error("NotAllowedError"); } }, () => false);
    expect(result.ok).toBe(false);
    expect(copyActionLabel("Copy Prompt", "error")).toBe("Copy failed");
  });

  it("downloads the exact package and reference without a mutation", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      const filename = String(url).endsWith("/download") ? "unit-1-local-generation-package.json" : "selected-product-first-frame.jpg";
      return new Response(JSON.stringify({ packageId: "7817fcf5-6f29-54cd-915f-ca11d97604b5" }), {
        status: 200,
        headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${filename}"` },
      });
    });
    const pkg = await fetchAuthorizedDownload("/local-generation/7817fcf5-6f29-54cd-915f-ca11d97604b5/download", fetchImpl as typeof fetch);
    const reference = await fetchAuthorizedDownload("/references/57eb6393-de60-48b4-9503-833f72d14b5c", fetchImpl as typeof fetch);
    expect(pkg.filename).toBe("unit-1-local-generation-package.json");
    expect(reference.filename).toBe("selected-product-first-frame.jpg");
    expect(downloadActionLabel("Download Unit Package", "busy")).toBe("Downloading…");
    expect(downloadActionLabel("Download first_frame reference", "success")).toBe("Downloaded ✓");
  });

  it("keeps upload progress specific and blocks a second submission in the UI", () => {
    expect(uploadActionLabel("preparing")).toBe("Preparing upload…");
    expect(uploadActionLabel("uploading")).toBe("Uploading…");
    expect(uploadActionLabel("validating")).toBe("Validating media…");
    expect(uploadActionLabel("uploaded")).toBe("Uploaded ✓");
    const panel = read("apps/web/src/components/ai-story/LocalGenerationPanel.tsx");
    expect(panel).toContain("fileRefs.current[item.packageId]?.click()");
    expect(panel).toContain("if (uploadLock.current.has(item.packageId)) return");
    expect(panel).toContain("disabled={uploadBusy}");
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/output/route.ts");
    expect(route).toContain("LOCAL_GENERATION_OUTPUT_ALREADY_BOUND");
  });

  it("shows saving, evaluating, and the terminal Post-QC result", () => {
    expect(qcActionLabel("saving")).toBe("Saving QC evidence…");
    expect(qcActionLabel("evaluating")).toBe("Evaluating Post-QC…");
    expect(postQcTerminalLabel("POST_QC_PASS")).toBe("Post-QC passed");
    expect(postQcTerminalLabel("POST_QC_REJECT")).toBe("Post-QC requires regeneration");
    expect(postQcTerminalLabel("POST_QC_REQUIRES_HUMAN_CONFIRMATION")).toBe("Post-QC complete ✓");
    expect(postQcTerminalLabel(null)).toBe("Post-QC blocked");
  });

  it("shows approval immediately and keeps it separate from continuity", () => {
    expect(approveActionLabel("approving")).toBe("Saving your approval...");
    expect(approveActionLabel("approved")).toBe("Approved ✓");
    expect(continuityStatusLabel({ frameReady: false, jobState: null, phase: "idle" })).toBe("Not prepared");
    expect(continuityStatusLabel({ frameReady: false, jobState: "PENDING", phase: "idle" })).toBe("Preparing continuity frame…");
    expect(continuityStatusLabel({ frameReady: false, jobState: "RUNNING", phase: "extracting" })).toBe("Extracting…");
    expect(continuityStatusLabel({ frameReady: true, jobState: "SUCCEEDED", phase: "ready" })).toBe("Authorized end frame ready ✓");
    const review = read("apps/web/src/components/ai-story/LocalGenerationReview.tsx");
    expect(review).toContain("Human review: {model.decision.decision}");
    expect(review).toContain("Continuity frame:");
    expect(review).toContain("if (!model || approveBusy || qcBusy || model.decision) return");
    expect(review).toContain('method: "GET"');
  });

  it("approval persists first and enqueues the existing frame job without running extraction", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/result/route.ts");
    const continuity = read("apps/web/src/lib/ai-story-generation-result-continuity.ts");
    const worker = read("apps/worker/src/ai-story-local-media-worker-cycle.ts");
    const jobs = read("packages/db/src/queries/ai-story-local-media-jobs.ts");
    const approval = route.slice(route.indexOf('if (command.action === "APPROVE")'));
    expect(approval.indexOf("service.approve")).toBeLessThan(approval.indexOf("deriveApprovedGenerationResultContinuity"));
    expect(route).toContain("if (frame) return apiSuccess");
    expect(route).not.toContain("extractLocalGenerationEndFrame");
    expect(route).not.toContain("/execute");
    expect(continuity).toContain('kind:"EXTRACT_FRAME"');
    expect(continuity).not.toContain("extractLocalGenerationEndFrame");
    expect(worker).toContain("extractLocalGenerationEndFrame");
    expect(jobs).toContain("ON CONFLICT(job_id) DO NOTHING");
    const review = read("apps/web/src/components/ai-story/LocalGenerationReview.tsx");
    const poll = review.slice(review.indexOf("setInterval"), review.indexOf("return () => clearInterval"));
    expect(poll).toContain("load()");
    expect(poll).not.toContain("APPROVE");
    expect(poll).not.toContain("DERIVE_CONTINUITY");
    expect(poll).not.toContain("EVALUATE");
  });

  it("hides raw authority ids and repeated requirement rows in the operator view", () => {
    expect(operatorSpeakerLabel("f57dcdf2-3fa9-42a7-ab75-8ce1c8bcc7fc")).toBe("Authorized speaker");
    expect(operatorSpeakerLabel("Yuki")).toBe("Yuki");
    expect(operatorRequirementLabel({ requirementId: "character-identity", summary: "Preserve Character f57dcdf2-3fa9-42a7-ab75-8ce1c8bcc7fc version e04391fa-61c3-5da0-8ba4-f81de9780782 and pinned DNA." }))
      .toBe("Preserve the authorized Character and pinned DNA.");
    expect(operatorRequirementLabel({ requirementId: "product-identity", summary: "Preserve source Product fd70077e-fbcb-4df9-83b8-b55298384ab5 and variant as authorized." }))
      .toBe("Preserve the authorized Product.");
    expect(operatorRequirementLabel({ requirementId: "continuity:0", summary: "fade-in" })).toBe("Continuity: fade-in");
    const visible = visibleOperatorRequirements([
      { requirementId: "must-keep:0", summary: "Introduce the character and setting.", visuallyObservable: true },
      { requirementId: "must-keep:0", summary: "Introduce the character and setting.", visuallyObservable: true },
      { requirementId: "output-integrity", summary: "Durable local video is readable.", visuallyObservable: false },
    ]);
    expect(visible).toHaveLength(1);
  });

  it("does not let operator controls call Story execution or a cloud video provider", () => {
    const panel = read("apps/web/src/components/ai-story/LocalGenerationPanel.tsx");
    const review = read("apps/web/src/components/ai-story/LocalGenerationReview.tsx");
    const reference = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/references/[assetId]/route.ts");
    for (const source of [panel, review]) {
      expect(source).not.toMatch(/seedance|runway|\/execute|Prepare Animation/i);
    }
    expect(reference).toContain(".download(asset.storagePath)");
    expect(reference).toContain('content-disposition');
    expect(reference).not.toContain("Response.redirect");
    expect(attachmentFilename('attachment; filename="unit-1-local-generation-package.json"', "fallback.json"))
      .toBe("unit-1-local-generation-package.json");
  });
});
