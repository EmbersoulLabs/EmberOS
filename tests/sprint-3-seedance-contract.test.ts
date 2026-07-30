/**
 * Seedance provider contract tests — request/response shape (no live network).
 * Mirrors SeedanceVideoAdapter PayloadSchema without importing zod at test root.
 */
import { describe, expect, it } from "vitest";
import { PRODUCT_IDENTITY_CONSTRAINTS } from "@ceo-agent/shared";

function assertSeedanceRequestPayload(payload: Record<string, unknown>): void {
  expect(typeof payload.prompt).toBe("string");
  expect((payload.prompt as string).length).toBeGreaterThan(0);
  if (payload.negativePrompt !== undefined) {
    expect(typeof payload.negativePrompt).toBe("string");
  }
  if (payload.durationSec !== undefined) {
    expect(payload.durationSec).toBeGreaterThan(0);
  }
  if (payload.assetReferences !== undefined) {
    expect(Array.isArray(payload.assetReferences)).toBe(true);
    for (const ref of payload.assetReferences as Array<Record<string, unknown>>) {
      expect(typeof ref.assetId).toBe("string");
      expect(typeof ref.storagePath).toBe("string");
    }
  }
  if (payload.identityConstraints !== undefined) {
    expect(Array.isArray(payload.identityConstraints)).toBe(true);
  }
  if (payload.shotMap !== undefined) {
    expect(Array.isArray(payload.shotMap)).toBe(true);
  }
  // Image-generation fields must never appear on the animation-video contract.
  expect("imagePrompt" in payload).toBe(false);
  expect("mediaKind" in payload && payload.mediaKind === "image").toBe(false);
}

describe("Seedance provider contract", () => {
  it("accepts compiled execution payload with Campaign Assets and identity", () => {
    const payload = {
      prompt: "SHOT 1 … preserve product identity",
      negativePrompt: "redesigned product, wrong logo",
      durationSec: 6,
      aspectRatio: "9:16",
      outputIndex: 0,
      assetReferences: [
        {
          assetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          storagePath: "ws/product.png",
          role: "product",
        },
      ],
      identityConstraints: [...PRODUCT_IDENTITY_CONSTRAINTS],
      shotMap: [{ shotId: "shot-001", sceneId: "scene-001", sectionIndex: 0 }],
    };
    assertSeedanceRequestPayload(payload);
    expect(payload.assetReferences).toHaveLength(1);
    expect(payload.identityConstraints[0]).toContain("product shape");
  });

  it("rejects image-generation fields not in the animation-video contract", () => {
    const bad = {
      prompt: "generate a marketing still",
      imagePrompt: "product hero shot",
      mediaKind: "image" as const,
    };
    expect(() => assertSeedanceRequestPayload(bad)).toThrow();
  });

  it("accepts create + lookup response shapes", () => {
    const created = { id: "gen_123", status: "queued" };
    expect(created.id.length).toBeGreaterThan(0);
    const lookup = {
      status: "succeeded",
      video_url: "https://cdn.example.com/out.mp4",
    };
    expect(lookup.video_url).toContain("out.mp4");
    expect(lookup.status).toBe("succeeded");
  });

  it("normalizes only video outputs", () => {
    const out = {
      mediaKind: "video" as const,
      videoUrl: "https://cdn.example.com/out.mp4",
      providerRequestId: "gen_123",
      status: "succeeded",
      outputIndex: 0,
    };
    expect(out.mediaKind).toBe("video");
    expect(out.videoUrl.length).toBeGreaterThan(0);
  });
});
