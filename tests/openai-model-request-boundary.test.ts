import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "../packages/shared/node_modules/zod";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { actualCertificationPlanningCostCents, maximumCertificationPlanningCostCents } from "../packages/db/src/queries/certification-planning-authority";
import { openAiTokenCostUsd } from "../packages/agents/src/openai-model-policy";

vi.setConfig({ testTimeout: 15_000 });

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function completion(input: {
  content?: string | null;
  refusal?: string | null;
  finishReason?: "stop" | "length";
  model?: string;
} = {}): ChatCompletion {
  return {
    id: "offline-request-id",
    object: "chat.completion",
    created: 0,
    model: input.model ?? "gpt-6-luna-2026-09-30",
    choices: [{
      index: 0,
      logprobs: null,
      finish_reason: input.finishReason ?? "stop",
      message: {
        role: "assistant",
        content: input.content === undefined ? '{"ok":true}' : input.content,
        refusal: input.refusal ?? null,
      },
    }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

async function loadBoundary() {
  globalThis.fetch = vi.fn(async () => {
    throw new Error("EXTERNAL_NETWORK_DENIED");
  }) as typeof fetch;
  return import("../packages/agents/src/llm");
}

describe("OpenAI request boundary", () => {
  it("prices new and historical claims from their stored model policy", () => {
    expect(openAiTokenCostUsd("gpt-6-luna", 12_000, 1_200)).toBe(0.0018);
    expect(openAiTokenCostUsd("gpt-4o-mini", 12_000, 1_200)).toBe(0.00252);
    expect(actualCertificationPlanningCostCents(12_000, 1_200, "gpt-6-luna")).toBe(1);
    expect(actualCertificationPlanningCostCents(12_000, 1_200, "gpt-4o-mini-2024-07-18")).toBe(1);
    expect(maximumCertificationPlanningCostCents(6_144, "gpt-6-luna"))
      .toBeLessThan(maximumCertificationPlanningCostCents(6_144, "gpt-4o-mini-2024-07-18"));
  });

  it("serializes the low-cost structured request with explicit no reasoning and no SDK HTTP", async () => {
    const { callStructuredJsonModel, withOpenAiModelAdapter } = await loadBoundary();
    const requests: ChatCompletionCreateParamsNonStreaming[] = [];
    const adapter = {
      complete: async (request: ChatCompletionCreateParamsNonStreaming) => {
        requests.push(request);
        return completion();
      },
    };

    const result = await withOpenAiModelAdapter(adapter, () => callStructuredJsonModel({
      system: "system",
      user: "user",
      schema: z.object({ ok: z.boolean() }),
      schemaName: "boundary_contract",
      maxOutputTokens: 321,
    }));

    expect(result.result).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: "gpt-6-luna",
      reasoning_effort: "none",
      max_completion_tokens: 321,
      response_format: { type: "json_schema" },
    });
    expect(requests[0]).not.toHaveProperty("max_tokens");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps the quality model explicit and never retries or escalates", async () => {
    const { callStructuredJsonModel, withOpenAiModelAdapter } = await loadBoundary();
    const requests: ChatCompletionCreateParamsNonStreaming[] = [];
    const adapter = {
      complete: async (request: ChatCompletionCreateParamsNonStreaming, options?: { maxRetries: number }) => {
        requests.push(request);
        expect(options).toEqual({ maxRetries: 0 });
        return completion({ model: "gpt-6.1-sol-2026-10-01" });
      },
    };

    await withOpenAiModelAdapter(adapter, () => callStructuredJsonModel({
      system: "visual quality control",
      user: "inspect",
      schema: z.object({ ok: z.boolean() }),
      schemaName: "quality_contract",
      model: "gpt-6.1-sol",
      maxOutputTokens: 512,
    }));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: "gpt-6.1-sol",
      reasoning_effort: "low",
      max_completion_tokens: 512,
    });
    expect(requests[0]).not.toHaveProperty("temperature");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    [completion({ refusal: "cannot comply" }), "PROVIDER_REFUSAL"],
    [completion({ finishReason: "length" }), "TRUNCATED"],
    [completion({ content: null }), "MISSING_CONTENT"],
  ] as const)("preserves structured failure state %#", async (providerResponse, decodeIssue) => {
    const { callStructuredJsonModel, withOpenAiModelAdapter } = await loadBoundary();
    const result = await withOpenAiModelAdapter(
      { complete: async () => providerResponse },
      () => callStructuredJsonModel({
        system: "system",
        user: "user",
        schema: z.object({ ok: z.boolean() }),
        schemaName: "failure_contract",
        maxOutputTokens: 16,
      })
    );
    expect(result).toMatchObject({ result: null, decodeIssue });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
