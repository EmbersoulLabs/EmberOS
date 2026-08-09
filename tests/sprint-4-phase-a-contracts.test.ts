/**
 * Sprint 4 Phase A — durable scene media / object-store contract freezes.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DurableSceneMediaAttestationSchema,
  assertWorkspaceScopedDurableObjectKey,
  parseDurableSceneMediaAttestation,
  redactHttpsMediaUri,
} from "@ceo-agent/shared/server";
import {
  DurableObjectStoreError,
  ProviderMediaIngestError,
  buildAssemblyEngineSnapshotHashFromProvenance,
  buildDurableAssemblyArtifactObjectKey,
  buildDurableSceneMediaAttestation,
  buildDurableSceneMediaObjectKey,
  buildProductionAssemblyEngineSnapshotHash,
  createMemoryDurableObjectStore,
  hashBytesSha256,
  ingestProviderSceneMedia,
} from "../packages/agents/src/ai-story";

const OWNERSHIP = {
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  storyVersionId: "10000000-0000-4000-8000-000000000005",
  animationPackageId: "10000000-0000-4000-8000-000000000006",
  executionPlanId: "10000000-0000-4000-8000-000000000010",
} as const;

const SCENE_EXECUTION_ID = "10000000-0000-4000-8000-000000000020";
const SCENE_RESULT_ID = "10000000-0000-4000-8000-000000000030";
const CONTENT_HASH =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const ROOT = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeAttestation(
  overrides: Partial<ReturnType<typeof buildDurableSceneMediaAttestation>> = {}
) {
  const durableObjectReference =
    overrides.durableObjectReference ??
    buildDurableSceneMediaObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXECUTION_ID,
      contentHash: CONTENT_HASH,
    });
  const base = buildDurableSceneMediaAttestation({
    ownership: OWNERSHIP,
    sceneExecutionId: SCENE_EXECUTION_ID,
    sceneResultId: SCENE_RESULT_ID,
    sourceHttpsUri:
      "https://cdn.example.com/media/clip.mp4?token=secret&sig=abc",
    durableObjectReference,
    contentHash: CONTENT_HASH,
    byteSize: 1024,
    acceptedAt: "2026-08-10T00:00:00.000Z",
  });
  return { ...base, ...overrides };
}

function collectSources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSources(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("Sprint 4 Phase A contracts", () => {
  it("parses DurableSceneMediaAttestation schema", () => {
    const attestation = makeAttestation();
    expect(DurableSceneMediaAttestationSchema.parse(attestation).mediaAttestationId).toBe(
      attestation.mediaAttestationId
    );
    expect(parseDurableSceneMediaAttestation(attestation).contentHash).toBe(CONTENT_HASH);
    expect(() =>
      parseDurableSceneMediaAttestation({
        ...attestation,
        mediaType: "image/png",
      })
    ).toThrow();
  });

  it("redactHttpsMediaUri strips query tokens", () => {
    expect(
      redactHttpsMediaUri(
        "https://cdn.example.com:443/path/clip.mp4?token=secret&Expires=1#frag"
      )
    ).toEqual({
      scheme: "https",
      host: "cdn.example.com",
      path: "/path/clip.mp4",
    });
  });

  it("object key builders enforce workspace prefix and reject traversal", () => {
    const sceneKey = buildDurableSceneMediaObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXECUTION_ID,
      contentHash: CONTENT_HASH,
    });
    expect(sceneKey).toBe(
      `${OWNERSHIP.workspaceId}/ai-story/scenes/${OWNERSHIP.executionPlanId}/${SCENE_EXECUTION_ID}/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp4`
    );
    const assemblyKey = buildDurableAssemblyArtifactObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      assemblyJobId: "10000000-0000-4000-8000-000000000040",
      contentHash: CONTENT_HASH,
    });
    expect(assemblyKey.startsWith(`${OWNERSHIP.workspaceId}/ai-story/assembly/`)).toBe(
      true
    );
    expect(() =>
      assertWorkspaceScopedDurableObjectKey(OWNERSHIP.workspaceId, `${OWNERSHIP.workspaceId}/../escape.mp4`)
    ).toThrow(/path traversal/);
    expect(() =>
      assertWorkspaceScopedDurableObjectKey(
        OWNERSHIP.workspaceId,
        "other-workspace/ai-story/scenes/x.mp4"
      )
    ).toThrow(/workspace-prefixed/);
  });

  it("assertWorkspaceScopedDurableObjectKey denies URLs and absolute paths", () => {
    expect(() =>
      assertWorkspaceScopedDurableObjectKey(
        OWNERSHIP.workspaceId,
        "https://cdn.example.com/obj.mp4"
      )
    ).toThrow(/must not be a URL/);
    expect(() =>
      assertWorkspaceScopedDurableObjectKey(OWNERSHIP.workspaceId, "file:///tmp/x.mp4")
    ).toThrow(/must not be a URL/);
    expect(() =>
      assertWorkspaceScopedDurableObjectKey(OWNERSHIP.workspaceId, "/tmp/x.mp4")
    ).toThrow(/absolute filesystem path/);
  });

  it("memory durable store: put, re-read hash, conflict on different bytes same key", async () => {
    const store = createMemoryDurableObjectStore();
    const dir = await tempDir("ember-s4a-mem-");
    const pathA = join(dir, "a.mp4");
    const pathB = join(dir, "b.mp4");
    await writeFile(pathA, Buffer.from("scene-bytes-a"));
    await writeFile(pathB, Buffer.from("scene-bytes-b-different"));
    const hashA = await hashBytesSha256(Buffer.from("scene-bytes-a"));
    const hashB = await hashBytesSha256(Buffer.from("scene-bytes-b-different"));
    const objectKey = buildDurableSceneMediaObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXECUTION_ID,
      contentHash: hashA,
    });

    await store.putImmutableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      localPath: pathA,
      contentHash: hashA,
      mediaType: "video/mp4",
      byteSize: Buffer.byteLength("scene-bytes-a"),
    });
    await store.assertReadableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      expectedContentHash: hashA,
    });

    await expect(
      store.putImmutableObject({
        workspaceId: OWNERSHIP.workspaceId,
        objectKey,
        localPath: pathB,
        contentHash: hashB,
        mediaType: "video/mp4",
        byteSize: Buffer.byteLength("scene-bytes-b-different"),
      })
    ).rejects.toMatchObject({
      code: "DURABLE_OBJECT_CONFLICT",
    } satisfies Partial<DurableObjectStoreError>);
  });

  it("memory durable store: same bytes converge without duplicate put", async () => {
    const store = createMemoryDurableObjectStore();
    const dir = await tempDir("ember-s4a-conv-");
    const path = join(dir, "same.mp4");
    const bytes = Buffer.from("identical-scene-bytes");
    await writeFile(path, bytes);
    const hash = await hashBytesSha256(bytes);
    const objectKey = buildDurableSceneMediaObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXECUTION_ID,
      contentHash: hash,
    });
    const input = {
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      localPath: path,
      contentHash: hash,
      mediaType: "video/mp4",
      byteSize: bytes.length,
    };
    await store.putImmutableObject(input);
    await store.putImmutableObject(input);
    expect(store.putCount.value).toBe(1);
    expect(store.objects.size).toBe(1);
  });

  it("denies non-https URI schemes for source media", async () => {
    expect(() => redactHttpsMediaUri("file:///tmp/clip.mp4")).toThrow(/must use https/);
    expect(() => redactHttpsMediaUri("http://cdn.example.com/clip.mp4")).toThrow(
      /must use https/
    );

    const store = createMemoryDurableObjectStore();
    await expect(
      ingestProviderSceneMedia({
        ingest: {
          ownership: OWNERSHIP,
          sceneExecutionId: SCENE_EXECUTION_ID,
          sceneResultId: SCENE_RESULT_ID,
          sourceHttpsUri: "file:///tmp/clip.mp4",
        },
        store,
        repository: {
          acceptOrConverge: async (attestation) => ({
            attestation,
            replayed: false,
          }),
          getBySceneResultId: async () => null,
          listByExecutionPlanId: async () => [],
        },
      })
    ).rejects.toMatchObject({
      code: "INGEST_URI_SCHEME_DENIED",
    } satisfies Partial<ProviderMediaIngestError>);

    await expect(
      ingestProviderSceneMedia({
        ingest: {
          ownership: OWNERSHIP,
          sceneExecutionId: SCENE_EXECUTION_ID,
          sceneResultId: SCENE_RESULT_ID,
          sourceHttpsUri: "http://cdn.example.com/clip.mp4",
        },
        store,
        repository: {
          acceptOrConverge: async (attestation) => ({
            attestation,
            replayed: false,
          }),
          getBySceneResultId: async () => null,
          listByExecutionPlanId: async () => [],
        },
      })
    ).rejects.toMatchObject({
      code: "INGEST_URI_SCHEME_DENIED",
    } satisfies Partial<ProviderMediaIngestError>);
  });

  it("buildDurableSceneMediaAttestation is deterministic for identity", () => {
    const a = buildDurableSceneMediaAttestation({
      ownership: OWNERSHIP,
      sceneExecutionId: SCENE_EXECUTION_ID,
      sceneResultId: SCENE_RESULT_ID,
      sourceHttpsUri: "https://cdn.example.com/a.mp4?token=one",
      durableObjectReference: `${OWNERSHIP.workspaceId}/ai-story/scenes/x.mp4`,
      contentHash: CONTENT_HASH,
      byteSize: 10,
      acceptedAt: "2026-08-10T00:00:00.000Z",
    });
    const b = buildDurableSceneMediaAttestation({
      ownership: OWNERSHIP,
      sceneExecutionId: SCENE_EXECUTION_ID,
      sceneResultId: SCENE_RESULT_ID,
      sourceHttpsUri: "https://cdn.example.com/a.mp4?token=two",
      durableObjectReference: `${OWNERSHIP.workspaceId}/ai-story/scenes/x.mp4`,
      contentHash: CONTENT_HASH,
      byteSize: 10,
      acceptedAt: "2026-08-10T00:00:00.000Z",
    });
    expect(a.mediaAttestationId).toBe(b.mediaAttestationId);
    expect(a.integrityHash).toBe(b.integrityHash);
    expect(a.sourceMediaReference.path).toBe("/a.mp4");
    expect(a.sourceMediaReference).not.toHaveProperty("query");
  });

  it("provenance hash differs from placeholder ffff buildProductionAssemblyEngineSnapshotHash", () => {
    const placeholder = buildProductionAssemblyEngineSnapshotHash();
    const fromProvenance = buildAssemblyEngineSnapshotHashFromProvenance({
      ffmpegPath: "ffmpeg",
      ffmpegVersionText: "ffmpeg version 8.1.1 Copyright",
      ffmpegVersion: "8.1.1",
      ffmpegBinaryHash: `sha256:${"c".repeat(64)}`,
      workerBuildSha: "deadbeef",
    });
    expect(fromProvenance).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(fromProvenance).not.toBe(placeholder);
    expect(placeholder).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("boundary: no billing/stripe/credits/export-runtime modules added for Phase A", () => {
    const forbidden = [
      "packages/agents/src/ai-story/export-runtime.ts",
      "packages/agents/src/ai-story/billing-runtime.ts",
      "packages/agents/src/ai-story/stripe-runtime.ts",
      "packages/agents/src/ai-story/credits-runtime.ts",
      "apps/worker/src/processors/ai-story-billing-handler.ts",
      "apps/worker/src/processors/ai-story-stripe-handler.ts",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
    const phaseASources = [
      "packages/shared/src/ai-story-durable-scene-media.ts",
      "packages/agents/src/ai-story/durable-object-store.ts",
      "packages/agents/src/ai-story/provider-media-ingest.ts",
      "packages/agents/src/ai-story/assembly-engine-provenance.ts",
      "packages/db/src/queries/ai-story-durable-scene-media.ts",
    ]
      .map((path) => readFileSync(join(ROOT, path), "utf8"))
      .join("\n");
    expect(phaseASources).not.toMatch(/\bstripe\b/i);
    expect(phaseASources).not.toMatch(/\bbilling\b/i);
    expect(phaseASources).not.toMatch(/\bcredits?\b/i);
    expect(phaseASources).not.toMatch(/export-runtime/);
    // Ensure new Phase A modules exist
    expect(
      collectSources(join(ROOT, "packages/agents/src/ai-story")).some((p) =>
        p.replace(/\\/g, "/").endsWith("/durable-object-store.ts")
      )
    ).toBe(true);
  });
});
