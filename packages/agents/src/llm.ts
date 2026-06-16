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

export function buildDefaultTaskGraph(): TaskGraph {
  return {
    version: "1.0",
    steps: [
      { id: "parse_intent", agent: "ceo", dependsOn: [] },
      { id: "vision_analyze", agent: "vision", dependsOn: ["parse_intent"], parallel: true },
      { id: "copy_generate", agent: "copy", dependsOn: ["parse_intent"], parallel: true },
      { id: "edit_director_plan", agent: "edit", dependsOn: ["vision_analyze", "copy_generate"] },
      { id: "ffmpeg_render", agent: "worker", dependsOn: ["edit_director_plan"] },
      { id: "compliance_check", agent: "compliance", dependsOn: ["ffmpeg_render", "copy_generate"] },
      { id: "human_review", agent: "human", dependsOn: ["compliance_check"] },
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
