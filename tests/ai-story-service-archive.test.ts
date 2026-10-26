import { describe, expect, it, vi } from "vitest";
import { schema } from "@ceo-agent/db";
import { archiveAiStory } from "../apps/web/src/lib/ai-story-service";

const CAMPAIGN = "81000000-0000-4000-8000-000000000001";
const STORY = "81000000-0000-4000-8000-000000000002";
const WORKSPACE = "81000000-0000-4000-8000-000000000003";

describe("archiveAiStory", () => {
  it("sets archivedAt on the AI Story, scoped to its exact campaign and workspace", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));
    const db = { update } as unknown as Parameters<typeof archiveAiStory>[0];

    await archiveAiStory(db, STORY, CAMPAIGN, WORKSPACE);

    expect(update).toHaveBeenCalledWith(schema.aiStories);
    expect(updateSet).toHaveBeenCalledWith({ archivedAt: expect.any(Date), updatedAt: expect.any(Date) });
    expect(updateWhere).toHaveBeenCalledTimes(1);
  });
});
