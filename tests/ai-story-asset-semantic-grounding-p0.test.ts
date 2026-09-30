import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION,
  compileStoryAssetGroundingContext,
  matchAnalyzedAssetsToStory,
  visualSemanticFactsFromSnapshot,
  type AiStoryAssetAnalysisSnapshot,
  type AiStoryAssetRegistryEntry,
} from "@ceo-agent/shared";
import {
  ASSET_INTELLIGENCE_ANALYZER_VERSION,
  ASSET_INTELLIGENCE_SCHEMA_VERSION,
  AssetAnalysisService,
  FinalizedAssetMetadataAnalyzer,
  VISUAL_SEMANTIC_ANALYZER_VERSION,
  VisualSemanticAssetAnalyzer,
  buildAiStoryPolishPrompt,
  type AssetAnalysisCacheRepository,
} from "@ceo-agent/agents";

const ids = {
  org: "10000000-0000-4000-8000-000000000001",
  workspace: "20000000-0000-4000-8000-000000000002",
  otherWorkspace: "20000000-0000-4000-8000-000000000003",
  menu: "30000000-0000-4000-8000-000000000003",
  product: "30000000-0000-4000-8000-000000000004",
  addon: "30000000-0000-4000-8000-000000000005",
  story: "40000000-0000-4000-8000-000000000004",
  version: "50000000-0000-4000-8000-000000000005",
};
const hash = `sha256:${"a".repeat(64)}`;

function asset(id = ids.product) {
  return {
    id,
    orgId: ids.org,
    workspaceId: ids.workspace,
    type: "image",
    storagePath: `${id}.png`,
    contentHash: hash,
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    durationSec: null,
    fileSizeBytes: 128,
    metadata: {},
    status: "ready",
    deletedAt: null,
  };
}

function semantics(input?: {
  addon?: boolean;
  menu?: boolean;
  product?: boolean;
  modelProductFlag?: boolean;
}) {
  const name = input?.addon ? "Red condiment" : "Main meal";
  return {
    observed: {
      visibleText: input?.menu ? ["Main meal", "Tomorrow special"] : [],
      namedItems: input?.menu ? ["Main meal", "Tomorrow special"] : [name],
      objects: input?.addon ? ["small bowl", "red sauce"] : ["plated meal"],
      people: [],
      environmentCues: [],
      brandOrLogoCues: [],
    },
    inferred: {
      categories: input?.menu
        ? (["MENU_OR_CATALOG"] as const)
        : input?.addon
          ? (["PRODUCT", "ADDON_OR_COMPONENT"] as const)
          : (["PRODUCT"] as const),
      productCandidates: input?.menu
        ? [
            { name: "Main meal", relationship: "CATALOG_CHOICE" as const, confidence: 0.99, evidence: ["visible text"] },
            { name: "Tomorrow special", relationship: "CATALOG_CHOICE" as const, confidence: 0.98, evidence: ["visible text"] },
          ]
        : [
            {
              name,
              relationship: input?.addon ? "ADDON_OR_COMPONENT" as const : "PRIMARY_PRODUCT" as const,
              confidence: input?.product === false ? 0.2 : 0.95,
              evidence: ["visible object"],
            },
          ],
      productGroundingSupported:
        input?.modelProductFlag ?? input?.product !== false,
      characterGroundingSupported: false,
    },
  };
}

async function analyzed(input?: {
  id?: string;
  addon?: boolean;
  menu?: boolean;
  product?: boolean;
  modelProductFlag?: boolean;
}) {
  const analyzer = new VisualSemanticAssetAnalyzer(async () => semantics(input));
  return analyzer.analyze({
    asset: { ...asset(input?.id), contentHash: hash },
    loadRawBytes: async () => new Uint8Array([1, 2, 3]),
  });
}

function snapshot(id: string, analysis: Awaited<ReturnType<typeof analyzed>>, workspaceId = ids.workspace): AiStoryAssetAnalysisSnapshot {
  return {
    snapshotId: id,
    orgId: ids.org,
    workspaceId,
    sourceAssetId: ids.product,
    analyzedContentHash: hash,
    analyzerVersion: VISUAL_SEMANTIC_ANALYZER_VERSION,
    schemaVersion: AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION,
    analysis,
    analysisFingerprint: `sha256:${"b".repeat(64)}`,
    createdAt: "2026-09-27T00:00:00.000Z",
  };
}

function registry(assetId = ids.product, workspaceId = ids.workspace): AiStoryAssetRegistryEntry {
  return {
    assetId,
    orgId: ids.org,
    workspaceId,
    contentHash: hash,
    mimeType: "image/png",
    fileKind: "IMAGE",
    storageRef: `${assetId}.png`,
    createdAt: "2026-09-27T00:00:00.000Z",
  };
}

describe("P0 visual semantic intelligence and Story grounding", () => {
  it("keeps the historical metadata analyzer identity and semantic affordances", async () => {
    const analyzer = new FinalizedAssetMetadataAnalyzer();
    expect(analyzer.analyzerVersion).toBe(ASSET_INTELLIGENCE_ANALYZER_VERSION);
    expect(analyzer.schemaVersion).toBe(ASSET_INTELLIGENCE_SCHEMA_VERSION);
    const result = await analyzer.analyze({ asset: { ...asset(), contentHash: hash } });
    expect(result.affordances.productGrounding).toBe(false);
    expect(result.affordances.characterGrounding).toBe(false);
  });

  it("uses a distinct analyzer and schema identity", () => {
    expect(VISUAL_SEMANTIC_ANALYZER_VERSION).toBe(
      "emberos-asset-visual-semantic-analyzer.v3"
    );
    expect(VISUAL_SEMANTIC_ANALYZER_VERSION).not.toBe(ASSET_INTELLIGENCE_ANALYZER_VERSION);
    expect(AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION).not.toBe(ASSET_INTELLIGENCE_SCHEMA_VERSION);
  });

  it("preserves observed menu names without adding unsupported names", async () => {
    const result = await analyzed({ menu: true });
    const facts = (result.facts.visualSemantics as ReturnType<typeof semantics> & { contractVersion: string });
    expect(facts.observed.namedItems).toEqual(["Main meal", "Tomorrow special"]);
    expect(facts.observed.namedItems).not.toContain("Unsupported dish");
  });

  it("establishes product grounding only from supported evidence", async () => {
    expect((await analyzed()).affordances.productGrounding).toBe(true);
    expect((await analyzed({ product: false })).affordances.productGrounding).toBe(false);
  });

  it("derives product grounding from cited evidence when the model boolean is conservative", async () => {
    const result = await analyzed({ modelProductFlag: false });
    expect(result.affordances.productGrounding).toBe(true);
    expect(
      (result.facts.visualSemantics as ReturnType<typeof semantics>).inferred
        .productGroundingSupported
    ).toBe(false);
  });

  it("keeps add-on semantics distinct from a primary product", async () => {
    const primary = visualSemanticFactsFromSnapshot(snapshot("60000000-0000-4000-8000-000000000006", await analyzed()));
    const addon = visualSemanticFactsFromSnapshot(snapshot("60000000-0000-4000-8000-000000000007", await analyzed({ addon: true })));
    expect(primary.inferred.productCandidates[0]?.relationship).toBe("PRIMARY_PRODUCT");
    expect(addon.inferred.productCandidates[0]?.relationship).toBe("ADDON_OR_COMPONENT");
  });

  it("reuses same workspace/content/analyzer/schema without another vision call", async () => {
    let cached: AiStoryAssetAnalysisSnapshot | null = null;
    const adapter = vi.fn(async () => semantics());
    const analyzer = new VisualSemanticAssetAnalyzer(adapter);
    const repository: AssetAnalysisCacheRepository = {
      findReusableAnalysis: async () => cached,
      resolveAnalysisOnce: async (input) => {
        const analysis = await input.analyze();
        cached = snapshot("60000000-0000-4000-8000-000000000008", analysis);
        return { snapshot: cached, cacheStatus: "MISS", analyzerInvoked: true };
      },
    };
    const service = new AssetAnalysisService(repository, analyzer);
    await service.analyzeFinalizedAsset({ asset: asset(), loadRawBytes: async () => new Uint8Array([1]) });
    await service.analyzeFinalizedAsset({ asset: asset(), loadRawBytes: async () => { throw new Error("must not read"); } });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("compiles deterministic context pinned to exact snapshot and hash", async () => {
    const analysis = await analyzed();
    const snap = snapshot("60000000-0000-4000-8000-000000000009", analysis);
    const context = compileStoryAssetGroundingContext({
      orgId: ids.org,
      workspaceId: ids.workspace,
      assets: [{ registry: registry(), snapshot: snap, explicitRoleHint: "PRODUCT_SOURCE" }],
    });
    expect(context.assets[0]).toMatchObject({
      assetId: ids.product,
      contentHash: hash,
      analysisSnapshotId: snap.snapshotId,
      explicitRoleHint: "PRODUCT_SOURCE",
    });
  });

  it("reuses a same-byte Snapshot first materialized by another Asset row", async () => {
    const analysis = await analyzed();
    const snap = snapshot("60000000-0000-4000-8000-000000000014", analysis);
    const secondAsset = registry(ids.addon);
    const context = compileStoryAssetGroundingContext({
      orgId: ids.org,
      workspaceId: ids.workspace,
      assets: [{ registry: secondAsset, snapshot: snap }],
    });
    expect(context.assets[0]?.assetId).toBe(ids.addon);
    expect(context.assets[0]?.analysisSnapshotId).toBe(snap.snapshotId);
  });

  it("fails closed across Workspaces", async () => {
    const snap = snapshot("60000000-0000-4000-8000-000000000010", await analyzed(), ids.otherWorkspace);
    expect(() => compileStoryAssetGroundingContext({
      orgId: ids.org,
      workspaceId: ids.workspace,
      assets: [{ registry: registry(), snapshot: snap }],
    })).toThrow(/authorized Workspace/);
  });

  it("injects immutable grounded evidence and anti-invention rules into Writer prompt", async () => {
    const snap = snapshot("60000000-0000-4000-8000-000000000011", await analyzed({ menu: true }));
    const context = compileStoryAssetGroundingContext({
      orgId: ids.org,
      workspaceId: ids.workspace,
      assets: [{ registry: registry(), snapshot: snap }],
    });
    const prompt = buildAiStoryPolishPrompt({
      originalIdea: "Choose a real item now and another tomorrow.",
      campaign: { name: "Grounded Story" },
      assetLabels: [],
      assetGroundingContext: context,
    });
    expect(prompt.user).toContain("Grounded Asset Authority");
    expect(prompt.user).toContain("Tomorrow special");
    expect(prompt.system).toContain("never invent unsupported names");
    expect(prompt.system).toContain("source Asset evidence");
  });

  it("creates typed matching bindings after a canonical Story Version identity exists", async () => {
    const analysis = await analyzed();
    const snap = snapshot("60000000-0000-4000-8000-000000000012", analysis);
    const result = matchAnalyzedAssetsToStory({
      matchingResultId: "70000000-0000-4000-8000-000000000007",
      orgId: ids.org,
      workspaceId: ids.workspace,
      storyId: ids.story,
      storyVersionId: ids.version,
      storyVersionNumber: 1,
      requirements: { productIdentityRequired: true, nativeDialogueDesired: true },
      assets: [{ registry: registry(), snapshot: snap }],
      semanticDecisions: [{
        assetId: ids.product,
        analysisSnapshotId: snap.snapshotId,
        intent: "PRODUCT_IDENTITY",
        required: true,
        reason: "Explicit Product source with supported evidence",
        source: "HUMAN_SELECTION",
      }],
      bindingIdByAssetId: { [ids.product]: "80000000-0000-4000-8000-000000000008" },
      matcherVersion: "test-matcher.v1",
      createdAt: "2026-09-27T00:00:00.000Z",
    });
    expect(result.storyVersionId).toBe(ids.version);
    expect(result.bindings[0]).toMatchObject({
      assetId: ids.product,
      assetContentHash: hash,
      analysisSnapshotId: snap.snapshotId,
      analysisContentHash: hash,
      role: "PRODUCT_AUTHORITY",
    });
  });

  it("rejects semantic role beyond immutable analysis affordance", async () => {
    const snap = snapshot("60000000-0000-4000-8000-000000000013", await analyzed({ product: false }));
    expect(() => matchAnalyzedAssetsToStory({
      matchingResultId: "70000000-0000-4000-8000-000000000009",
      orgId: ids.org,
      workspaceId: ids.workspace,
      storyId: ids.story,
      storyVersionId: ids.version,
      storyVersionNumber: 1,
      requirements: { productIdentityRequired: true },
      assets: [{ registry: registry(), snapshot: snap }],
      semanticDecisions: [{
        assetId: ids.product,
        analysisSnapshotId: snap.snapshotId,
        intent: "PRODUCT_IDENTITY",
        required: true,
        reason: "Unsupported role attempt",
        source: "HUMAN_SELECTION",
      }],
      bindingIdByAssetId: { [ids.product]: "80000000-0000-4000-8000-000000000009" },
      matcherVersion: "test-matcher.v1",
      createdAt: "2026-09-27T00:00:00.000Z",
    })).toThrow(/exceeds immutable Asset analysis affordances/);
  });

  it("wires the real Generate Episode runtime in canonical order", () => {
    const source = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/generate/route.ts",
      "utf8"
    );
    const prepare = source.indexOf("prepareStoryAssetGrounding({");
    const writer = source.indexOf("polishAiStoryDraft({");
    const version = source.indexOf("createAiStoryVersion(db");
    const matching = source.indexOf("persistStoryAssetMatching({");
    const review = source.indexOf('setAiStoryStatus(db, storyId, "generating", "review")');
    expect(prepare).toBeGreaterThan(-1);
    expect(writer).toBeGreaterThan(prepare);
    expect(version).toBeGreaterThan(writer);
    expect(matching).toBeGreaterThan(version);
    expect(review).toBeGreaterThan(matching);
    expect(source).not.toContain("Seedance");
  });
});
