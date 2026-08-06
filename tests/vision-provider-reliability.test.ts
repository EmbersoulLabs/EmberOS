import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISION_ANALYSIS_TIMEOUT_MS,
  VisionAnalysisTimeoutError,
  getVisionAnalysisTimeoutMs,
  isVisionAnalysisTimeoutError,
  withVisionAnalysisTimeout,
} from "../packages/agents/src/vision-timeout";
import { isInterruptedE2ECampaign } from "../e2e/helpers/campaign-cleanup";
import { unwrapVisionResult } from "../packages/agents/src/vision";

describe("vision provider reliability", () => {
  it("unwraps the observed GPT-4o VisionAnalysis envelope", () => {
    const analysis = { subjects: ["pink roses"], products: [], scenes: [] };
    expect(unwrapVisionResult({ VisionAnalysis: analysis })).toEqual(analysis);
  });
  it("uses a conservative centralized default", () => {
    expect(getVisionAnalysisTimeoutMs(undefined)).toBe(DEFAULT_VISION_ANALYSIS_TIMEOUT_MS);
  });

  it("aborts and classifies a provider that exceeds its deadline", async () => {
    let aborted = false;
    const operation = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("provider aborted"));
      });
    });
    const error = await withVisionAnalysisTimeout(operation, 5).catch((value) => value);
    expect(aborted).toBe(true);
    expect(error).toBeInstanceOf(VisionAnalysisTimeoutError);
    expect(isVisionAnalysisTimeoutError(error)).toBe(true);
    expect(error.message).toContain("upload is preserved");
  });

  it("preserves provider network errors", async () => {
    const networkError = new Error("network unavailable");
    await expect(
      withVisionAnalysisTimeout(async () => Promise.reject(networkError), 100)
    ).rejects.toBe(networkError);
  });

  it("normalizes a provider-native timeout that wins the deadline race", async () => {
    const providerTimeout = Object.assign(new Error("Request timed out"), {
      name: "APIConnectionTimeoutError",
    });
    await expect(
      withVisionAnalysisTimeout(async () => Promise.reject(providerTimeout), 100)
    ).rejects.toBeInstanceOf(VisionAnalysisTimeoutError);
  });

  it("rejects unsafe timeout configuration", () => {
    expect(() => getVisionAnalysisTimeoutMs("0")).toThrow(/between/);
    expect(() => getVisionAnalysisTimeoutMs("not-a-number")).toThrow(/between/);
  });
});

describe("interrupted E2E cleanup scope", () => {
  it("selects only interrupted campaigns with the deterministic prefix", () => {
    expect(isInterruptedE2ECampaign({ id: "1", name: "E2E Video 1", status: "processing" })).toBe(true);
    expect(isInterruptedE2ECampaign({ id: "2", name: "Customer Campaign", status: "processing" })).toBe(false);
    expect(isInterruptedE2ECampaign({ id: "3", name: "E2E Video 3", status: "approved" })).toBe(false);
    expect(isInterruptedE2ECampaign({ id: "4", name: "E2E AI Story 4", status: "failed" })).toBe(false);
  });
});
