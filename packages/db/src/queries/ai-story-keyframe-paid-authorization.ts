import { and, eq } from "drizzle-orm";
import {
  isKeyframePaidAuthorizationIntegrityValid,
} from "@ceo-agent/shared/server";
import { AiStoryKeyframePaidAuthorizationFactSchema, type AiStoryKeyframePaidAuthorizationFact } from "@ceo-agent/shared";
import { getDb, schema } from "../client";

export interface AiStoryKeyframePaidAuthorizationRepository {
  findById(authorizationId: string): Promise<AiStoryKeyframePaidAuthorizationFact | null>;
  persist(fact: AiStoryKeyframePaidAuthorizationFact): Promise<AiStoryKeyframePaidAuthorizationFact>;
}

export class KeyframePaidAuthorizationPersistenceError extends Error {
  constructor(readonly code: "AUTHORITY_SCOPE_INVALID" | "ACTOR_NOT_AUTHORIZED" | "AUTHORITY_INTEGRITY_INVALID" | "AUTHORITY_IDENTITY_CONFLICT") {
    super(code);
    this.name = "KeyframePaidAuthorizationPersistenceError";
  }
}

function parseFact(value: unknown): AiStoryKeyframePaidAuthorizationFact {
  const fact = AiStoryKeyframePaidAuthorizationFactSchema.parse(value);
  if (!isKeyframePaidAuthorizationIntegrityValid(fact)) {
    throw new KeyframePaidAuthorizationPersistenceError("AUTHORITY_INTEGRITY_INVALID");
  }
  return fact;
}

export class PostgresAiStoryKeyframePaidAuthorizationRepository implements AiStoryKeyframePaidAuthorizationRepository {
  async findById(authorizationId: string) {
    const [row] = await getDb().select({ fact: schema.aiStoryKeyframePaidAuthorizations.fact })
      .from(schema.aiStoryKeyframePaidAuthorizations)
      .where(eq(schema.aiStoryKeyframePaidAuthorizations.authorizationId, authorizationId)).limit(1);
    return row ? parseFact(row.fact) : null;
  }

  async persist(factInput: AiStoryKeyframePaidAuthorizationFact) {
    const fact = parseFact(factInput);
    return getDb().transaction(async (tx) => {
      const [scope] = await tx.select({ storyId: schema.aiStories.id })
        .from(schema.aiStories)
        .innerJoin(schema.workspaces, and(
          eq(schema.workspaces.id, schema.aiStories.workspaceId),
          eq(schema.workspaces.orgId, schema.aiStories.orgId)))
        .where(and(eq(schema.aiStories.id, fact.storyId), eq(schema.aiStories.orgId, fact.orgId), eq(schema.aiStories.workspaceId, fact.workspaceId))).limit(1);
      if (!scope) throw new KeyframePaidAuthorizationPersistenceError("AUTHORITY_SCOPE_INVALID");

      const [actor] = await tx.select({ userId: schema.workspaceMembers.userId })
        .from(schema.workspaceMembers)
        .where(and(eq(schema.workspaceMembers.orgId, fact.orgId),
          eq(schema.workspaceMembers.workspaceId, fact.workspaceId),
          eq(schema.workspaceMembers.userId, fact.authorizedBy))).limit(1);
      if (!actor) throw new KeyframePaidAuthorizationPersistenceError("ACTOR_NOT_AUTHORIZED");

      await tx.insert(schema.aiStoryKeyframePaidAuthorizations).values({
        authorizationId: fact.authorizationId, contractVersion: fact.contractVersion,
        orgId: fact.orgId, workspaceId: fact.workspaceId, storyId: fact.storyId,
        sceneId: fact.sceneId, sceneVersionId: fact.sceneVersionId,
        preparationAuthorityId: fact.preparationAuthorityId, preparationFingerprint: fact.preparationFingerprint,
        keyframeBriefFingerprint: fact.keyframeBriefFingerprint, providerId: fact.authorizedProviderId,
        modelId: fact.authorizedModelId, maximumImageProviderCalls: fact.maximumImageProviderCalls,
        authorizedBy: fact.authorizedBy, authorizedAt: new Date(fact.authorizedAt),
        authorizationReason: fact.authorizationReason,
        deterministicIntegrityHash: fact.deterministicIntegrityHash, fact,
      }).onConflictDoNothing({ target: schema.aiStoryKeyframePaidAuthorizations.authorizationId });

      const [row] = await tx.select({ fact: schema.aiStoryKeyframePaidAuthorizations.fact })
        .from(schema.aiStoryKeyframePaidAuthorizations)
        .where(eq(schema.aiStoryKeyframePaidAuthorizations.authorizationId, fact.authorizationId)).limit(1);
      if (!row) throw new KeyframePaidAuthorizationPersistenceError("AUTHORITY_IDENTITY_CONFLICT");
      const persisted = parseFact(row.fact);
      if (persisted.deterministicIntegrityHash !== fact.deterministicIntegrityHash) {
        throw new KeyframePaidAuthorizationPersistenceError("AUTHORITY_IDENTITY_CONFLICT");
      }
      return persisted;
    });
  }
}
