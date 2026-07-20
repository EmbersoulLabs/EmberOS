import { describe, expect, it, vi } from "vitest";
import { AiSkillError } from "../packages/agents/src/skills/types";
import {
  BusinessProfileAnalyzerSkill,
  BUSINESS_PROFILE_ANALYZER_SKILL_ID,
} from "../packages/agents/src/skills/business-profile-analyzer/skill";
import { executeSkill } from "../packages/agents/src/skills/runner/skill-runner";
import {
  routeJsonCompletion,
  selectAiRoute,
} from "../packages/agents/src/skills/router/ai-router";

describe("AI Router selection (PD-014)", () => {
  it("defaults to OpenAI gpt-4o-mini", () => {
    const route = selectAiRoute({
      system: "s",
      user: "u",
      schemaHint: "{}",
    });
    expect(route.provider).toBe("openai");
    expect(route.model).toBe("gpt-4o-mini");
    expect(route.maxRetries).toBeGreaterThanOrEqual(0);
  });

  it("honors preferred gpt-4o model for OpenAI", () => {
    const route = selectAiRoute(
      { system: "s", user: "u", schemaHint: "{}", preferredModel: "gpt-4o" },
      { provider: "openai" }
    );
    expect(route.provider).toBe("openai");
    expect(route.model).toBe("gpt-4o");
  });

  it("exposes future providers in the selection API without requiring OpenAI", () => {
    const route = selectAiRoute(
      { system: "s", user: "u", schemaHint: "{}" },
      { provider: "gemini", preferredModel: "gemini-pro" }
    );
    expect(route.provider).toBe("gemini");
    expect(route.model).toBe("gemini-pro");
  });

  it("rejects unsupported providers with PROVIDER_UNAVAILABLE", async () => {
    await expect(
      routeJsonCompletion(
        { system: "s", user: "u", schemaHint: "{}" },
        { provider: "claude", maxRetries: 0 }
      )
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});

describe("BusinessProfileAnalyzerSkill (PD-014)", () => {
  it("validates input and builds a provider-agnostic prompt", () => {
    const input = BusinessProfileAnalyzerSkill.validateInput({
      companyName: "Bloom Co",
      industryDisplayName: "Florist",
    });
    const prompt = BusinessProfileAnalyzerSkill.buildPrompt(input);
    expect(prompt.system).toMatch(/PROMPT-002/);
    expect(prompt.user).toContain("Bloom Co");
    expect(prompt.schemaHint).toContain("brandSummary");
    expect(prompt.preferredModel).toBe("gpt-4o-mini");
  });

  it("normalizes raw provider JSON into the skill output contract", () => {
    const input = BusinessProfileAnalyzerSkill.validateInput({
      companyName: "Bloom Co",
      industryDisplayName: "Florist",
    });
    const result = BusinessProfileAnalyzerSkill.normalizeOutput(
      {
        brandSummary: "  Elegant florist for gifting. ",
        brandPersonality: ["Premium", "premium"],
        brandTone: ["Warm"],
        brandKeywords: ["Wedding", "Wedding"],
        targetAudience: ["Gift Buyers"],
      },
      input,
      {
        json: {},
        usage: { input: 5, output: 7, costUsd: 0.01 },
        provider: "openai",
        model: "gpt-4o-mini",
      }
    );

    expect(result.brandSummary).toBe("Elegant florist for gifting.");
    expect(result.brandPersonality).toEqual(["Premium"]);
    expect(result.brandKeywords).toEqual(["Wedding"]);
    expect(result.targetAudience).toEqual(["Gift Buyers"]);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.metadata.skillId).toBe(BUSINESS_PROFILE_ANALYZER_SKILL_ID);
    expect(result.metadata.provider).toBe("openai");
    expect(result.metadata.usage.costUsd).toBe(0.01);
  });

  it("rejects invalid normalized output", () => {
    const input = BusinessProfileAnalyzerSkill.validateInput({ companyName: "X" });
    expect(() =>
      BusinessProfileAnalyzerSkill.normalizeOutput(
        { brandSummary: "" },
        input,
        {
          json: {},
          usage: { input: 0, output: 0, costUsd: 0 },
          provider: "openai",
          model: "gpt-4o-mini",
        }
      )
    ).toThrow(AiSkillError);
  });
});

describe("AI Skill Runner (PD-014)", () => {
  it("executeSkill invokes router and returns normalized skill JSON", async () => {
    const route = vi.fn().mockResolvedValue({
      json: {
        brandSummary: "Modern florist.",
        brandPersonality: ["Friendly"],
        brandTone: ["Warm"],
        brandKeywords: ["Flowers"],
        targetAudience: ["Locals"],
      },
      usage: { input: 1, output: 2, costUsd: 0.001 },
      provider: "openai",
      model: "gpt-4o-mini",
    });

    const result = await executeSkill(
      "business-profile-analyzer",
      { companyName: "Bloom", industryDisplayName: "Florist" },
      { routeJsonCompletion: route }
    );

    expect(route).toHaveBeenCalledOnce();
    expect(route.mock.calls[0]?.[0]?.system).toMatch(/PROMPT-002/);
    expect(result.brandSummary).toBe("Modern florist.");
    expect(result.brandKeywords).toEqual(["Flowers"]);
    expect(result.targetAudience).toEqual(["Locals"]);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.metadata.skillId).toBe("business-profile-analyzer");
    expect(result.metadata.provider).toBe("openai");
    expect(result.metadata.usage.output).toBe(2);
  });

  it("retries on transient router failure then succeeds", async () => {
    const route = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({
        json: {
          brandSummary: "Recovered summary.",
          brandPersonality: ["Calm"],
          brandTone: ["Warm"],
          brandKeywords: ["Retry"],
          targetAudience: ["All"],
        },
        usage: { input: 1, output: 1, costUsd: 0 },
        provider: "openai",
        model: "gpt-4o-mini",
      });

    const result = await executeSkill(
      "business-profile-analyzer",
      { companyName: "Bloom" },
      { routeJsonCompletion: route }
    );

    expect(route).toHaveBeenCalledTimes(2);
    expect(result.brandSummary).toBe("Recovered summary.");
  });

  it("throws UNKNOWN_SKILL for unregistered ids", async () => {
    await expect(executeSkill("not-a-real-skill" as never, {})).rejects.toMatchObject({
      code: "UNKNOWN_SKILL",
    });
  });
});
