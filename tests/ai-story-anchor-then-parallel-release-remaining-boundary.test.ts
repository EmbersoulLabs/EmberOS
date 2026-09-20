import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ANCHOR_THEN_PARALLEL releaseRemaining compatibility", () => {
  it("keeps releaseRemaining as the remaining-scene path after Scene 1 approval", () => {
    const release = readFileSync(
      resolve(process.cwd(), "packages/db/src/queries/ai-story-scene-release.ts"),
      "utf8"
    );
    const coordinator = readFileSync(
      resolve(process.cwd(), "packages/agents/src/ai-story/release-remaining-scenes.ts"),
      "utf8"
    );
    expect(release).toContain("async releaseRemaining(");
    expect(release).toContain("FIRST_SCENE_EXACT_APPROVAL_REQUIRED");
    expect(release).toContain("releaseState === \"AUTHORIZED_NOT_RELEASED\"");
    expect(release).not.toMatch(/Scene 2[\s\S]{0,80}APPROVED/);
    expect(coordinator).toContain("row.sceneOrder > 1 && row.releaseState === \"RELEASED\"");
    expect(coordinator).toContain("scheduleAuthorizedScene");
  });
});
