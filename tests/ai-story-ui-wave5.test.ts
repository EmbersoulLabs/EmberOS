import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx",
  "utf8"
);
const runtime = readFileSync("apps/web/src/components/ai-story/StoryRuntimePanel.tsx", "utf8");
const review = readFileSync("apps/web/src/components/ai-story/GeneratedSceneReviewPanel.tsx", "utf8");

describe("Wave 5 AI Story normal-user UI", () => {
  it("implements the Blueprint product flow and explicit AI Polish acceptance", () => {
    for (const label of ["Your Story", "AI Polish", "Story Review", "Generate Animation"])
      expect(page).toContain(label);
    expect(page).toContain("previewOnly: true");
    expect(page).toContain("Accept changes");
    expect(page).toContain("Cancel");
    expect(page).toContain("Regenerate");
    expect(page).not.toContain("Save edits");
    expect(page).toContain("/approve");
  });

  it("places planning and execution diagnostics behind an authorized advanced boundary", () => {
    expect(page).toContain('role === "admin" || role === "operator"');
    expect(page).toContain('data-testid="advanced-planning-diagnostics"');
    expect(page).toContain('data-testid="advanced-execution-diagnostics"');
    expect(page).toContain('data-testid="internal-planning-hidden"');
    expect(page.indexOf("advanced-planning-diagnostics")).toBeLessThan(
      page.indexOf('<PackageSection title="Director Thinking"')
    );
  });

  it("keeps runtime and review product-facing without exposing machinery", () => {
    expect(runtime).toContain("Scene generation");
    expect(runtime).toContain("Generate Animation");
    expect(runtime).not.toContain("story-runtime-timeout-trace");
    expect(runtime).not.toContain("Correlation ID");
    expect(review).toContain("Generation couldn't start");
    expect(review).toContain("Review Retry Input");
    expect(review).toContain("Authorize Retry");
    expect(review).toContain("Start paid retry");
    expect(review).not.toContain('data-testid="generated-scene-retry"');
    expect(review).not.toContain("Provider attempt");
  });
});
