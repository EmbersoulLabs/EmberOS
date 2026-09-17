import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import https from "node:https";
import { assertLocalTestNetworkTarget, blockedExternalNetworkAttempts, installCertificationNetworkIsolation } from "./helpers/certification-network-isolation";
import { realCertificationPlanningModelAdapter } from "../packages/agents/src/llm";

describe("certification planning outbound network kill switch", () => {
  let restore: () => void;
  beforeAll(() => { restore = installCertificationNetworkIsolation(); });
  afterAll(() => { restore(); });

  it("blocks an external fetch before transmission", async () => {
    expect(() => fetch("https://api.openai.com/v1/models")).toThrow("NETWORK_CALL_BLOCKED_BY_TEST_HARNESS");
    expect(blockedExternalNetworkAttempts()).toContain("api.openai.com");
  });

  it("also blocks Node HTTP and HTTPS before opening a socket", () => {
    expect(() => http.request("http://api.openai.com/v1/models")).toThrow("NETWORK_CALL_BLOCKED_BY_TEST_HARNESS");
    expect(() => https.request("https://api.openai.com/v1/models")).toThrow("NETWORK_CALL_BLOCKED_BY_TEST_HARNESS");
    expect(blockedExternalNetworkAttempts().filter((host) => host === "api.openai.com")).toHaveLength(3);
  });

  it("permits only the three explicit loopback host forms", () => {
    expect(() => assertLocalTestNetworkTarget("http://localhost:3000/health")).not.toThrow();
    expect(() => assertLocalTestNetworkTarget("http://127.0.0.1:5432/")).not.toThrow();
    expect(() => assertLocalTestNetworkTarget("http://[::1]:3000/health")).not.toThrow();
    expect(() => assertLocalTestNetworkTarget("https://api.openai.com/v1/models")).toThrow("NETWORK_CALL_BLOCKED_BY_TEST_HARNESS");
  });

  it("blocks the actual OpenAI completion boundary without requiring an environment key", async () => {
    const previous = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = "test-only-network-sentinel";
      await expect(realCertificationPlanningModelAdapter.complete({
        model: "gpt-4o-mini-2024-07-18",
        messages: [{ role: "user", content: "network sentinel; no model generation authorized" }],
        max_tokens: 1,
      }, { maxRetries: 0 })).rejects.toMatchObject({
        cause: { message: "NETWORK_CALL_BLOCKED_BY_TEST_HARNESS" },
      });
      expect(blockedExternalNetworkAttempts().filter((host) => host === "api.openai.com")).toHaveLength(5);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});
