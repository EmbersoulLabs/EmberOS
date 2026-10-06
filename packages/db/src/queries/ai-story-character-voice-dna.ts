import { and, eq, inArray, sql } from "drizzle-orm";
import {
  AiStoryCharacterVoiceDnaError,
  AiStoryCharacterVoiceDnaSchema,
  assertVoiceDnaMatchesCharacterVersion,
  type AiStoryCharacterVoiceDna,
} from "@ceo-agent/shared";
import { recomputeAiStoryCharacterVoiceDnaFingerprint } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import {
  AiStoryReusableCharacterError,
  AiStoryReusableCharacterService,
  type AiStoryReusableCharacterScope,
} from "./ai-story-reusable-character";

type Db = ReturnType<typeof getDb>;
type VoiceDnaRow = typeof schema.aiStoryCharacterVoiceDnaAuthorities.$inferSelect;

const CURRENT_STATUSES = ["APPROVED", "FROZEN"] as const;

export class AiStoryCharacterVoiceDnaPersistenceError extends Error {
  readonly code:
    | "VOICE_DNA_NOT_FOUND"
    | "VOICE_DNA_FINGERPRINT_MISMATCH"
    | "VOICE_DNA_SCOPE_MISMATCH"
    | "VOICE_DNA_CURRENT_AMBIGUOUS"
    | "VOICE_DNA_SUPERSESSION_REQUIRED"
    | "VOICE_DNA_IMMUTABLE_CONFLICT"
    | "VOICE_DNA_WORKSPACE_SCOPE_GATE";

  constructor(code: AiStoryCharacterVoiceDnaPersistenceError["code"], message: string) {
    super(message);
    this.name = "AiStoryCharacterVoiceDnaPersistenceError";
    this.code = code;
  }
}

export type VoiceDnaCharacterVersionRef = {
  reusableCharacterId: string;
  reusableCharacterVersionId: string;
};

async function assertWorkspaceScope(db: Pick<Db, "execute">, scope: AiStoryReusableCharacterScope, mutation: boolean) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from workspaces w where w.id=${scope.workspaceId}::uuid and w.org_id=${scope.orgId}::uuid
      and exists(
        select 1 from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid
          and wm.user_id=${scope.actorUserId}::uuid
          and (${mutation}=false or wm.role in ('admin','operator'))
      )
  ) as ok`);
  if (!rows[0]?.ok) {
    throw new AiStoryCharacterVoiceDnaPersistenceError(
      "VOICE_DNA_WORKSPACE_SCOPE_GATE",
      "Voice DNA Workspace authority does not resolve"
    );
  }
}

function verifyStoredAuthority(row: VoiceDnaRow, scope: AiStoryReusableCharacterScope): AiStoryCharacterVoiceDna {
  if (row.orgId !== scope.orgId || row.workspaceId !== scope.workspaceId) {
    throw new AiStoryCharacterVoiceDnaPersistenceError(
      "VOICE_DNA_SCOPE_MISMATCH",
      "Voice DNA authority is outside this Workspace"
    );
  }
  const parsed = AiStoryCharacterVoiceDnaSchema.safeParse(row.snapshot);
  if (!parsed.success) {
    throw new AiStoryCharacterVoiceDnaPersistenceError(
      "VOICE_DNA_FINGERPRINT_MISMATCH",
      "Stored Voice DNA snapshot failed authority verification"
    );
  }
  const authority = parsed.data;
  const recomputed = recomputeAiStoryCharacterVoiceDnaFingerprint(authority);
  if (
    row.voiceDnaId !== authority.voiceDnaId ||
    row.voiceDnaFingerprint !== authority.voiceDnaFingerprint ||
    authority.voiceDnaFingerprint !== recomputed ||
    row.orgId !== authority.orgId ||
    row.workspaceId !== authority.workspaceId ||
    row.reusableCharacterId !== authority.reusableCharacterId ||
    row.reusableCharacterVersionId !== authority.reusableCharacterVersionId ||
    row.characterIdentityFingerprint !== authority.characterIdentityFingerprint ||
    row.contractVersion !== authority.contractVersion ||
    row.status !== authority.status
  ) {
    throw new AiStoryCharacterVoiceDnaPersistenceError(
      "VOICE_DNA_FINGERPRINT_MISMATCH",
      "Stored Voice DNA fingerprint does not match the authority snapshot"
    );
  }
  return authority;
}

async function loadVerified(
  db: Pick<Db, "select">,
  scope: AiStoryReusableCharacterScope,
  voiceDnaId: string
): Promise<AiStoryCharacterVoiceDna> {
  const rows = await db.select().from(schema.aiStoryCharacterVoiceDnaAuthorities).where(and(
    eq(schema.aiStoryCharacterVoiceDnaAuthorities.voiceDnaId, voiceDnaId),
    eq(schema.aiStoryCharacterVoiceDnaAuthorities.orgId, scope.orgId),
    eq(schema.aiStoryCharacterVoiceDnaAuthorities.workspaceId, scope.workspaceId),
  )).limit(1);
  const row = rows[0];
  if (!row) {
    throw new AiStoryCharacterVoiceDnaPersistenceError(
      "VOICE_DNA_NOT_FOUND",
      "Voice DNA authority was not found in this Workspace"
    );
  }
  return verifyStoredAuthority(row, scope);
}

function currentAuthorities(rows: VoiceDnaRow[], scope: AiStoryReusableCharacterScope): AiStoryCharacterVoiceDna[] {
  const verified = rows.map((row) => verifyStoredAuthority(row, scope));
  const superseded = new Set(
    rows.flatMap((row) => (row.supersedesVoiceDnaId ? [row.supersedesVoiceDnaId] : []))
  );
  return verified.filter((authority) => !superseded.has(authority.voiceDnaId));
}

export class AiStoryCharacterVoiceDnaService {
  constructor(private readonly db: Db = getDb()) {}

  async createAuthority(
    scope: AiStoryReusableCharacterScope,
    authority: AiStoryCharacterVoiceDna,
    options: { supersedesVoiceDnaId?: string | null } = {}
  ): Promise<AiStoryCharacterVoiceDna> {
    await assertWorkspaceScope(this.db, scope, true);
    const parsed = AiStoryCharacterVoiceDnaSchema.safeParse(authority);
    if (!parsed.success) {
      throw new AiStoryCharacterVoiceDnaError("VOICE_DNA_INVALID", "Voice DNA authority failed validation");
    }
    const candidate = parsed.data;
    if (candidate.orgId !== scope.orgId || candidate.workspaceId !== scope.workspaceId) {
      throw new AiStoryCharacterVoiceDnaPersistenceError(
        "VOICE_DNA_SCOPE_MISMATCH",
        "Voice DNA authority is outside this Workspace"
      );
    }
    if (recomputeAiStoryCharacterVoiceDnaFingerprint(candidate) !== candidate.voiceDnaFingerprint) {
      throw new AiStoryCharacterVoiceDnaPersistenceError(
        "VOICE_DNA_FINGERPRINT_MISMATCH",
        "Voice DNA fingerprint does not match the authority snapshot"
      );
    }
    let version;
    try {
      version = await new AiStoryReusableCharacterService(this.db).readVersion(
        scope,
        candidate.reusableCharacterVersionId
      );
    } catch (error) {
      if (error instanceof AiStoryReusableCharacterError && error.code === "REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE") {
        throw error;
      }
      throw new AiStoryCharacterVoiceDnaError(
        "VOICE_DNA_CHARACTER_VERSION_MISMATCH",
        "Voice DNA is pinned to a different Reusable Character version"
      );
    }
    if (version.orgId !== scope.orgId || version.workspaceId !== scope.workspaceId) {
      throw new AiStoryCharacterVoiceDnaError(
        "VOICE_DNA_CHARACTER_VERSION_MISMATCH",
        "Voice DNA is pinned to a different Reusable Character version"
      );
    }
    assertVoiceDnaMatchesCharacterVersion(candidate, version);

    const supersedesVoiceDnaId = options.supersedesVoiceDnaId ?? null;
    return this.db.transaction(async (tx) => {
      const existingRows = await tx.select().from(schema.aiStoryCharacterVoiceDnaAuthorities).where(and(
        eq(schema.aiStoryCharacterVoiceDnaAuthorities.voiceDnaId, candidate.voiceDnaId),
      )).limit(1);
      const existing = existingRows[0];
      if (existing) {
        if (existing.orgId !== scope.orgId || existing.workspaceId !== scope.workspaceId) {
          throw new AiStoryCharacterVoiceDnaPersistenceError(
            "VOICE_DNA_SCOPE_MISMATCH",
            "Voice DNA authority is outside this Workspace"
          );
        }
        const stored = verifyStoredAuthority(existing, scope);
        if (
          stored.voiceDnaFingerprint === candidate.voiceDnaFingerprint &&
          stored.reusableCharacterId === candidate.reusableCharacterId &&
          stored.reusableCharacterVersionId === candidate.reusableCharacterVersionId &&
          stored.characterIdentityFingerprint === candidate.characterIdentityFingerprint
        ) {
          return stored;
        }
        throw new AiStoryCharacterVoiceDnaPersistenceError(
          "VOICE_DNA_IMMUTABLE_CONFLICT",
          "An existing Voice DNA authority cannot be replaced"
        );
      }

      const peers = await tx.select().from(schema.aiStoryCharacterVoiceDnaAuthorities).where(and(
        eq(schema.aiStoryCharacterVoiceDnaAuthorities.orgId, scope.orgId),
        eq(schema.aiStoryCharacterVoiceDnaAuthorities.workspaceId, scope.workspaceId),
        eq(schema.aiStoryCharacterVoiceDnaAuthorities.reusableCharacterId, candidate.reusableCharacterId),
        eq(schema.aiStoryCharacterVoiceDnaAuthorities.reusableCharacterVersionId, candidate.reusableCharacterVersionId),
        inArray(schema.aiStoryCharacterVoiceDnaAuthorities.status, [...CURRENT_STATUSES]),
      ));
      const currents = currentAuthorities(peers, scope);
      if (currents.length > 1) {
        throw new AiStoryCharacterVoiceDnaPersistenceError(
          "VOICE_DNA_CURRENT_AMBIGUOUS",
          "More than one current Voice DNA authority exists for this Character version"
        );
      }
      if (currents.length === 1 && supersedesVoiceDnaId !== currents[0]?.voiceDnaId) {
        throw new AiStoryCharacterVoiceDnaPersistenceError(
          "VOICE_DNA_SUPERSESSION_REQUIRED",
          "A new Voice DNA authority must explicitly supersede the current authority"
        );
      }
      if (supersedesVoiceDnaId) {
        const prior = peers.find((row) => row.voiceDnaId === supersedesVoiceDnaId);
        if (!prior || prior.reusableCharacterVersionId !== candidate.reusableCharacterVersionId) {
          throw new AiStoryCharacterVoiceDnaError(
            "VOICE_DNA_CHARACTER_VERSION_MISMATCH",
            "Voice DNA can only supersede an authority for the same Character version"
          );
        }
        if (supersedesVoiceDnaId === candidate.voiceDnaId) {
          throw new AiStoryCharacterVoiceDnaPersistenceError(
            "VOICE_DNA_IMMUTABLE_CONFLICT",
            "Voice DNA cannot supersede itself"
          );
        }
      }

      await tx.insert(schema.aiStoryCharacterVoiceDnaAuthorities).values({
        voiceDnaId: candidate.voiceDnaId,
        orgId: scope.orgId,
        workspaceId: scope.workspaceId,
        reusableCharacterId: candidate.reusableCharacterId,
        reusableCharacterVersionId: candidate.reusableCharacterVersionId,
        characterIdentityFingerprint: candidate.characterIdentityFingerprint,
        voiceDnaFingerprint: candidate.voiceDnaFingerprint,
        contractVersion: candidate.contractVersion,
        status: candidate.status,
        supersedesVoiceDnaId,
        snapshot: candidate,
        createdBy: scope.actorUserId,
        createdAt: new Date(),
      });
      return loadVerified(tx, scope, candidate.voiceDnaId);
    });
  }

  async readById(scope: AiStoryReusableCharacterScope, voiceDnaId: string): Promise<AiStoryCharacterVoiceDna> {
    await assertWorkspaceScope(this.db, scope, false);
    return loadVerified(this.db, scope, voiceDnaId);
  }

  async readCurrentForReusableCharacterVersion(
    scope: AiStoryReusableCharacterScope,
    character: VoiceDnaCharacterVersionRef
  ): Promise<AiStoryCharacterVoiceDna | null> {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryCharacterVoiceDnaAuthorities).where(and(
      eq(schema.aiStoryCharacterVoiceDnaAuthorities.orgId, scope.orgId),
      eq(schema.aiStoryCharacterVoiceDnaAuthorities.workspaceId, scope.workspaceId),
      eq(schema.aiStoryCharacterVoiceDnaAuthorities.reusableCharacterId, character.reusableCharacterId),
      eq(schema.aiStoryCharacterVoiceDnaAuthorities.reusableCharacterVersionId, character.reusableCharacterVersionId),
      inArray(schema.aiStoryCharacterVoiceDnaAuthorities.status, [...CURRENT_STATUSES]),
    ));
    const currents = currentAuthorities(rows, scope);
    if (currents.length === 0) return null;
    if (currents.length > 1) {
      throw new AiStoryCharacterVoiceDnaPersistenceError(
        "VOICE_DNA_CURRENT_AMBIGUOUS",
        "More than one current Voice DNA authority exists for this Character version"
      );
    }
    return currents[0] ?? null;
  }

  /** Episode pins resolve the named authority. A newer current authority is not substituted. */
  async resolvePinnedAuthority(
    scope: AiStoryReusableCharacterScope,
    pin: { voiceDnaId: string; voiceDnaFingerprint: string }
  ): Promise<AiStoryCharacterVoiceDna> {
    const authority = await this.readById(scope, pin.voiceDnaId);
    if (authority.voiceDnaFingerprint !== pin.voiceDnaFingerprint) {
      throw new AiStoryCharacterVoiceDnaPersistenceError(
        "VOICE_DNA_FINGERPRINT_MISMATCH",
        "Pinned Voice DNA fingerprint does not match the stored authority"
      );
    }
    return authority;
  }

  async history(
    scope: AiStoryReusableCharacterScope,
    character: VoiceDnaCharacterVersionRef
  ): Promise<AiStoryCharacterVoiceDna[]> {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryCharacterVoiceDnaAuthorities).where(and(
      eq(schema.aiStoryCharacterVoiceDnaAuthorities.orgId, scope.orgId),
      eq(schema.aiStoryCharacterVoiceDnaAuthorities.workspaceId, scope.workspaceId),
      eq(schema.aiStoryCharacterVoiceDnaAuthorities.reusableCharacterId, character.reusableCharacterId),
      eq(schema.aiStoryCharacterVoiceDnaAuthorities.reusableCharacterVersionId, character.reusableCharacterVersionId),
    ));
    return rows.map((row) => verifyStoredAuthority(row, scope));
  }
}

export async function loadReusableCharacterVoiceIdentity(
  db: Db,
  scope: AiStoryReusableCharacterScope,
  character: VoiceDnaCharacterVersionRef
): Promise<AiStoryCharacterVoiceDna | null> {
  return new AiStoryCharacterVoiceDnaService(db).readCurrentForReusableCharacterVersion(scope, character);
}
