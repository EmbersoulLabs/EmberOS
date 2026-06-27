import OpenAI from "openai";
import { LLM_BUDGET_PER_TASK_USD, CEO_MAX_RETRIES } from "@ceo-agent/shared";
import type { TaskGraph } from "@ceo-agent/shared";

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

export async function callJsonModel<T>(
  system: string,
  user: string,
  schemaHint: string
): Promise<{ result: T; usage: { input: number; output: number; costUsd: number } }> {
  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${system}\n\nOutput valid JSON matching: ${schemaHint}` },
      { role: "user", content: user },
    ],
    temperature: 0.7,
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const input = response.usage?.prompt_tokens ?? 0;
  const output = response.usage?.completion_tokens ?? 0;
  const costUsd = (input * 0.15 + output * 0.6) / 1_000_000;

  return { result: JSON.parse(content) as T, usage: { input, output, costUsd } };
}

/** GPT-4o vision for frame analysis (higher cost than gpt-4o-mini). */
export async function callVisionJsonModel<T>(
  system: string,
  userText: string,
  imageDataUrls: string[],
  schemaHint: string
): Promise<{ result: T; usage: { input: number; output: number; costUsd: number } }> {
  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${system}\n\nOutput valid JSON matching: ${schemaHint}` },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          ...imageDataUrls.slice(0, 8).map((url) => ({
            type: "image_url" as const,
            image_url: { url, detail: "high" as const },
          })),
        ],
      },
    ],
    temperature: 0.4,
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  const input = response.usage?.prompt_tokens ?? 0;
  const output = response.usage?.completion_tokens ?? 0;
  const costUsd = (input * 2.5 + output * 10) / 1_000_000;

  return { result: JSON.parse(content) as T, usage: { input, output, costUsd } };
}

export function buildDefaultTaskGraph(): TaskGraph {
  return {
    version: "1.0",
    steps: [
      { id: "parse_intent", agent: "ceo", dependsOn: [] },
      { id: "strategy_plan", agent: "strategy", dependsOn: ["parse_intent"] },
      { id: "ceo_plan", agent: "ceo", dependsOn: ["strategy_plan"] },
      { id: "vision_analyze", agent: "vision", dependsOn: ["ceo_plan"] },
      { id: "content_generate", agent: "marketing_content", dependsOn: ["vision_analyze", "strategy_plan"] },
      { id: "hook_generate", agent: "hook", dependsOn: ["content_generate"] },
      { id: "copy_generate", agent: "copy", dependsOn: ["content_generate"] },
      { id: "edit_director_plan", agent: "edit", dependsOn: ["copy_generate", "vision_analyze"] },
      { id: "ffmpeg_render", agent: "worker", dependsOn: ["edit_director_plan"] },
      { id: "compliance_check", agent: "compliance", dependsOn: ["ffmpeg_render", "copy_generate"] },
      { id: "marketing_score", agent: "score", dependsOn: ["compliance_check"] },
      { id: "human_review", agent: "human", dependsOn: ["marketing_score"] },
      { id: "platform_adapt", agent: "publish", dependsOn: ["human_review"] },
    ],
    retryPolicy: {
      maxRetries: CEO_MAX_RETRIES,
      onCopyReject: ["copy_generate", "compliance_check"],
      onEditReject: ["edit_director_plan", "ffmpeg_render", "compliance_check"],
    },
    costBudgetUsd: LLM_BUDGET_PER_TASK_USD,
  };
}
