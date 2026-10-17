import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const queryDir = "packages/db/src/queries";
const directMembershipAllowlist = new Set([
  "ai-story-actor-scope.ts",
  "ai-story-execution-plan-assembly.ts",
  "ai-story-execution-plan-review.ts",
  "ai-story-keyframe-paid-authorization.ts",
  "ai-story-post-terminal-provider-retry.ts",
]);

describe("system-wide AI Story actor authority ownership", () => {
  it("keeps direct Workspace membership logic inside the shared resolver or a custom-role owner with the shared fallback", () => {
    const files = readdirSync(queryDir).filter((name) => name.startsWith("ai-story-") && name.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(`${queryDir}/${file}`, "utf8");
      if (!source.includes("workspace_members") && !source.includes("workspaceMembers")) continue;
      if (!directMembershipAllowlist.has(file)) offenders.push(file);
      if (file !== "ai-story-actor-scope.ts") {
        expect(source, file).toContain("hasInternalSuperadminWorkspaceScope");
      }
    }
    expect(offenders).toEqual([]);
  });

  it("migrates every canonical planning and execution authority owner to the shared resolver", () => {
    const owners = [
      "ai-story-outline.ts",
      "ai-story-script.ts",
      "ai-story-script-semantic-proposal.ts",
      "ai-story-script-director-handoff.ts",
      "ai-story-director-plan.ts",
      "ai-story-motion-plan.ts",
      "ai-story-scene-authority.ts",
      "ai-story-pre-generation-qc.ts",
      "ai-story-episode-projected-persistence.ts",
      "ai-story-episode-revision-persistence.ts",
      "ai-story-successor-motion.ts",
      "ai-story-character.ts",
      "ai-story-cast.ts",
      "ai-story-character-dna.ts",
      "ai-story-character-virtualizer.ts",
      "ai-story-character-voice-dna.ts",
      "ai-story-reusable-character.ts",
    ];
    for (const owner of owners) {
      const source = readFileSync(`${queryDir}/${owner}`, "utf8");
      expect(source, owner).toMatch(/aiStoryActorScopePredicate|hasAiStoryActorScope/);
    }
  });
});
