import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { localGpuUploadBindingDigest } from "@ceo-agent/shared/server";
import { verifyLocalGpuRequest } from "../packages/agents/src/ai-story/local-gpu-signing";
import { LOCAL_GPU_V2_GOLDEN_VECTOR_PATH, buildLocalGpuV2GoldenVector } from "./fixtures/local-gpu-v2-golden-vector.cases";

/** Same bytes are pinned in ember-local-gpu-desktop and verified there with the real Desktop parser. */
const FIXTURE_SHA256 = "b3a9943907f1e99311ecc2c0d9ed0433cfa95b26a5baf8b76e7eae2aa5d39569";

describe("Contract V2 cross-repository golden vector", () => {
  const raw = readFileSync(LOCAL_GPU_V2_GOLDEN_VECTOR_PATH, "utf8");

  it("is reproduced byte for byte by the real Cloud builder and signer", () => {
    expect(createHash("sha256").update(raw, "utf8").digest("hex")).toBe(FIXTURE_SHA256);
    expect(`${JSON.stringify(buildLocalGpuV2GoldenVector(), null, 2)}\n`).toBe(raw);
  });

  it("binds every case to its canonical creative bytes, upload destination and signed token", () => {
    const vector = buildLocalGpuV2GoldenVector();
    expect(vector.cases.map((entry) => entry.name)).toEqual([
      "product-only-initial-material-first-frame",
      "character-only-no-first-frame",
      "mixed-predecessor-continuity-first-frame",
    ]);
    for (const entry of vector.cases) {
      expect(createHash("sha256").update(entry.canonicalCreativeJobUtf8, "utf8").digest("hex")).toBe(entry.creativeBinding);
      expect(localGpuUploadBindingDigest(entry.body.upload)).toBe(entry.uploadBinding);
      const claims = verifyLocalGpuRequest({
        secret: vector.testOnlySecret.utf8,
        token: entry.token,
        now: new Date(vector.syntheticAuthorization.now),
        workspaceId: entry.body.workspaceId,
        environment: "staging",
      });
      expect(claims.creativeBinding).toBe(entry.creativeBinding);
      expect(claims.uploadBinding).toBe(entry.uploadBinding);
      expect(entry.body.references.map((reference) => reference.order)).toEqual(entry.body.references.map((_, index) => index));
      const roles = entry.body.references.map((reference) => reference.role);
      expect(roles).toEqual([...roles].sort());
    }
    const [productOnly, , mixed] = vector.cases;
    expect(productOnly.body.creative.continuity?.sourceType).toBe("INITIAL_MATERIAL_REFERENCE");
    expect(productOnly.body.firstFrame?.assetUrl).toBe(productOnly.body.references[0].assetUrl);
    expect(mixed.body.creative.continuity?.sourceType).toBe("PREDECESSOR_CONTINUITY");
    expect(mixed.body.references.map((reference) => reference.role)).toEqual(["CHARACTER", "PRODUCT"]);
  });

  it("refuses unsupported or unproven authority before any Desktop request", () => {
    expect(buildLocalGpuV2GoldenVector().cloudRefusals).toEqual([
      { name: "initial-material-on-desktop-without-capability", expectedCloudError: "LOCAL_GPU_FIRST_FRAME_AUTHORITY_UNSUPPORTED" },
      { name: "first-frame-without-lineage-or-approved-reference", expectedCloudError: "LOCAL_GPU_CONTINUITY_AUTHORITY_REQUIRED" },
      { name: "product-without-variant", expectedCloudError: "LOCAL_GPU_PRODUCT_VARIANT_REQUIRED" },
    ]);
  });
});
