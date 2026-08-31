import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AiStoryCharacterAuthorityService,
  AiStorySupportingCastAuthorityService,
  SERVERLESS_DB_MAX_CONNECTIONS,
  SERVERLESS_DB_OPERATION_TIMEOUT_MS,
} from "@ceo-agent/db";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function oneQueryDb() {
  const orderBy = vi.fn(async () => []);
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = orderBy;
  const db = {
    select: vi.fn(() => chain),
    execute: vi.fn(async () => [{ ok: true }]),
  };
  return { db, orderBy };
}

describe("AI Story protected Character/Cast read fanout repair", () => {
  it("keeps the certified serverless pool and dependency deadline unchanged", () => {
    expect(SERVERLESS_DB_MAX_CONNECTIONS).toBe(3);
    expect(SERVERLESS_DB_OPERATION_TIMEOUT_MS).toBe(12_000);
  });

  it("loads a verified Campaign Character projection in one set-based query", async () => {
    const { db } = oneQueryDb();
    const service = new AiStoryCharacterAuthorityService(db as never);
    await expect(service.listForVerifiedScope({
      orgId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000002",
      campaignId: "10000000-0000-4000-8000-000000000003",
      actorUserId: "10000000-0000-4000-8000-000000000004",
    })).resolves.toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("loads a verified Supporting Cast projection in one set-based query", async () => {
    const { db } = oneQueryDb();
    const service = new AiStorySupportingCastAuthorityService(db as never);
    await expect(service.listForVerifiedScope({
      orgId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000002",
      campaignId: "10000000-0000-4000-8000-000000000003",
      storyId: "10000000-0000-4000-8000-000000000005",
      actorUserId: "10000000-0000-4000-8000-000000000004",
    })).resolves.toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("retains service-level authorization for callers without verified request scope", async () => {
    const character = oneQueryDb();
    await new AiStoryCharacterAuthorityService(character.db as never).list({
      orgId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000002",
      campaignId: "10000000-0000-4000-8000-000000000003",
      actorUserId: "10000000-0000-4000-8000-000000000004",
    });
    expect(character.db.execute).toHaveBeenCalledTimes(1);

    const cast = oneQueryDb();
    await new AiStorySupportingCastAuthorityService(cast.db as never).list({
      orgId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000002",
      campaignId: "10000000-0000-4000-8000-000000000003",
      storyId: "10000000-0000-4000-8000-000000000005",
      actorUserId: "10000000-0000-4000-8000-000000000004",
    });
    expect(cast.db.execute).toHaveBeenCalledTimes(1);
  });

  it("coalesces initial Character and Cast reads into the already-authorized Story response", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/route.ts");
    const page = read("apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx");
    const characters = read("apps/web/src/components/ai-story/CharacterPanel.tsx");
    const cast = read("apps/web/src/components/ai-story/SupportingCastPanel.tsx");
    expect(route).toContain("listForVerifiedScope(verifiedScope)");
    expect(route).toContain("supportingCharacters");
    expect(page).toContain("initialCharacters={initialCharacters}");
    expect(page).toContain("initialSupportingCharacters={initialSupportingCharacters}");
    expect(characters).toContain("initialCharacters !== undefined");
    expect(cast).toContain("initialSupportingCharacters !== undefined");
  });

  it("coalesces /api/me and does not reload the Story when operator identity resolves", () => {
    const shell = read("apps/web/src/components/AppShell.tsx");
    const page = read("apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx");
    expect(shell).toContain("currentUserRequest");
    expect(shell).toContain("fetchCurrentUserProjection()");
    expect(page).toContain("await fetchCurrentUserProjection()");
    expect(page).toContain("}, [campaignId, storyId]);");
    expect(page).not.toContain("}, [advancedAuthorized, campaignId, storyId]);");
  });
});
