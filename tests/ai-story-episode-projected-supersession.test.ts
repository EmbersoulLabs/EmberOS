import { describe, expect, it } from "vitest";
import { EpisodeProjectedAuthorityError } from "@ceo-agent/shared";
import { resolveSupersededFrozenPlanId } from "../packages/db/src/queries/ai-story-episode-projected-persistence";

const SCOPE = {
  orgId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  campaignId: "33333333-3333-4333-8333-333333333333",
  storyId: "44444444-4444-4444-8444-444444444444",
  storyVersionId: "55555555-5555-4555-8555-555555555555",
  actorUserId: "66666666-6666-4666-8666-666666666666",
};
const OLD_PACKAGE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUCCESSOR_PACKAGE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FROZEN_V1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FROZEN_V2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function txReturning(rows: { id: string; status: string }[]) {
  return { select: () => ({ from: () => ({ where: async () => rows }) }) } as never;
}

describe("projected Director/Motion supersession", () => {
  it("supersedes the latest FROZEN plan only when its package was superseded by a current successor", async () => {
    const tx = txReturning([{ id: OLD_PACKAGE, status: "superseded" }, { id: SUCCESSOR_PACKAGE, status: "review" }]);
    await expect(resolveSupersededFrozenPlanId(tx, SCOPE, [
      { planId: FROZEN_V1, version: 1, animationPackageId: OLD_PACKAGE },
      { planId: FROZEN_V2, version: 2, animationPackageId: OLD_PACKAGE },
    ], SUCCESSOR_PACKAGE, "Director")).resolves.toBe(FROZEN_V2);
  });

  it("keeps frozen authority when its package is still current", async () => {
    const tx = txReturning([{ id: OLD_PACKAGE, status: "ready_for_execution" }, { id: SUCCESSOR_PACKAGE, status: "review" }]);
    await expect(resolveSupersededFrozenPlanId(tx, SCOPE, [{ planId: FROZEN_V1, version: 1, animationPackageId: OLD_PACKAGE }], SUCCESSOR_PACKAGE, "Motion"))
      .rejects.toBeInstanceOf(EpisodeProjectedAuthorityError);
  });

  it("rejects a superseded or foreign requested source and a missing frozen binding", async () => {
    await expect(resolveSupersededFrozenPlanId(txReturning([{ id: OLD_PACKAGE, status: "superseded" }, { id: SUCCESSOR_PACKAGE, status: "superseded" }]), SCOPE,
      [{ planId: FROZEN_V1, version: 1, animationPackageId: OLD_PACKAGE }], SUCCESSOR_PACKAGE, "Director")).rejects.toBeInstanceOf(EpisodeProjectedAuthorityError);
    await expect(resolveSupersededFrozenPlanId(txReturning([{ id: OLD_PACKAGE, status: "superseded" }]), SCOPE,
      [{ planId: FROZEN_V1, version: 1, animationPackageId: OLD_PACKAGE }], SUCCESSOR_PACKAGE, "Director")).rejects.toBeInstanceOf(EpisodeProjectedAuthorityError);
    await expect(resolveSupersededFrozenPlanId(txReturning([{ id: SUCCESSOR_PACKAGE, status: "review" }]), SCOPE,
      [{ planId: FROZEN_V1, version: 1, animationPackageId: undefined }], SUCCESSOR_PACKAGE, "Director")).rejects.toBeInstanceOf(EpisodeProjectedAuthorityError);
  });
});
