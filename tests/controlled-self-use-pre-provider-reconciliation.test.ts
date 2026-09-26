import { describe, expect, it } from "vitest";
import { isUnusedTerminalPreProviderReservation } from "@ceo-agent/db";

const unused = {
  status: "SUBMITTED" as const,
  capabilityKey: "ai_story.plan",
  providerKey: "openai",
  providerRequestId: null,
  settledCostUsd: null,
  retryOrdinal: 0,
  executionIdentity: "ai-story-plan-stage:version:scene_plan:regen",
  storyStatus: "failed" as string | null,
  hasProviderAttempt: false,
  hasOutboxDispatch: false,
  hasBillableLedger: false,
  executionTerminal: false,
};

describe("unused terminal pre-provider reservation", () => {
  it("releases a failed planning hold with no provider usage or video dispatch", () => {
    expect(isUnusedTerminalPreProviderReservation(unused)).toBe(true);
    expect(isUnusedTerminalPreProviderReservation({ ...unused, status: "RESERVED" })).toBe(true);
  });

  it("releases the execution that just failed before the story status commit", () => {
    expect(isUnusedTerminalPreProviderReservation({
      ...unused,
      storyStatus: "planning",
      executionTerminal: true,
    })).toBe(true);
  });

  it("keeps in-flight, billed, video, and already settled reservations", () => {
    expect(isUnusedTerminalPreProviderReservation({ ...unused, storyStatus: "planning" })).toBe(false);
    expect(isUnusedTerminalPreProviderReservation({ ...unused, providerRequestId: "chatcmpl-1" })).toBe(false);
    expect(isUnusedTerminalPreProviderReservation({ ...unused, hasProviderAttempt: true })).toBe(false);
    expect(isUnusedTerminalPreProviderReservation({ ...unused, hasOutboxDispatch: true })).toBe(false);
    expect(isUnusedTerminalPreProviderReservation({ ...unused, hasBillableLedger: true })).toBe(false);
    expect(isUnusedTerminalPreProviderReservation({ ...unused, capabilityKey: "ai_story.execute", providerKey: "seedance" })).toBe(false);
    expect(isUnusedTerminalPreProviderReservation({ ...unused, status: "SETTLED" })).toBe(false);
    expect(isUnusedTerminalPreProviderReservation({ ...unused, settledCostUsd: "0.04" })).toBe(false);
    expect(isUnusedTerminalPreProviderReservation({ ...unused, retryOrdinal: 1 })).toBe(false);
  });
});
