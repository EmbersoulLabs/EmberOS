/**
 * Sprint 4 Phase A — local durable object store + ffmpeg fixture integration.
 * Skips when ffmpeg is unavailable.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DurableSceneMediaAttestation } from "@ceo-agent/shared/server";
import {
  buildDurableAssemblyArtifactObjectKey,
  buildDurableSceneMediaObjectKey,
  createDurableAssemblyArtifactBlobStore,
  createDurableAssemblyMediaAccessPort,
  createLocalDurableObjectStore,
  createMemoryDurableObjectStore,
  hashFileSha256Stream,
  ingestProviderSceneMedia,
  type DurableObjectStore,
} from "../packages/agents/src/ai-story";
import { generateFixtureClip } from "./helpers/ai-story-pr37-phase-c-e2e";

function ffmpegAvailable(): boolean {
  try {
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

const describeMedia = ffmpegAvailable() ? describe : describe.skip;

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
const ASSEMBLY_JOB_ID = "10000000-0000-4000-8000-000000000040";

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

describeMedia("Sprint 4 Phase A storage/ffmpeg durable objects", () => {
  it("putImmutableObject + assertReadableObject for local store", async () => {
    const root = await tempDir("ember-s4a-local-");
    const work = await tempDir("ember-s4a-work-");
    const store = createLocalDurableObjectStore(root);
    const clip = await generateFixtureClip(work, "scene.mp4", {
      seconds: 1,
      color: "blue",
    });
    const objectKey = buildDurableSceneMediaObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXECUTION_ID,
      contentHash: clip.hash,
    });
    const byteSize = (await readFile(clip.path)).length;
    await store.putImmutableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      localPath: clip.path,
      contentHash: clip.hash,
      mediaType: "video/mp4",
      byteSize,
    });
    await store.assertReadableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      expectedContentHash: clip.hash,
    });
  });

  it("download after deleting original local file succeeds", async () => {
    const root = await tempDir("ember-s4a-dl-");
    const work = await tempDir("ember-s4a-dl-work-");
    const store = createLocalDurableObjectStore(root);
    const clip = await generateFixtureClip(work, "source.mp4", {
      seconds: 1,
      color: "green",
    });
    const objectKey = buildDurableSceneMediaObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXECUTION_ID,
      contentHash: clip.hash,
    });
    const byteSize = (await readFile(clip.path)).length;
    await store.putImmutableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      localPath: clip.path,
      contentHash: clip.hash,
      mediaType: "video/mp4",
      byteSize,
    });
    await rm(clip.path, { force: true });
    expect(existsSync(clip.path)).toBe(false);

    const dest = join(work, "recovered.mp4");
    await store.downloadObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      destinationPath: dest,
    });
    expect(await hashFileSha256Stream(dest)).toBe(clip.hash);
  });

  it("temp cleanup: delete work tmp after put; object still readable", async () => {
    const root = await tempDir("ember-s4a-tmp-");
    const work = await tempDir("ember-s4a-tmp-work-");
    const store = createLocalDurableObjectStore(root);
    const clip = await generateFixtureClip(work, "tmp-scene.mp4", {
      seconds: 1,
      color: "red",
    });
    const objectKey = buildDurableSceneMediaObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXECUTION_ID,
      contentHash: clip.hash,
    });
    const byteSize = (await readFile(clip.path)).length;
    await store.putImmutableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      localPath: clip.path,
      contentHash: clip.hash,
      mediaType: "video/mp4",
      byteSize,
    });
    await rm(work, { recursive: true, force: true });
    expect(existsSync(work)).toBe(false);
    await store.assertReadableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      expectedContentHash: clip.hash,
    });
  });

  it("createDurableAssemblyArtifactBlobStore: put, assertReadable, recover without re-encode", async () => {
    const root = await tempDir("ember-s4a-art-");
    const work = await tempDir("ember-s4a-art-work-");
    const store = createLocalDurableObjectStore(root);
    const blobStore = createDurableAssemblyArtifactBlobStore(store);
    const clip = await generateFixtureClip(work, "assembly-out.mp4", {
      seconds: 1,
      color: "yellow",
    });
    const { artifactReference } = await blobStore.putImmutableArtifact({
      ownership: OWNERSHIP,
      assemblyJobId: ASSEMBLY_JOB_ID,
      artifactId: "10000000-0000-4000-8000-000000000050",
      localPath: clip.path,
      contentHash: clip.hash,
    });
    expect(artifactReference).toBe(
      buildDurableAssemblyArtifactObjectKey({
        workspaceId: OWNERSHIP.workspaceId,
        executionPlanId: OWNERSHIP.executionPlanId,
        assemblyJobId: ASSEMBLY_JOB_ID,
        contentHash: clip.hash,
      })
    );
    await blobStore.assertReadableArtifact({
      ownership: OWNERSHIP,
      artifactReference,
      expectedContentHash: clip.hash,
    });
    await rm(clip.path, { force: true });
    await blobStore.assertReadableArtifact({
      ownership: OWNERSHIP,
      artifactReference,
      expectedContentHash: clip.hash,
    });
    const recovered = join(work, "artifact-recovered.mp4");
    await store.downloadObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey: artifactReference,
      destinationPath: recovered,
    });
    expect(await hashFileSha256Stream(recovered)).toBe(clip.hash);
  });

  it("createDurableAssemblyMediaAccessPort resolves from store", async () => {
    const root = await tempDir("ember-s4a-media-");
    const work = await tempDir("ember-s4a-media-work-");
    const store = createLocalDurableObjectStore(root);
    const clip = await generateFixtureClip(work, "scene-media.mp4", {
      seconds: 1,
      color: "purple",
    });
    const objectKey = buildDurableSceneMediaObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXECUTION_ID,
      contentHash: clip.hash,
    });
    const byteSize = (await readFile(clip.path)).length;
    await store.putImmutableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      localPath: clip.path,
      contentHash: clip.hash,
      mediaType: "video/mp4",
      byteSize,
    });
    const attestation = {
      workspaceId: OWNERSHIP.workspaceId,
      orgId: OWNERSHIP.orgId,
      executionPlanId: OWNERSHIP.executionPlanId,
      durableObjectReference: objectKey,
      contentHash: clip.hash,
      sceneResultId: SCENE_RESULT_ID,
    };
    const port = createDurableAssemblyMediaAccessPort({
      store,
      attestations: {
        getBySceneResultId: async (id) =>
          id === SCENE_RESULT_ID
            ? (attestation as never)
            : null,
      },
    });
    const resolved = await port.resolveToLocalPath({
      ownership: OWNERSHIP,
      workDir: join(work, "resolve"),
      scene: {
        sceneResultId: SCENE_RESULT_ID,
        sceneExecutionId: SCENE_EXECUTION_ID,
        sceneId: "scene-a",
        sceneOrder: 0,
        contentHash: clip.hash,
        durationMs: 1000,
        mediaReference: {
          uri: objectKey,
          contentHash: clip.hash,
          mediaType: "video/mp4",
        },
      },
    });
    expect(resolved.contentHash).toBe(clip.hash);
    expect(existsSync(resolved.localPath)).toBe(true);
  });

  it("cross-worker simulation: Store A writes scene; Store B assembles into assembly key", async () => {
    const sharedRoot = await tempDir("ember-s4a-xworker-");
    const workA = await tempDir("ember-s4a-xworker-a-");
    const workB = await tempDir("ember-s4a-xworker-b-");
    const storeA = createLocalDurableObjectStore(sharedRoot);
    const storeB = createLocalDurableObjectStore(sharedRoot);
    const clip = await generateFixtureClip(workA, "worker-a-scene.mp4", {
      seconds: 1,
      color: "orange",
    });
    const sceneKey = buildDurableSceneMediaObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      sceneExecutionId: SCENE_EXECUTION_ID,
      contentHash: clip.hash,
    });
    const byteSize = (await readFile(clip.path)).length;
    await storeA.putImmutableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey: sceneKey,
      localPath: clip.path,
      contentHash: clip.hash,
      mediaType: "video/mp4",
      byteSize,
    });
    await rm(workA, { recursive: true, force: true });
    expect(existsSync(workA)).toBe(false);

    const stage = join(workB, "stage-scene.mp4");
    await storeB.downloadObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey: sceneKey,
      destinationPath: stage,
    });
    const assemblyKey = buildDurableAssemblyArtifactObjectKey({
      workspaceId: OWNERSHIP.workspaceId,
      executionPlanId: OWNERSHIP.executionPlanId,
      assemblyJobId: ASSEMBLY_JOB_ID,
      contentHash: clip.hash,
    });
    await storeB.putImmutableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey: assemblyKey,
      localPath: stage,
      contentHash: clip.hash,
      mediaType: "video/mp4",
      byteSize,
    });
    await rm(workB, { recursive: true, force: true });
    expect(existsSync(workB)).toBe(false);
    await storeA.assertReadableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey: assemblyKey,
      expectedContentHash: clip.hash,
    });
  });

  it("provider URL unavailable after ingest: second assembly resolve uses durable store only", async () => {
    const root = await tempDir("ember-s4a-ingest-");
    const work = await tempDir("ember-s4a-ingest-work-");
    const store: DurableObjectStore = createLocalDurableObjectStore(root);
    const clip = await generateFixtureClip(work, "provider-clip.mp4", {
      seconds: 1,
      color: "cyan",
    });
    const bytes = await readFile(clip.path);
    let fetchCount = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCount += 1;
      if (fetchCount > 1) {
        throw new Error("Provider URL unavailable");
      }
      return new Response(bytes, {
        status: 200,
        headers: { "content-type": "video/mp4" },
      });
    };

    const repository = {
      rows: new Map<string, DurableSceneMediaAttestation>(),
      async getBySceneResultId(sceneResultId: string) {
        return this.rows.get(sceneResultId) ?? null;
      },
      async listByExecutionPlanId(executionPlanId: string) {
        return [...this.rows.values()].filter(
          (row) => row.executionPlanId === executionPlanId
        );
      },
      async acceptOrConverge(attestation: DurableSceneMediaAttestation) {
        this.rows.set(attestation.sceneResultId, attestation);
        return { attestation, replayed: false };
      },
    };

    const ingested = await ingestProviderSceneMedia({
      ingest: {
        ownership: OWNERSHIP,
        sceneExecutionId: SCENE_EXECUTION_ID,
        sceneResultId: SCENE_RESULT_ID,
        sourceHttpsUri:
          "https://provider.example.com/clips/scene.mp4?token=ephemeral",
        fetchImpl,
        now: () => new Date("2026-08-10T12:00:00.000Z"),
      },
      store,
      repository,
    });
    expect(ingested.downloaded).toBe(true);
    expect(fetchCount).toBe(1);

    await rm(clip.path, { force: true });

    const port = createDurableAssemblyMediaAccessPort({
      store,
      attestations: repository,
    });
    const resolved = await port.resolveToLocalPath({
      ownership: OWNERSHIP,
      workDir: join(work, "assembly-resolve"),
      scene: {
        sceneResultId: SCENE_RESULT_ID,
        sceneExecutionId: SCENE_EXECUTION_ID,
        sceneId: "scene-a",
        sceneOrder: 0,
        contentHash: ingested.attestation.contentHash,
        durationMs: 1000,
        mediaReference: {
          uri: ingested.attestation.durableObjectReference,
          contentHash: ingested.attestation.contentHash,
          mediaType: "video/mp4",
        },
      },
    });
    expect(resolved.contentHash).toBe(ingested.attestation.contentHash);
    expect(fetchCount).toBe(1);

    // Provider fetch must fail if attempted again — durable path never calls it.
    await expect(fetchImpl("https://provider.example.com/clips/scene.mp4")).rejects.toThrow(
      /unavailable/
    );
    expect(fetchCount).toBe(2);
  });
});

describe("Sprint 4 Phase A memory store smoke (no ffmpeg)", () => {
  it("memory store putCount stays available for unit callers", async () => {
    const store = createMemoryDurableObjectStore();
    const dir = await tempDir("ember-s4a-mem-smoke-");
    const path = join(dir, "x.bin");
    await writeFile(path, Buffer.from("x"));
    const hash = await hashFileSha256Stream(path);
    const objectKey = `${OWNERSHIP.workspaceId}/ai-story/scenes/smoke.mp4`;
    await store.putImmutableObject({
      workspaceId: OWNERSHIP.workspaceId,
      objectKey,
      localPath: path,
      contentHash: hash,
      mediaType: "video/mp4",
      byteSize: 1,
    });
    expect(store.putCount.value).toBe(1);
  });
});
