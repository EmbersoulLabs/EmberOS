import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { closeDb, getDb } from "@ceo-agent/db";
import {
  AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION,
  PHOTO_SCENE_EXTRACTION_CONTRACT,
  PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
  PHOTO_SCENE_EXTRACTION_POLICY,
  photoSceneMetadata,
  type ExactProductDerivativeResolution,
  type ProductBackgroundSuitabilityAuthority,
} from "@ceo-agent/shared";
import {
  deriveProductVisualMaterialSelectionAuthority,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import { fingerprintPhotoSceneExtractionIdentityV1 } from "@ceo-agent/shared/photo-scene-extraction.server";
import { resolveExactStoryProductDerivative } from "../apps/web/src/lib/ai-story-exact-product-derivative";
import { readPlanningProductMaterialAuthorityError } from "../apps/web/src/lib/ai-story-product-material-runtime";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;

function suitability(input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  productAuthorityId: string;
  sourceHash: string;
  confirmedVariant?: string;
}): ProductBackgroundSuitabilityAuthority {
  const body = {
    contractVersion: AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    productAuthorityId: input.productAuthorityId,
    sourceAssetId: input.productAuthorityId,
    sourceAssetContentHash: input.sourceHash,
    ...(input.confirmedVariant ? { confirmedVariant: input.confirmedVariant } : {}),
    mimeType: "image/png",
    inspectionVersion: "product-transparency-inspection.v1",
    inspection: {
      byteHashVerified: true as const,
      byteLength: 128,
      transparencyState: "FULLY_OPAQUE" as const,
    },
    outcome: "OPAQUE_NOT_ISOLATED" as const,
  };
  return {
    ...body,
    fingerprint: sha256CanonicalIntegrityHash({
      kind: AI_STORY_PRODUCT_BACKGROUND_SUITABILITY_CONTRACT_VERSION,
      authority: body,
    }),
  } as ProductBackgroundSuitabilityAuthority;
}

describe.skipIf(!RUN_DB_INTEGRATION).sequential(
  "authority consistency real HTTP/PostgreSQL",
  () => {
    let sql: Sql;
    let fixture: RlsTestFixture;
    let server: Server;
    let baseUrl = "";
    const storyA = crypto.randomUUID();
    const storyA2 = crypto.randomUUID();
    const storyB = crypto.randomUUID();
    const storyCharacter = crypto.randomUUID();
    const storyAmbiguous = crypto.randomUUID();
    const sourceA = crypto.randomUUID();
    const derivativeA = crypto.randomUUID();
    const sourceB = crypto.randomUUID();
    const sourceAmbiguous = crypto.randomUUID();
    const derivativeAmbiguousA = crypto.randomUUID();
    const derivativeAmbiguousB = crypto.randomUUID();
    const generationA = crypto.randomUUID();
    const generationStale = crypto.randomUUID();
    const generationAmbiguousA = crypto.randomUUID();
    const generationAmbiguousB = crypto.randomUUID();
    const sourceHash = hash("a");
    const derivativeHash = hash("d");
    const staleHash = hash("c");
    let fingerprint = "";
    let ambiguousFingerprint = "";

    async function post(path: string, body: Record<string, unknown>) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as Record<string, unknown>;
      return { status: response.status, payload };
    }

    beforeAll(async () => {
      sql = createIntegrationSql();
      fixture = await seedRlsFixture(sql);
      fingerprint = fingerprintPhotoSceneExtractionIdentityV1({
        version: PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
        contract: PHOTO_SCENE_EXTRACTION_CONTRACT,
        operation: "product_extraction",
        policy: PHOTO_SCENE_EXTRACTION_POLICY,
        workspaceId: fixture.workspaceAId,
        sourceContentHash: sourceHash,
      });
      ambiguousFingerprint = fingerprintPhotoSceneExtractionIdentityV1({
        version: PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
        contract: PHOTO_SCENE_EXTRACTION_CONTRACT,
        operation: "product_extraction",
        policy: PHOTO_SCENE_EXTRACTION_POLICY,
        workspaceId: fixture.workspaceAId,
        sourceContentHash: hash("b"),
      });
      const lineage = (sourceAssetId: string, sourceContentHash: string, generationId: string, generationFingerprint: string) => sql.json({
        photoScene: photoSceneMetadata("extracted_product", {
          operation: "product_extraction",
          sourceAssetId,
          sourceContentHash,
          generationId,
          generationFingerprint,
        }),
      } as never);

      await sql`
        INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path, mime_type, content_hash, status, metadata)
        VALUES
          (${sourceA}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"image"}, ${`${fixture.workspaceAId}/library/${sourceA}.png`}, ${"image/png"}, ${sourceHash}, ${"ready"}, ${sql.json({ photoScene: photoSceneMetadata("product_source") } as never)}),
          (${derivativeA}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"image"}, ${`${fixture.workspaceAId}/library/${derivativeA}.png`}, ${"image/png"}, ${derivativeHash}, ${"ready"}, ${lineage(sourceA, sourceHash, generationA, fingerprint)}),
          (${sourceB}, ${fixture.orgId}, ${fixture.workspaceBId}, ${fixture.campaignBId}, ${"image"}, ${`${fixture.workspaceBId}/library/${sourceB}.png`}, ${"image/png"}, ${sourceHash}, ${"ready"}, ${sql.json({ photoScene: photoSceneMetadata("product_source") } as never)}),
          (${sourceAmbiguous}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"image"}, ${`${fixture.workspaceAId}/library/${sourceAmbiguous}.png`}, ${"image/png"}, ${hash("b")}, ${"ready"}, ${sql.json({ photoScene: photoSceneMetadata("product_source") } as never)}),
          (${derivativeAmbiguousA}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"image"}, ${`${fixture.workspaceAId}/library/${derivativeAmbiguousA}.png`}, ${"image/png"}, ${hash("e")}, ${"ready"}, ${lineage(sourceAmbiguous, hash("b"), generationAmbiguousA, ambiguousFingerprint)}),
          (${derivativeAmbiguousB}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"image"}, ${`${fixture.workspaceAId}/library/${derivativeAmbiguousB}.png`}, ${"image/png"}, ${hash("f")}, ${"ready"}, ${lineage(sourceAmbiguous, hash("b"), generationAmbiguousB, ambiguousFingerprint)})
      `;
      await sql`
        INSERT INTO campaign_asset_refs (campaign_id, asset_id) VALUES
          (${fixture.campaignAId}, ${sourceA}),
          (${fixture.campaignAId}, ${derivativeA}),
          (${fixture.campaignAId}, ${sourceAmbiguous}),
          (${fixture.campaignAId}, ${derivativeAmbiguousA}),
          (${fixture.campaignAId}, ${derivativeAmbiguousB}),
          (${fixture.campaignBId}, ${sourceB})
      `;
      await sql`
        INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea) VALUES
          (${storyA}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"Product story"}, ${"Product story"}),
          (${storyA2}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"Historical successor"}, ${"Historical successor"}),
          (${storyB}, ${fixture.orgId}, ${fixture.workspaceBId}, ${fixture.campaignBId}, ${"Other workspace"}, ${"Other workspace"}),
          (${storyCharacter}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"Character only"}, ${"Character only"}),
          (${storyAmbiguous}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"Ambiguous lineage"}, ${"Ambiguous lineage"})
      `;
      await sql`
        INSERT INTO ai_story_asset_links (story_id, asset_id, usage_type, confirmed_variant) VALUES
          (${storyA}, ${sourceA}, ${"product_source"}, ${"north-facing"}),
          (${storyA2}, ${sourceA}, ${"product_source"}, ${"north-facing"}),
          (${storyB}, ${sourceB}, ${"product_source"}, ${"workspace-b"}),
          (${storyAmbiguous}, ${sourceAmbiguous}, ${"product_source"}, ${"ambiguous"})
      `;
      await sql`
        INSERT INTO photo_scene_generations (
          id, org_id, workspace_id, campaign_id, operation, status,
          source_asset_id, source_content_hash, input_capsule, input_fingerprint,
          output_asset_id, attempt_count, created_by, completed_at
        ) VALUES
          (${generationA}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"product_extraction"}, ${"ready"}, ${sourceA}, ${sourceHash}, ${sql.json({} as never)}, ${fingerprint}, ${derivativeA}, 1, ${fixture.userAId}, now()),
          (${generationStale}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"product_extraction"}, ${"ready"}, ${sourceA}, ${staleHash}, ${sql.json({} as never)}, ${hash("9")}, ${derivativeA}, 1, ${fixture.userAId}, now() - interval '2 days'),
          (${generationAmbiguousA}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"product_extraction"}, ${"ready"}, ${sourceAmbiguous}, ${hash("b")}, ${sql.json({} as never)}, ${ambiguousFingerprint}, ${derivativeAmbiguousA}, 1, ${fixture.userAId}, now()),
          (${generationAmbiguousB}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"product_extraction"}, ${"ready"}, ${sourceAmbiguous}, ${hash("b")}, ${sql.json({} as never)}, ${ambiguousFingerprint}, ${derivativeAmbiguousB}, 1, ${fixture.userAId}, now())
      `;

      server = createServer(async (request, response) => {
        if (request.method !== "POST" || request.url !== "/authority") {
          response.writeHead(404).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          storyId: string;
          workspaceId: string;
          campaignId: string;
          productAuthorityId: string;
          confirmedVariant?: string;
        };
        try {
          const resolution = await resolveExactStoryProductDerivative(getDb(), {
            orgId: fixture.orgId,
            workspaceId: body.workspaceId,
            campaignId: body.campaignId,
            storyId: body.storyId,
            productAuthorityId: body.productAuthorityId,
          });
          const bound = suitability({
            orgId: fixture.orgId,
            workspaceId: body.workspaceId,
            campaignId: body.campaignId,
            productAuthorityId: body.productAuthorityId,
            sourceHash: resolution.sourceAssetContentHash,
            ...(body.confirmedVariant ? { confirmedVariant: body.confirmedVariant } : {}),
          });
          const selection = deriveProductVisualMaterialSelectionAuthority({
            sceneScope: {
              orgId: fixture.orgId,
              workspaceId: body.workspaceId,
              campaignId: body.campaignId,
              storyId: body.storyId,
              storyVersionId: storyA,
              sceneId: sourceA,
              sceneVersionId: derivativeA,
            },
            sceneProductBinding: {
              productAuthorityId: resolution.productAuthorityId,
              sourceAssetId: resolution.sourceAssetId,
              sourceAssetContentHash: resolution.sourceAssetContentHash,
              ...(resolution.confirmedVariant ? { confirmedVariant: resolution.confirmedVariant } : {}),
            },
            resolvedProductAuthority: {
              productAuthorityId: resolution.productAuthorityId,
              sourceAssetId: resolution.sourceAssetId,
              sourceAssetContentHash: resolution.sourceAssetContentHash,
              ...(resolution.confirmedVariant ? { confirmedVariant: resolution.confirmedVariant } : {}),
              displayName: "Product",
              identityFacts: ["Canonical Product"],
              visibleEvidenceGoals: [],
              sceneStateFacts: [],
              mustKeep: [],
              mustAvoid: [],
              visualIdentityRequirement: "REQUIRED",
            },
            effectiveGenerationAuthority: {
              strategy: "PRODUCT_GROUNDED_VIDEO",
              referenceSource: "STORY_INHERITED",
              effectiveReferenceIds: [resolution.sourceAssetId],
              firstFrameAssetId: resolution.sourceAssetId,
              productVisualIdentityRequirement: "REQUIRED",
            },
            suitability: bound,
            derivativeResolution: resolution,
          });
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ resolution, selection }));
        } catch (error) {
          const authority = readPlanningProductMaterialAuthorityError(error);
          response.writeHead(authority ? 409 : 500, { "Content-Type": "application/json" });
          response.end(JSON.stringify(authority ?? { code: "INTERNAL_ERROR", message: "Unexpected server error." }));
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("HTTP listener missing");
      baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
      if (!sql || !fixture) return;
      await closeDb();
      await sql`DELETE FROM ai_story_asset_links WHERE story_id IN (${storyA}, ${storyA2}, ${storyB}, ${storyCharacter}, ${storyAmbiguous})`;
      await sql`DELETE FROM photo_scene_generations WHERE id IN (${generationA}, ${generationStale}, ${generationAmbiguousA}, ${generationAmbiguousB})`;
      await sql`DELETE FROM ai_stories WHERE id IN (${storyA}, ${storyA2}, ${storyB}, ${storyCharacter}, ${storyAmbiguous})`;
      await sql`DELETE FROM campaign_asset_refs WHERE asset_id IN (${sourceA}, ${derivativeA}, ${sourceB}, ${sourceAmbiguous}, ${derivativeAmbiguousA}, ${derivativeAmbiguousB})`;
      await sql`DELETE FROM assets WHERE id IN (${sourceA}, ${derivativeA}, ${sourceB}, ${sourceAmbiguous}, ${derivativeAmbiguousA}, ${derivativeAmbiguousB})`;
      await cleanupRlsFixture(sql, fixture);
      await sql.end();
    });

    it("passes the same confirmed-variant snapshot through HTTP twice and keeps source lineage", async () => {
      const request = {
        storyId: storyA,
        workspaceId: fixture.workspaceAId,
        campaignId: fixture.campaignAId,
        productAuthorityId: sourceA,
        confirmedVariant: "north-facing",
      };
      const first = await post("/authority", request);
      const second = await post("/authority", request);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const resolution = first.payload.resolution as ExactProductDerivativeResolution;
      const selection = first.payload.selection as { fingerprint: string; selection: string; selectedMaterial: { assetId: string; kind: string } | null; productAuthority: { sourceAssetId: string; confirmedVariant?: string } };
      const again = second.payload.selection as { fingerprint: string };
      expect(resolution).toMatchObject({
        status: "FOUND",
        sourceAssetId: sourceA,
        confirmedVariant: "north-facing",
        derivative: { assetId: derivativeA },
      });
      expect(resolution.status === "FOUND" && resolution.derivative.assetId).not.toBe(sourceA);
      expect(resolution.status === "FOUND" && resolution.derivative.generationId).toBe(generationA);
      expect(selection.selection).toBe("EXTRACTED_DERIVATIVE");
      expect(selection.selectedMaterial).toMatchObject({ kind: "EXTRACTED_DERIVATIVE", assetId: derivativeA });
      expect(selection.productAuthority.sourceAssetId).toBe(sourceA);
      expect(selection.productAuthority.confirmedVariant).toBe("north-facing");
      expect(again.fingerprint).toBe(selection.fingerprint);

      const successor = await post("/authority", { ...request, storyId: storyA2 });
      expect(successor.status).toBe(200);
      expect((successor.payload.resolution as ExactProductDerivativeResolution).status === "FOUND"
        && (successor.payload.resolution as { derivative: { assetId: string } }).derivative.assetId).toBe(derivativeA);
      const [{ count }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM photo_scene_generations WHERE source_asset_id = ${sourceA} AND input_fingerprint = ${fingerprint}
      `;
      expect(count).toBe("1");
    });

    it("keeps another workspace, a character-only story, stale lineage, and ambiguous lineage closed", async () => {
      const otherWorkspace = await post("/authority", {
        storyId: storyB,
        workspaceId: fixture.workspaceBId,
        campaignId: fixture.campaignBId,
        productAuthorityId: sourceB,
        confirmedVariant: "workspace-b",
      });
      expect(otherWorkspace.status).toBe(200);
      const otherResolution = otherWorkspace.payload.resolution as ExactProductDerivativeResolution;
      expect(otherResolution.status).toBe("NOT_FOUND");
      expect(JSON.stringify(otherResolution)).not.toContain(derivativeA);

      const character = await post("/authority", {
        storyId: storyCharacter,
        workspaceId: fixture.workspaceAId,
        campaignId: fixture.campaignAId,
        productAuthorityId: sourceA,
      });
      expect(character.status).toBe(409);
      expect(character.payload.code).toBe("EXACT_STORY_PRODUCT_AUTHORITY_REQUIRED");

      const ambiguous = await post("/authority", {
        storyId: storyAmbiguous,
        workspaceId: fixture.workspaceAId,
        campaignId: fixture.campaignAId,
        productAuthorityId: sourceAmbiguous,
        confirmedVariant: "ambiguous",
      });
      expect(ambiguous.status).toBe(409);
      expect(ambiguous.payload.code).toBe("DERIVATIVE_LINEAGE_AMBIGUOUS");
    });
  },
);
