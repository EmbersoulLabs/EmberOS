import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "../packages/agents/node_modules/zod";
import { callVisionJsonModel } from "../packages/agents/src/llm";

describe("Asset Analyzer Provider request contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends a strict JSON Schema response format at the real vision wrapper boundary", async () => {
    vi.stubEnv("OPENAI_API_KEY", "offline-test-key");
    vi.stubEnv("AI_STORY_PROVIDER_DISPATCH_MODE", "disabled");
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        id: "chatcmpl_offline_fixture",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o-2024-08-06",
        choices: [{
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: '{"label":"Pink"}', refusal: null },
        }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const schema = z.object({ label: z.string() }).strict();
    const completion = await callVisionJsonModel<{ label: string }>(
      "Analyze the fixture.",
      "Return the label.",
      ["data:image/jpeg;base64,AA=="],
      "fixture schema",
      {
        maxRetries: 0,
        responseSchema: schema,
        responseSchemaName: "asset_analyzer_fixture",
      }
    );

    expect(completion.result).toEqual({ label: "Pink" });
    expect(capturedBody).not.toBeNull();
    const responseFormat = capturedBody?.response_format as {
      type?: string;
      json_schema?: { name?: string; strict?: boolean; schema?: { additionalProperties?: boolean } };
    };
    expect(responseFormat.type).toBe("json_schema");
    expect(responseFormat.json_schema?.name).toBe("asset_analyzer_fixture");
    expect(responseFormat.json_schema?.strict).toBe(true);
    expect(responseFormat.json_schema?.schema?.additionalProperties).toBe(false);
  });

  it("binds the shared visual semantic analyzer to its canonical schema", () => {
    const source = readFileSync(
      "packages/agents/src/ai-story/visual-semantic-asset-analyzer.ts",
      "utf8"
    );
    expect(source).toContain("responseSchema: ModelSemanticOutputSchema");
    expect(source).toContain('responseSchemaName: "ai_story_asset_visual_semantics_v1"');
  });
});
