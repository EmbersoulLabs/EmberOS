import { describe, expect, it, vi } from "vitest";
import { schema } from "@ceo-agent/db";
import { CampaignHasAiStoryContentError, deleteCampaignCascade } from "../apps/web/src/lib/campaign-delete";

/**
 * Minimal fluent + thenable query stub standing in for drizzle's chainable builder.
 * `.from/.where/.limit` all return `this`; awaiting the chain at any point resolves `rows`.
 */
function queryStub(rows: unknown[]) {
  const stub = {
    from: () => stub,
    where: () => stub,
    limit: () => stub,
    then: (resolve: (value: unknown[]) => void, reject?: (reason: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return stub;
}

function makeDb(opts: { aiStoryRows: unknown[]; taskRows?: unknown[]; creativeRows?: unknown[] }) {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const select = vi
    .fn()
    .mockReturnValueOnce(queryStub(opts.aiStoryRows))
    .mockReturnValueOnce(queryStub(opts.taskRows ?? []))
    .mockReturnValueOnce(queryStub(opts.creativeRows ?? []));
  const del = vi.fn(() => ({ where: deleteWhere }));
  return { select, delete: del, deleteWhere } as unknown as Parameters<typeof deleteCampaignCascade>[0] & {
    select: typeof select;
    delete: typeof del;
    deleteWhere: typeof deleteWhere;
  };
}

describe("deleteCampaignCascade", () => {
  it("refuses to delete a campaign that still has an AI Story, before touching any other table", async () => {
    const db = makeDb({ aiStoryRows: [{ id: "story-1" }] });

    await expect(deleteCampaignCascade(db, "campaign-1", "workspace-1")).rejects.toThrow(
      CampaignHasAiStoryContentError
    );

    // Only the AI Story existence check ran; no deletes were attempted anywhere.
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("surfaces a 409-mappable, actionable error rather than letting Postgres's raw FK violation bubble up", async () => {
    const db = makeDb({ aiStoryRows: [{ id: "story-1" }] });
    await expect(deleteCampaignCascade(db, "campaign-1", "workspace-1")).rejects.toMatchObject({
      code: "CAMPAIGN_HAS_AI_STORY_CONTENT",
      message: expect.stringContaining("AI Story"),
    });
  });

  it("still deletes the campaign normally when there is no AI Story content", async () => {
    const db = makeDb({ aiStoryRows: [], taskRows: [{ id: "task-1" }], creativeRows: [{ id: "creative-1" }] });

    await deleteCampaignCascade(db, "campaign-1", "workspace-1");

    expect(db.select).toHaveBeenCalledTimes(3);
    // agentLogs (by taskId), clientInvites (by creativeId), and campaigns itself.
    expect(db.delete).toHaveBeenCalledTimes(3);
    expect(db.delete).toHaveBeenNthCalledWith(1, schema.agentLogs);
    expect(db.delete).toHaveBeenNthCalledWith(2, schema.clientInvites);
    expect(db.delete).toHaveBeenNthCalledWith(3, schema.campaigns);
  });

  it("skips the agentLogs/clientInvites deletes when there are no tasks or creatives, but still deletes the campaign", async () => {
    const db = makeDb({ aiStoryRows: [] });

    await deleteCampaignCascade(db, "campaign-1", "workspace-1");

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(schema.campaigns);
  });
});
