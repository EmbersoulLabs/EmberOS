import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COVER_COMPOSITION_AUTHORITY_VERSION,
  CoverCompositionAuthoritySchema,
  VISUAL_STYLE_AUTHORITY_VERSION,
  VISUAL_STYLE_PRESETS,
  VisualAuthorityStoryBindingSchema,
  VisualStyleAuthoritySchema,
  createCoverCompositionAuthority,
  createVisualStyleAuthority,
  fingerprintSemanticValue,
  getVisualStylePreset,
  resolveVisualDirection,
  validateVisualAuthorityReadiness,
  type VisualAuthorityStoryBinding,
  type VisualSourceLineage,
} from "@ceo-agent/shared";

const IDS = {
  workspace: "11111111-1111-4111-8111-111111111111",
  campaign: "22222222-2222-4222-8222-222222222222",
  story: "33333333-3333-4333-8333-333333333333",
  version: "44444444-4444-4444-8444-444444444444",
  style: "55555555-5555-4555-8555-555555555555",
  cover: "66666666-6666-4666-8666-666666666666",
  asset: "77777777-7777-4777-8777-777777777777",
} as const;

const photoSceneLineage: VisualSourceLineage = {
  sourceKind: "photo_scene",
  assetId: IDS.asset,
  workspaceId: IDS.workspace,
  storagePath: `${IDS.workspace}/assets/hero.webp`,
  contentFingerprint: "sha256:source-photo",
  readiness: "ready",
};

function fixture() {
  const visualStyle = createVisualStyleAuthority({
    authorityId: IDS.style,
    workspaceId: IDS.workspace,
    presetId: "brand-minimal",
    sourceLineage: [photoSceneLineage],
  });
  const cover = createCoverCompositionAuthority({
    authorityId: IDS.cover,
    workspaceId: IDS.workspace,
    visualStyle,
  });
  const binding: VisualAuthorityStoryBinding = {
    workspaceId: IDS.workspace,
    campaignId: IDS.campaign,
    storyId: IDS.story,
    storyVersionId: IDS.version,
    storyVersionNumber: 2,
    visualStyleAuthorityId: visualStyle.authorityId,
    visualStyleFingerprint: visualStyle.semanticFingerprint,
    coverCompositionAuthorityId: cover.authorityId,
    coverCompositionFingerprint: cover.semanticFingerprint,
  };
  return { visualStyle, cover, binding };
}

describe("VISUAL-STYLE-AND-COVER-AUTHORITY-V1 acceptance A-J", () => {
  it("A — exposes versioned strict contracts and a versioned preset registry", () => {
    const { visualStyle, cover, binding } = fixture();
    expect(VisualStyleAuthoritySchema.parse(visualStyle).contractVersion).toBe(
      VISUAL_STYLE_AUTHORITY_VERSION
    );
    expect(CoverCompositionAuthoritySchema.parse(cover).contractVersion).toBe(
      COVER_COMPOSITION_AUTHORITY_VERSION
    );
    expect(VisualAuthorityStoryBindingSchema.parse(binding).storyVersionNumber).toBe(2);
    expect(VISUAL_STYLE_PRESETS.map((preset) => preset.id)).toEqual([
      "brand-minimal",
      "cinematic-story",
      "product-hero",
      "social-impact",
    ]);
    expect(VISUAL_STYLE_PRESETS.every((preset) => preset.version === 1)).toBe(true);
  });

  it("B — fingerprints canonical semantic values independent of object key order", () => {
    expect(fingerprintSemanticValue({ b: 2, a: 1 })).toBe(
      fingerprintSemanticValue({ a: 1, b: 2 })
    );
    expect(fingerprintSemanticValue({ a: 2 })).not.toBe(
      fingerprintSemanticValue({ a: 1 })
    );
    expect(fingerprintSemanticValue({ a: 1 })).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("C — returns immutable authority and registry snapshots", () => {
    const { visualStyle, cover } = fixture();
    expect(Object.isFrozen(visualStyle)).toBe(true);
    expect(Object.isFrozen(visualStyle.preferences)).toBe(true);
    expect(Object.isFrozen(cover.sourceLineage[0])).toBe(true);
    expect(Object.isFrozen(VISUAL_STYLE_PRESETS)).toBe(true);
    expect(Object.isFrozen(getVisualStylePreset("brand-minimal")!.cover)).toBe(true);
  });

  it("D — keeps Character, Product, and Brand identity out of style semantics", () => {
    const { visualStyle } = fixture();
    expect(() =>
      VisualStyleAuthoritySchema.parse({
        ...visualStyle,
        preferences: {
          ...visualStyle.preferences,
          characterIdentity: "replace the person",
        },
      })
    ).toThrow();
  });

  it("E — resolves fixed identity precedence before visual style", () => {
    const { visualStyle } = fixture();
    const resolved = resolveVisualDirection(
      {
        character: ["keep face and wardrobe"],
        product: ["keep packaging geometry"],
        brand: ["keep logo and approved colors"],
      },
      visualStyle
    );
    expect(resolved.precedence).toEqual([
      "character",
      "product",
      "brand",
      "visual_style",
    ]);
    expect(resolved.identityConstraints.map((entry) => entry.authority)).toEqual([
      "character",
      "product",
      "brand",
    ]);
    expect(resolved.stylePreferences).toBe(visualStyle.preferences);
  });

  it("F — binds both authority fingerprints to an exact Story Version", () => {
    const { visualStyle, cover, binding } = fixture();
    const readiness = validateVisualAuthorityReadiness({
      workspaceId: IDS.workspace,
      storyId: IDS.story,
      storyVersionId: IDS.version,
      availableAssetIds: new Set([IDS.asset]),
      visualStyle,
      cover,
      binding,
    });
    expect(readiness).toEqual({ ready: true, issues: [] });
    expect(
      validateVisualAuthorityReadiness({
        workspaceId: IDS.workspace,
        storyId: IDS.story,
        storyVersionId: "88888888-8888-4888-8888-888888888888",
        availableAssetIds: new Set([IDS.asset]),
        visualStyle,
        cover,
        binding,
      }).issues.map((issue) => issue.code)
    ).toContain("story_binding_mismatch");
  });

  it("G — reuses Photo Scene through workspace Asset lineage without media duplication", () => {
    const { visualStyle } = fixture();
    expect(visualStyle.sourceLineage).toEqual([photoSceneLineage]);
    expect(visualStyle.sourceLineage[0]).toMatchObject({
      sourceKind: "photo_scene",
      assetId: IDS.asset,
    });
    expect(Object.keys(visualStyle.sourceLineage[0]!)).not.toContain("bytes");
    expect(Object.keys(visualStyle.sourceLineage[0]!)).not.toContain("url");
  });

  it("H — blocks missing, unready, cross-workspace, and unscoped lineage", () => {
    const { visualStyle, cover, binding } = fixture();
    const invalidStyle = {
      ...visualStyle,
      workspaceId: "99999999-9999-4999-8999-999999999999",
      sourceLineage: [
        {
          ...photoSceneLineage,
          workspaceId: "99999999-9999-4999-8999-999999999999",
          readiness: "pending" as const,
          storagePath: "other/assets/hero.webp",
        },
      ],
    };
    const result = validateVisualAuthorityReadiness({
      workspaceId: IDS.workspace,
      storyId: IDS.story,
      storyVersionId: IDS.version,
      availableAssetIds: new Set(),
      visualStyle: invalidStyle,
      cover,
      binding,
    });
    expect(result.ready).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "workspace_mismatch",
        "storage_path_not_workspace_scoped",
        "source_not_ready",
        "source_asset_missing",
      ])
    );
  });

  it("I — detects semantic tampering and cover/style fingerprint disagreement", () => {
    const { visualStyle, cover, binding } = fixture();
    const tamperedStyle = {
      ...visualStyle,
      preferences: { ...visualStyle.preferences, contrast: "soft" as const },
    };
    const disconnectedCover = {
      ...cover,
      visualStyleFingerprint: fingerprintSemanticValue({ disconnected: true }),
    };
    const result = validateVisualAuthorityReadiness({
      workspaceId: IDS.workspace,
      storyId: IDS.story,
      storyVersionId: IDS.version,
      availableAssetIds: new Set([IDS.asset]),
      visualStyle: tamperedStyle,
      cover: disconnectedCover,
      binding,
    });
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "visual_style_fingerprint_mismatch",
        "cover_style_binding_mismatch",
      ])
    );
  });

  it("J — stays provider-neutral, excludes Audio/Voice, and exposes preview-only UI", () => {
    const contractSource = readFileSync(
      resolve("packages/shared/src/visual-style-authority.ts"),
      "utf8"
    );
    const previewSource = readFileSync(
      resolve(
        "apps/web/src/components/ai-story-review/VisualStyleAuthorityPreview.tsx"
      ),
      "utf8"
    );
    expect(contractSource).not.toMatch(/\b(provider|modelId|seedance|minimax)\s*:/i);
    expect(contractSource).not.toMatch(/\b(audio|voice)\s*:/i);
    expect(previewSource).toContain("Preview only; no generation is queued.");
    expect(previewSource).toContain("Identity authority remains separate");
  });
});
