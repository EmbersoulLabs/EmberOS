import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARKETING_SKILL_GUIDANCE, MARKETING_SKILL_UPSTREAM } from "@ceo-agent/shared";

describe("worker marketing skill prompts", () => {
  it("uses the same upstream guidance as the web runtime", () => {
    expect(MARKETING_SKILL_UPSTREAM.revision).toBe("1efedbc5148b54b2f0f6c6c9fe0be62e151c7fff");
    const strategy = readFileSync("packages/agents/src/strategy.ts", "utf8");
    const content = readFileSync("packages/agents/src/marketing-content.ts", "utf8");
    expect(strategy).toContain("MARKETING_SKILL_GUIDANCE");
    expect(content).toContain("MARKETING_SKILL_GUIDANCE");
    expect(content).not.toContain("2.1%–3.8%");
    expect(MARKETING_SKILL_GUIDANCE).toContain("Do not invent prices");
  });
});
