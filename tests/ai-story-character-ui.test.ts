import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("AI Story Character Panel source boundary", () => {
  it("provides Campaign-scoped Add, Edit, Delete, relationships, and mobile layout", () => {
    const component = read("apps/web/src/components/ai-story/CharacterPanel.tsx");
    expect(component).toContain("Add Character");
    expect(component).toContain(">Edit<");
    expect(component).toContain(">Delete<");
    expect(component).toContain("Relationships");
    expect(component).toContain("sm:items-center");
    expect(component).toContain("rounded-t-2xl");
    expect(component).toContain("Historical Stories remain unchanged");
  });

  it("mounts inside AI Story and exposes no Provider or fingerprint internals", () => {
    const page = read("apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx");
    const component = read("apps/web/src/components/ai-story/CharacterPanel.tsx").toLowerCase();
    expect(page).toContain("<CharacterPanel campaignId={campaignId} canEdit={advancedAuthorized}");
    for (const forbidden of ["seedance", "provider mapping", "fingerprint", "characterVersionId"]) expect(component).not.toContain(forbidden.toLowerCase());
  });

  it("uses existing AI Story authorization and Campaign-scoped API routes", () => {
    const collection = read("apps/web/src/app/api/campaigns/[id]/characters/route.ts");
    const member = read("apps/web/src/app/api/campaigns/[id]/characters/[characterId]/route.ts");
    expect(collection).toContain('minRole: mutation ? "operator" : "client_viewer"');
    expect(member).toContain('minRole: "operator"');
    expect(collection).toContain("AiStoryCharacterAuthorityService");
    expect(member).toContain("AiStoryCharacterAuthorityService");
  });
});
