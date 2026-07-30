import { describe, expect, it } from "vitest";
import {
  MARKETING_OUTPUT_STRATEGY,
  resolveMarketingOutputCount,
  assertAiStoryTransition,
  assertAiStoryExecutionTransition,
} from "@ceo-agent/shared";

describe("PD-054/055 Marketing Output Strategy", () => {
  it("defaults to target 5 with quality-first bounds", () => {
    expect(MARKETING_OUTPUT_STRATEGY.DEFAULT_TARGET_OUTPUTS).toBe(5);
    expect(MARKETING_OUTPUT_STRATEGY.MINIMUM_OUTPUTS).toBe(3);
    expect(MARKETING_OUTPUT_STRATEGY.MAXIMUM_OUTPUTS).toBe(5);
  });

  it("returns fewer than target when quality cannot support padding", () => {
    const result = resolveMarketingOutputCount({
      candidates: [
        { id: "a", qualityScore: 0.9, reason: "strong", mediaKind: "video" },
        { id: "b", qualityScore: 0.8, reason: "good", mediaKind: "video" },
        { id: "c", qualityScore: 0.7, reason: "ok", mediaKind: "video" },
        { id: "d", qualityScore: 0.2, reason: "weak", mediaKind: "video" },
        { id: "e", qualityScore: 0.1, reason: "filler", mediaKind: "video" },
      ],
    });
    expect(result.selectedCount).toBe(3);
    expect(result.selected.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(result.rejectedLowQuality).toBe(2);
  });

  it("applies the same strategy for image media", () => {
    const result = resolveMarketingOutputCount({
      candidates: [
        { id: "1", qualityScore: 0.95, reason: "hero", mediaKind: "image" },
        { id: "2", qualityScore: 0.9, reason: "product", mediaKind: "image" },
        { id: "3", qualityScore: 0.85, reason: "lifestyle", mediaKind: "image" },
        { id: "4", qualityScore: 0.8, reason: "detail", mediaKind: "image" },
        { id: "5", qualityScore: 0.78, reason: "cta", mediaKind: "image" },
      ],
    });
    expect(result.selectedCount).toBe(5);
    expect(result.strategy).toBe("quality_first");
  });
});

describe("AI Story execution transitions", () => {
  it("allows ready_for_execution → generate_review → executing → execution_review", () => {
    expect(() =>
      assertAiStoryTransition("ready_for_execution", "generate_review")
    ).not.toThrow();
    expect(() => assertAiStoryTransition("generate_review", "executing")).not.toThrow();
    expect(() => assertAiStoryTransition("executing", "execution_review")).not.toThrow();
  });

  it("allows execution job lifecycle queued → preparing → running → collecting → completed", () => {
    expect(() => assertAiStoryExecutionTransition("queued", "preparing")).not.toThrow();
    expect(() => assertAiStoryExecutionTransition("preparing", "running")).not.toThrow();
    expect(() =>
      assertAiStoryExecutionTransition("running", "collecting_assets")
    ).not.toThrow();
    expect(() =>
      assertAiStoryExecutionTransition("collecting_assets", "completed")
    ).not.toThrow();
  });
});
