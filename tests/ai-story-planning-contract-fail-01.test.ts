import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiStoryStructuredDraftSchema } from "@ceo-agent/shared";
import { buildAiStoryPlanningLedgerIdentity } from "../apps/web/src/lib/ai-story-planning-accounting";

const validDraft = {
  title: "Lily Gift",
  summary: "A concise product story.",
  objective: "Awareness",
  targetAudience: "Gift buyers",
  tone: "Warm",
  estimatedDuration: "15s",
  story: { opening: "Reveal", development: "Alternate", ending: "Gift" },
  keyMessages: ["Thoughtful gifting"],
  cta: "Discover the arrangement",
  assetReferences: [],
  warnings: [],
};

function completion(result: unknown) {
  return {
    result,
    providerRequestId: "chatcmpl-contract-test",
    modelVersion: "gpt-4o-mini-2024-07-18",
    usage: { input: 100, output: 50, costUsd: 0.000045 },
    timings: { providerMs: 20, decodeMs: 1 },
  };
}

describe("AI Story production planning structured-output contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("derives strict OpenAI JSON Schema from the one canonical Zod schema", () => {
    const source = readFileSync("packages/agents/src/llm.ts", "utf8");
    const service = readFileSync(
      "packages/agents/src/ai-story/story-polish-service.ts",
      "utf8"
    );
    expect(source).toContain('import { zodResponseFormat } from "openai/helpers/zod"');
    expect(source).toContain("response_format: zodResponseFormat(input.schema, input.schemaName)");
    expect(service).toContain("schema: AiStoryStructuredDraftSchema");
  });

  it("rejects unknown root and nested fields with the canonical parser", () => {
    expect(
      AiStoryStructuredDraftSchema.safeParse({ ...validDraft, unexpected: true }).success
    ).toBe(false);
    expect(
      AiStoryStructuredDraftSchema.safeParse({
        ...validDraft,
        story: { ...validDraft.story, unexpected: true },
      }).success
    ).toBe(false);
  });

  it.each([
    ["missing root", { title: "Only title" }, "MISSING_REQUIRED_FIELD"],
    [
      "invalid nested story",
      { ...validDraft, story: { opening: "Only opening" } },
      "MISSING_REQUIRED_FIELD",
    ],
    ["unknown field", { ...validDraft, extra: "no" }, "UNKNOWN_FIELD"],
    [
      "wrong array cardinality",
      { ...validDraft, keyMessages: Array.from({ length: 21 }, () => "x") },
      "INVALID_ARRAY_LENGTH",
    ],
    ["wrong canonical shape", { ...validDraft, story: [] }, "INVALID_SCENE_STRUCTURE"],
  ])("fails closed for %s and retains accounting", async (_name, result, expectedIssue) => {
    const call = vi.fn(async () => completion(result));
    vi.doMock("../packages/agents/src/llm", () => ({ callStructuredJsonModel: call }));
    const { polishAiStoryDraft } = await import(
      "../packages/agents/src/ai-story/story-polish-service"
    );
    const outcome = await polishAiStoryDraft({
      originalIdea: "Three scenes",
      campaign: { name: "R3" },
      assetLabels: [],
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failureCode).toBe("AI_STORY_PLANNING_OUTPUT_CONTRACT_INVALID");
      expect(outcome.validationIssueCodes).toContain(expectedIssue);
      expect(outcome.accounting?.usage).toEqual({ input: 100, output: 50, total: 150 });
      expect(outcome.accounting?.cost.costSource).toBe("MODEL_PRICING_TABLE");
    }
  });

  it("keeps provider transport failure separate and does not fabricate accounting", async () => {
    const call = vi.fn(async () => {
      throw new Error("transport down");
    });
    vi.doMock("../packages/agents/src/llm", () => ({ callStructuredJsonModel: call }));
    const { polishAiStoryDraft } = await import(
      "../packages/agents/src/ai-story/story-polish-service"
    );
    const outcome = await polishAiStoryDraft({
      originalIdea: "Three scenes",
      campaign: { name: "R3" },
      assetLabels: [],
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failureCode).toBe("AI_STORY_PLANNING_PROVIDER_TRANSPORT_FAILURE");
      expect(outcome.accounting).toBeUndefined();
    }
  });

  it("maps provider-compatible enum validation failures to a sanitized code", async () => {
    const { sanitizeAiStoryPlanningIssues } = await import(
      "../packages/agents/src/ai-story/story-polish-service"
    );
    expect(
      sanitizeAiStoryPlanningIssues([
        {
          code: "invalid_enum_value",
          options: ["allowed"],
          received: "forbidden",
          path: ["futureEnumField"],
          message: "Invalid enum value",
        },
      ])
    ).toEqual(["INVALID_ENUM"]);
  });

  it("accepts a valid response through the same canonical parser", async () => {
    const call = vi.fn(async () => completion(validDraft));
    vi.doMock("../packages/agents/src/llm", () => ({ callStructuredJsonModel: call }));
    const { polishAiStoryDraft } = await import(
      "../packages/agents/src/ai-story/story-polish-service"
    );
    const outcome = await polishAiStoryDraft({
      originalIdea: "Three scenes",
      campaign: { name: "R3" },
      assetLabels: [],
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(AiStoryStructuredDraftSchema.parse(outcome.draft).title).toBe("Lily Gift");
      expect(outcome.accounting.providerRequestId).toBe("chatcmpl-contract-test");
    }
  });

  it("builds deterministic, duplicate-safe ledger identities", () => {
    const input = {
      orgId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      campaignId: "00000000-0000-4000-8000-000000000003",
      storyId: "00000000-0000-4000-8000-000000000004",
      runSeed: "2026-08-22T00:00:00.000Z",
      requestMaterial: { idea: "three scenes" },
      startedAt: "2026-08-22T00:00:01.000Z",
    };
    const first = buildAiStoryPlanningLedgerIdentity(input);
    const duplicate = buildAiStoryPlanningLedgerIdentity(input);
    expect(duplicate).toEqual(first);
    expect(first.execution.identity.idempotencyKey).toContain(first.executionId);
  });

  it("orders durable accounting before failed Story visibility and stores no raw output", () => {
    const helper = readFileSync(
      "apps/web/src/lib/ai-story-planning-accounting.ts",
      "utf8"
    );
    const route = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/generate/route.ts",
      "utf8"
    );
    expect(helper.indexOf("recordUsage")).toBeLessThan(helper.indexOf("recordCost"));
    expect(helper.indexOf("recordCost")).toBeLessThan(
      helper.indexOf('.set({ status: "failed"')
    );
    expect(route.indexOf("persistAiStoryPlanningOutcome")).toBeLessThan(
      route.indexOf("createAiStoryVersion")
    );
    expect(helper).not.toMatch(/rawProviderResponse|rawPrompt|responseBody/);
  });

  it("disables automatic retries for the strict OpenAI call", () => {
    const source = readFileSync("packages/agents/src/llm.ts", "utf8");
    expect(source).toContain("zodResponseFormat(input.schema, input.schemaName)");
    expect(source).toContain("{ maxRetries: 0 }");
  });
});
