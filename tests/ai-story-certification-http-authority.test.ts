import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { controlledSelfUseProviderFetch } from "../packages/agents/src/controlled-self-use-provider-context";

const originalFetch = globalThis.fetch;
const originalMode = process.env.AI_STORY_PROVIDER_DISPATCH_MODE;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalMode === undefined) delete process.env.AI_STORY_PROVIDER_DISPATCH_MODE;
  else process.env.AI_STORY_PROVIDER_DISPATCH_MODE = originalMode;
});

describe("certification HTTP authority boundary", () => {
  it("rejects a client flag when no server claim grant exists and does not call transport", async () => {
    process.env.AI_STORY_PROVIDER_DISPATCH_MODE = "allowlisted_self_use";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const request = new Request("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "x-certification-authorized": "true", "x-ai-story-certification-regeneration-id": "client" },
    });
    await expect(controlledSelfUseProviderFetch(request)).rejects.toThrow("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
    expect(calls).toBe(0);
  });

  it("keeps non-allowlisted transport on the existing fetch path", async () => {
    delete process.env.AI_STORY_PROVIDER_DISPATCH_MODE;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await controlledSelfUseProviderFetch("https://api.openai.com/v1/chat/completions");
    expect(calls).toBe(1);
  });

  it("keeps video providers outside the certification HTTP grant", () => {
    const llm = readFileSync("packages/agents/src/llm.ts", "utf8");
    const provider = readFileSync("packages/agents/src/controlled-self-use-provider-context.ts", "utf8");
    const seedance = readFileSync("packages/agents/src/ai-story/seedance-http-client.ts", "utf8");
    const minimax = readFileSync("packages/agents/src/ai-story/minimax-http-client.ts", "utf8");
    const registry = readFileSync("packages/agents/src/provider-adapters/production-registry.ts", "utf8");
    const worker = readFileSync("apps/worker/src/processors/story-planning-stage.ts", "utf8");
    const localGpuPath = "packages/agents/src/ai-story/local-gpu-adapter.ts";
    expect(llm).toContain("withCertificationPlanningHttpGrant");
    expect(llm.indexOf("authority.claim(")).toBeLessThan(llm.lastIndexOf("withCertificationPlanningHttpGrant"));
    expect(provider.indexOf("markSubmitted")).toBeLessThan(provider.lastIndexOf("globalThis.fetch"));
    expect(provider).toContain("assertHttpTransportAuthorized");
    expect(seedance).not.toContain("withCertificationPlanningHttpGrant");
    expect(minimax).not.toContain("assertHttpTransportAuthorized");
    expect(registry).not.toContain("LOCAL_GPU");
    expect(worker).toContain("ai-story-planning-runner.ts");
    if (existsSync(localGpuPath)) {
      expect(readFileSync(localGpuPath, "utf8")).not.toContain("assertHttpTransportAuthorized");
    }
  });
});
