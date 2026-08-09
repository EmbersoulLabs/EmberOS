/**
 * Sprint 4 Phase A — boundary verification (always runs).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared/server";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("Sprint 4 Phase A boundaries", () => {
  it("does not add Billing / Stripe Phase B modules", () => {
    const forbidden = [
      "packages/agents/src/ai-story/billing-runtime.ts",
      "packages/agents/src/ai-story/stripe-runtime.ts",
      "packages/agents/src/ai-story/credits-runtime.ts",
      "packages/agents/src/ai-story/export-runtime.ts",
      "apps/worker/src/processors/ai-story-billing-handler.ts",
      "apps/worker/src/processors/ai-story-stripe-handler.ts",
      "apps/worker/src/processors/ai-story-credits-handler.ts",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
    expect(PHASE1_EXECUTION_LOCKED).toBeTruthy();
  });

  it("placeholder ffff binaryBuildHash is removed from production resolveProductionAssemblyEngineSnapshotHash path", () => {
    const provenance = read(
      "packages/agents/src/ai-story/assembly-engine-provenance.ts"
    );
    expect(provenance).toMatch(/export async function resolveProductionAssemblyEngineSnapshotHash/);
    expect(provenance).toMatch(/buildAssemblyEngineSnapshotHashFromProvenance/);
    expect(provenance).toMatch(/collectAssemblyEngineProvenance/);
    // Production resolver must not embed the placeholder ffff… hash.
    const resolveFn = provenance.slice(
      provenance.indexOf("export async function resolveProductionAssemblyEngineSnapshotHash")
    );
    expect(resolveFn).not.toMatch(
      /sha256:f{64}|ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff/
    );

    // Deprecated helper may remain for fixture tests only.
    const continuation = read(
      "packages/agents/src/ai-story/ai-story-runtime-continuation-coordinator.ts"
    );
    expect(continuation).toMatch(/@deprecated Placeholder ffff/);
    expect(continuation).toMatch(
      /export function buildProductionAssemblyEngineSnapshotHash/
    );
    expect(continuation).toMatch(
      /sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff/
    );
  });

  it("createHttpsProviderMediaAccessPort still exists for legacy; production worker cycle wires durable ports", () => {
    const media = read(
      "packages/agents/src/ai-story/assembly-runtime-media-access.ts"
    );
    expect(media).toMatch(/export function createHttpsProviderMediaAccessPort/);

    const cycle = read("apps/worker/src/ai-story-provider-worker-cycle.ts");
    expect(cycle).toMatch(/createDurableAssemblyArtifactBlobStore/);
    expect(cycle).toMatch(/createDurableAssemblyMediaAccessPort/);
    expect(cycle).toMatch(/DurableSceneMediaAttestationRepositoryImpl/);
    expect(cycle).not.toMatch(/createHttpsProviderMediaAccessPort/);
  });

  it("worker cycle source contains durableObjectStore / requireDurableSceneMedia / resolveProductionAssemblyEngineSnapshotHash", () => {
    const cycle = read("apps/worker/src/ai-story-provider-worker-cycle.ts");
    expect(cycle).toMatch(/durableObjectStore/);
    expect(cycle).toMatch(/requireDurableSceneMedia:\s*true/);
    expect(cycle).toMatch(/resolveProductionAssemblyEngineSnapshotHash/);
    expect(cycle).toMatch(/Sprint 4 Phase A/);
  });

  it("exports Phase A durable modules from package entrypoints", () => {
    expect(read("packages/shared/src/server.ts")).toContain(
      'export * from "./ai-story-durable-scene-media"'
    );
    expect(read("packages/shared/src/index.ts")).not.toContain(
      'export * from "./ai-story-durable-scene-media"'
    );
    const agentsIndex = read("packages/agents/src/ai-story/index.ts");
    expect(agentsIndex).toMatch(/durable-object-store/);
    expect(agentsIndex).toMatch(/provider-media-ingest/);
    expect(agentsIndex).toMatch(/assembly-engine-provenance/);
    expect(agentsIndex).toMatch(/durable-assembly-blob-store/);
    expect(agentsIndex).toMatch(/durable-assembly-media-access/);
    expect(read("packages/db/src/index.ts")).toContain(
      'export * from "./queries/ai-story-durable-scene-media"'
    );
  });
});
