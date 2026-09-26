import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_OUTLINE_PROFILE_REGISTRY,
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AiStoryCreateBodySchema,
  canonicalAiStoryOutlineProfileReference,
  mapEpisodeTypeToOutlineProfile,
} from "@ceo-agent/shared";
import {
  AiStoryOutlineProfileAuthorityError,
  resolveAiStoryOutlineProfileAuthority,
} from "@ceo-agent/db";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const scope = { orgId: id(1), workspaceId: id(2), campaignId: id(3), storyId: id(4) };
const db = {} as never;
const core = { profileId: "CORE" as const, profileVersion: 1 as const };
const productStory = {
  profileId: "PRODUCT_STORY" as const,
  profileVersion: 1 as const,
  policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
};
const commercialStory = {
  profileId: "COMMERCIAL_STORY" as const,
  profileVersion: 1 as const,
  policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
};

function create(overrides: Record<string, unknown> = {}) {
  return {
    title: "Exact Story",
    originalIdea: "An explicit human-authored story intent",
    outlineProfile: core,
    assetIds: [],
    productAssetIds: [],
    ...overrides,
  };
}

describe("AI Story Outline Profile selection authority", () => {
  it("requires explicit CORE, PRODUCT_STORY, or COMMERCIAL_STORY selection and denies arbitrary values", () => {
    expect(AiStoryCreateBodySchema.safeParse(create()).success).toBe(true);
    expect(AiStoryCreateBodySchema.safeParse(create({ outlineProfile: productStory })).success).toBe(true);
    expect(AiStoryCreateBodySchema.safeParse(create({ outlineProfile: commercialStory })).success).toBe(true);
    const { outlineProfile: _missing, ...missing } = create();
    expect(AiStoryCreateBodySchema.safeParse(missing).success).toBe(false);
    expect(AiStoryCreateBodySchema.safeParse(create({ outlineProfile: { profileId: "OTHER", profileVersion: 1 } })).success).toBe(false);
  });

  it.each([
    "COMMERCIAL_STORY",
    "PRODUCT_STORY",
    "BRAND_STORY",
    "SERVICE_STORY",
    "FOOD_STORY",
    "EMOTIONAL_STORY",
    "ENTERTAINMENT_STORY",
  ] as const)("maps the real Episode form %s selection to an accepted canonical create payload", (episodeType) => {
    const outlineProfile = mapEpisodeTypeToOutlineProfile(episodeType);
    expect(outlineProfile).not.toHaveProperty("hookRequired");
    expect(AiStoryCreateBodySchema.safeParse(create({ outlineProfile })).success).toBe(true);
  });

  it("keeps PRODUCT_STORY policy identity server-registered", () => {
    expect(AiStoryCreateBodySchema.safeParse(create({
      outlineProfile: { ...productStory, policyFingerprint: `sha256:${"0".repeat(64)}` },
    })).success).toBe(false);
    expect(canonicalAiStoryOutlineProfileReference(productStory)).toEqual({
      profileId: AI_STORY_OUTLINE_PROFILE_REGISTRY.PRODUCT_STORY.profileId,
      profileVersion: AI_STORY_OUTLINE_PROFILE_REGISTRY.PRODUCT_STORY.profileVersion,
      policyFingerprint: AI_STORY_OUTLINE_PROFILE_REGISTRY.PRODUCT_STORY.policyFingerprint,
    });
  });

  it("does not select a profile from Product presence, Product absence, or Campaign intent", () => {
    const withoutProfile = {
      title: "No inference",
      originalIdea: "Sell this product",
      assetIds: [id(10)],
      productAssetIds: [id(10)],
      campaignObjective: "sales",
    };
    expect(AiStoryCreateBodySchema.safeParse(withoutProfile).success).toBe(false);
    expect(AiStoryCreateBodySchema.safeParse({ ...withoutProfile, assetIds: [], productAssetIds: [] }).success).toBe(false);
  });

  it.each([["CORE", core], ["PRODUCT_STORY", productStory], ["COMMERCIAL_STORY", commercialStory]] as const)(
    "resolves exact persisted %s authority",
    async (_name, stored) => {
      await expect(resolveAiStoryOutlineProfileAuthority(db, scope, {
        loadStoredProfile: async () => stored,
      })).resolves.toEqual(stored);
    }
  );

  it("fails closed for legacy null and invalid persisted authority", async () => {
    await expect(resolveAiStoryOutlineProfileAuthority(db, scope, {
      loadStoredProfile: async () => null,
    })).rejects.toMatchObject<Partial<AiStoryOutlineProfileAuthorityError>>({
      code: "STORY_OUTLINE_PROFILE_UNRESOLVED",
    });
    await expect(resolveAiStoryOutlineProfileAuthority(db, scope, {
      loadStoredProfile: async () => ({ profileId: "CORE", profileVersion: 2 }),
    })).rejects.toMatchObject<Partial<AiStoryOutlineProfileAuthorityError>>({
      code: "STORY_OUTLINE_PROFILE_INVALID",
    });
  });

  it("persists the canonical profile at creation and consumes it on generate/rewrite", () => {
    const createRoute = readFileSync("apps/web/src/app/api/campaigns/[id]/ai-stories/route.ts", "utf8");
    const generateRoute = readFileSync("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/generate/route.ts", "utf8");
    const rewriteRoute = readFileSync("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/rewrite/route.ts", "utf8");
    expect(createRoute).toContain("outlineProfile: canonicalAiStoryOutlineProfileReference(parsed.data.outlineProfile)");
    expect(generateRoute).toContain("resolveAiStoryOutlineProfileAuthority");
    expect(rewriteRoute).toContain("resolveAiStoryOutlineProfileAuthority");
  });

  it("keeps profile immutable across Story versions and ordinary draft updates", () => {
    const service = readFileSync("apps/web/src/lib/ai-story-service.ts", "utf8");
    const updateRoute = readFileSync("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/route.ts", "utf8");
    const versionFunction = service.slice(service.indexOf("export async function createAiStoryVersion"));
    expect(versionFunction).not.toContain("outlineProfile");
    expect(updateRoute).not.toContain("outlineProfile");
  });

  it("adds only a nullable JSONB column with no default or historical backfill", () => {
    const migration = readFileSync("packages/db/sql/ai-story-outline-profile-authority-v1.sql", "utf8");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS outline_profile jsonb/i);
    expect(migration).not.toMatch(/\bDEFAULT\b/i);
    expect(migration).not.toMatch(/\bUPDATE\s+ai_stories\b/i);
    expect(migration).not.toMatch(/CREATE\s+TABLE/i);
  });

  it("requires an explicit UI choice independent of selected assets", () => {
    const page = readFileSync("apps/web/src/components/ai-story/EpisodeCreateForm.tsx", "utf8");
    expect(page).toContain("mapEpisodeTypeToOutlineProfile");
    expect(page).toContain('name="outlineProfile"');
    expect(page).toContain("AI_STORY_EPISODE_USER_TYPES");
    expect(page).not.toMatch(/productAssetIds\.length[^\n]*(CORE|PRODUCT_STORY|COMMERCIAL_STORY)/);
  });
});
