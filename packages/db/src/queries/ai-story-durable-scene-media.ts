/**
 * Sprint 4 Phase A — Durable Scene Media Attestation persistence.
 *
 * Accept-or-converge only. No update()/delete(). Unique-violation races
 * converge in a fresh transaction (PR 3.6 / Final Story Result lesson).
 */
import { asc, eq } from "drizzle-orm";
import {
  DurableSceneMediaAttestationSchema,
  assertWorkspaceScopedDurableObjectKey,
  parseDurableSceneMediaAttestation,
  type DurableSceneMediaAttestation,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import {
  OwnershipIntegrityViolationError,
  assertExecutionPlanOwnershipChain,
  assertPlanOwnershipColumnsMatch,
  planOwnershipFromRow,
  type QueryDb,
} from "./ai-story-ownership";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type DurableSceneMediaPersistenceErrorCode =
  | "DURABLE_SCENE_MEDIA_IDENTITY_CONFLICT"
  | "DURABLE_SCENE_MEDIA_OWNERSHIP_INVALID"
  | "DURABLE_SCENE_MEDIA_NOT_FOUND";

export class DurableSceneMediaPersistenceError extends Error {
  readonly status: number;

  constructor(
    readonly code: DurableSceneMediaPersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DurableSceneMediaPersistenceError";
    this.status =
      code === "DURABLE_SCENE_MEDIA_OWNERSHIP_INVALID"
        ? 403
        : code === "DURABLE_SCENE_MEDIA_NOT_FOUND"
          ? 404
          : 409;
  }
}

export type AcceptOrConvergeDurableSceneMediaResult = {
  readonly attestation: DurableSceneMediaAttestation;
  readonly replayed: boolean;
};

export interface DurableSceneMediaAttestationRepository {
  getByMediaAttestationId(
    mediaAttestationId: string
  ): Promise<DurableSceneMediaAttestation | null>;
  getBySceneResultId(
    sceneResultId: string
  ): Promise<DurableSceneMediaAttestation | null>;
  listByExecutionPlanId(
    executionPlanId: string
  ): Promise<readonly DurableSceneMediaAttestation[]>;
  acceptOrConverge(
    attestation: DurableSceneMediaAttestation
  ): Promise<AcceptOrConvergeDurableSceneMediaResult>;
}

function toAttestation(
  row: typeof schema.aiStoryDurableSceneMediaAttestations.$inferSelect
): DurableSceneMediaAttestation {
  return parseDurableSceneMediaAttestation(row.attestation);
}

function equivalencePayload(attestation: DurableSceneMediaAttestation): unknown {
  return {
    mediaAttestationId: attestation.mediaAttestationId,
    orgId: attestation.orgId,
    workspaceId: attestation.workspaceId,
    campaignId: attestation.campaignId,
    storyId: attestation.storyId,
    storyVersionId: attestation.storyVersionId,
    animationPackageId: attestation.animationPackageId,
    executionPlanId: attestation.executionPlanId,
    sceneExecutionId: attestation.sceneExecutionId,
    sceneResultId: attestation.sceneResultId,
    sourceMediaReference: attestation.sourceMediaReference,
    durableObjectReference: attestation.durableObjectReference,
    contentHash: attestation.contentHash,
    byteSize: attestation.byteSize,
    mediaType: attestation.mediaType,
    ingestContractVersion: attestation.ingestContractVersion,
    storageProvider: attestation.storageProvider,
    storageNamespaceVersion: attestation.storageNamespaceVersion,
    integrityHash: attestation.integrityHash,
  };
}

function assertEquivalentAttestation(
  existing: DurableSceneMediaAttestation,
  requested: DurableSceneMediaAttestation
): void {
  if (
    existing.mediaAttestationId !== requested.mediaAttestationId ||
    existing.integrityHash !== requested.integrityHash ||
    canonicalPersistenceHash(equivalencePayload(existing)) !==
      canonicalPersistenceHash(equivalencePayload(requested))
  ) {
    throw new DurableSceneMediaPersistenceError(
      "DURABLE_SCENE_MEDIA_IDENTITY_CONFLICT",
      "Conflicting Durable Scene Media Attestation identity replay rejected"
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (code === "23505" || code === 23505) return true;
      const message = (current as { message?: unknown }).message;
      if (typeof message === "string" && /unique|duplicate/i.test(message)) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return false;
}

async function loadById(
  db: QueryDb,
  mediaAttestationId: string
): Promise<DurableSceneMediaAttestation | null> {
  const [row] = await db
    .select()
    .from(schema.aiStoryDurableSceneMediaAttestations)
    .where(
      eq(
        schema.aiStoryDurableSceneMediaAttestations.mediaAttestationId,
        mediaAttestationId
      )
    )
    .limit(1);
  return row ? toAttestation(row) : null;
}

async function loadBySceneResultId(
  db: QueryDb,
  sceneResultId: string
): Promise<DurableSceneMediaAttestation | null> {
  const [row] = await db
    .select()
    .from(schema.aiStoryDurableSceneMediaAttestations)
    .where(
      eq(schema.aiStoryDurableSceneMediaAttestations.sceneResultId, sceneResultId)
    )
    .limit(1);
  return row ? toAttestation(row) : null;
}

async function loadByObjectReference(
  db: QueryDb,
  durableObjectReference: string
): Promise<DurableSceneMediaAttestation | null> {
  const [row] = await db
    .select()
    .from(schema.aiStoryDurableSceneMediaAttestations)
    .where(
      eq(
        schema.aiStoryDurableSceneMediaAttestations.durableObjectReference,
        durableObjectReference
      )
    )
    .limit(1);
  return row ? toAttestation(row) : null;
}

async function validateOwnership(
  db: QueryDb,
  attestation: DurableSceneMediaAttestation
): Promise<void> {
  try {
    assertWorkspaceScopedDurableObjectKey(
      attestation.workspaceId,
      attestation.durableObjectReference
    );
  } catch (error) {
    throw new DurableSceneMediaPersistenceError(
      "DURABLE_SCENE_MEDIA_OWNERSHIP_INVALID",
      error instanceof Error ? error.message : String(error)
    );
  }

  const [plan] = await db
    .select()
    .from(schema.aiStoryExecutionPlans)
    .where(eq(schema.aiStoryExecutionPlans.id, attestation.executionPlanId))
    .limit(1);
  if (!plan) {
    throw new DurableSceneMediaPersistenceError(
      "DURABLE_SCENE_MEDIA_OWNERSHIP_INVALID",
      "Execution Plan not found for Durable Scene Media Attestation"
    );
  }

  await assertExecutionPlanOwnershipChain(plan, db);
  const expected = planOwnershipFromRow(plan);
  try {
    assertPlanOwnershipColumnsMatch(
      expected,
      {
        orgId: attestation.orgId,
        workspaceId: attestation.workspaceId,
        campaignId: attestation.campaignId,
        storyId: attestation.storyId,
        storyVersionId: attestation.storyVersionId,
        animationPackageId: attestation.animationPackageId,
        executionPlanId: attestation.executionPlanId,
      },
      "DurableSceneMediaAttestation"
    );
  } catch (error) {
    if (error instanceof OwnershipIntegrityViolationError) {
      throw new DurableSceneMediaPersistenceError(
        "DURABLE_SCENE_MEDIA_OWNERSHIP_INVALID",
        error.message
      );
    }
    throw error;
  }

  const [sceneResult] = await db
    .select()
    .from(schema.aiStorySceneResults)
    .where(eq(schema.aiStorySceneResults.sceneResultId, attestation.sceneResultId))
    .limit(1);
  if (!sceneResult) {
    throw new DurableSceneMediaPersistenceError(
      "DURABLE_SCENE_MEDIA_OWNERSHIP_INVALID",
      "Scene Result not found for Durable Scene Media Attestation"
    );
  }
  if (sceneResult.executionPlanId !== attestation.executionPlanId) {
    throw new DurableSceneMediaPersistenceError(
      "DURABLE_SCENE_MEDIA_OWNERSHIP_INVALID",
      "Scene Result Execution Plan does not match Durable Scene Media Attestation"
    );
  }
  if (sceneResult.sceneExecutionId !== attestation.sceneExecutionId) {
    throw new DurableSceneMediaPersistenceError(
      "DURABLE_SCENE_MEDIA_OWNERSHIP_INVALID",
      "Scene Result sceneExecutionId does not match Durable Scene Media Attestation"
    );
  }
  if (
    sceneResult.orgId !== attestation.orgId ||
    sceneResult.workspaceId !== attestation.workspaceId
  ) {
    throw new DurableSceneMediaPersistenceError(
      "DURABLE_SCENE_MEDIA_OWNERSHIP_INVALID",
      "Scene Result ownership does not match Durable Scene Media Attestation"
    );
  }
}

async function convergeExisting(
  tx: Tx,
  attestation: DurableSceneMediaAttestation
): Promise<AcceptOrConvergeDurableSceneMediaResult> {
  await validateOwnership(tx, attestation);

  const existing =
    (await loadById(tx, attestation.mediaAttestationId)) ??
    (await loadBySceneResultId(tx, attestation.sceneResultId)) ??
    (await loadByObjectReference(tx, attestation.durableObjectReference));
  if (!existing) {
    throw new DurableSceneMediaPersistenceError(
      "DURABLE_SCENE_MEDIA_IDENTITY_CONFLICT",
      "Durable Scene Media Attestation uniqueness race failed closed"
    );
  }
  assertEquivalentAttestation(existing, attestation);
  return { attestation: existing, replayed: true };
}

export class DurableSceneMediaAttestationRepositoryImpl
  implements DurableSceneMediaAttestationRepository
{
  constructor(private readonly db: Db = getDb()) {}

  async getByMediaAttestationId(
    mediaAttestationId: string
  ): Promise<DurableSceneMediaAttestation | null> {
    return loadById(this.db, mediaAttestationId);
  }

  async getBySceneResultId(
    sceneResultId: string
  ): Promise<DurableSceneMediaAttestation | null> {
    return loadBySceneResultId(this.db, sceneResultId);
  }

  async listByExecutionPlanId(
    executionPlanId: string
  ): Promise<readonly DurableSceneMediaAttestation[]> {
    const rows = await this.db
      .select()
      .from(schema.aiStoryDurableSceneMediaAttestations)
      .where(
        eq(
          schema.aiStoryDurableSceneMediaAttestations.executionPlanId,
          executionPlanId
        )
      )
      .orderBy(asc(schema.aiStoryDurableSceneMediaAttestations.acceptedAt));
    return rows.map(toAttestation);
  }

  async acceptOrConverge(
    input: DurableSceneMediaAttestation
  ): Promise<AcceptOrConvergeDurableSceneMediaResult> {
    const attestation = DurableSceneMediaAttestationSchema.parse(
      parseDurableSceneMediaAttestation(input)
    );

    try {
      return await this.db.transaction(async (tx) => {
        await validateOwnership(tx, attestation);

        const existingById = await loadById(tx, attestation.mediaAttestationId);
        if (existingById) {
          assertEquivalentAttestation(existingById, attestation);
          return { attestation: existingById, replayed: true };
        }

        const existingByScene = await loadBySceneResultId(
          tx,
          attestation.sceneResultId
        );
        if (existingByScene) {
          assertEquivalentAttestation(existingByScene, attestation);
          return { attestation: existingByScene, replayed: true };
        }

        const existingByObject = await loadByObjectReference(
          tx,
          attestation.durableObjectReference
        );
        if (existingByObject) {
          assertEquivalentAttestation(existingByObject, attestation);
          return { attestation: existingByObject, replayed: true };
        }

        await tx.insert(schema.aiStoryDurableSceneMediaAttestations).values({
          mediaAttestationId: attestation.mediaAttestationId,
          orgId: attestation.orgId,
          workspaceId: attestation.workspaceId,
          campaignId: attestation.campaignId,
          storyId: attestation.storyId,
          storyVersionId: attestation.storyVersionId,
          animationPackageId: attestation.animationPackageId,
          executionPlanId: attestation.executionPlanId,
          sceneExecutionId: attestation.sceneExecutionId,
          sceneResultId: attestation.sceneResultId,
          sourceMediaReference: attestation.sourceMediaReference,
          durableObjectReference: attestation.durableObjectReference,
          contentHash: attestation.contentHash,
          byteSize: attestation.byteSize,
          mediaType: attestation.mediaType,
          ingestContractVersion: attestation.ingestContractVersion,
          storageProvider: attestation.storageProvider,
          storageNamespaceVersion: attestation.storageNamespaceVersion,
          acceptedAt: new Date(attestation.acceptedAt),
          integrityHash: attestation.integrityHash,
          attestation,
        });
        return { attestation, replayed: false };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.db.transaction(async (tx) => convergeExisting(tx, attestation));
    }
  }
}

export function listDurableSceneMediaAttestationRepositoryMutators(): readonly string[] {
  return [
    "getByMediaAttestationId",
    "getBySceneResultId",
    "listByExecutionPlanId",
    "acceptOrConverge",
  ];
}
