import { and, eq, sql } from "drizzle-orm";
import {
  AiStoryScriptSemanticProposalV1Schema,
  type AiStoryScriptSemanticProposalV1,
} from "@ceo-agent/shared";
import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import type { AiStoryScriptScope } from "./ai-story-script";

type Db = ReturnType<typeof getDb>;

export class AiStoryScriptSemanticProposalAuthorityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryScriptSemanticProposalAuthorityError";
  }
}

export type AuthorizedAiStoryScriptSemanticProposal = {
  proposalId: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  contractVersion: AiStoryScriptSemanticProposalV1["contractVersion"];
  profileId: "PRODUCT_STORY" | "COMMERCIAL_STORY";
  lifecycleState: "AUTHORIZED";
  proposal: AiStoryScriptSemanticProposalV1;
  contentHash: string;
  semanticInputFingerprint: string;
  originatingRunId: string;
  groundingLineage: Record<string, unknown>;
  authorizedBy: string;
  authorizedAt: string;
  createdAt: string;
};

export type AuthorizeAiStoryScriptSemanticProposalInput = AiStoryScriptScope & {
  profileId: "PRODUCT_STORY" | "COMMERCIAL_STORY";
  proposal: AiStoryScriptSemanticProposalV1;
  semanticInputFingerprint: string;
  originatingRunId: string;
  groundingLineage: Record<string, unknown>;
  authorizedAt: string;
  acceptance?: "AUTHORIZED" | "REJECTED";
};

function fail(code: string, message: string): never {
  throw new AiStoryScriptSemanticProposalAuthorityError(code, message);
}

async function assertScope(db: Pick<Db, "execute">, scope: AiStoryScriptScope) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from ai_stories s
    join campaigns c on c.id = s.campaign_id
    join ai_story_versions v on v.story_id = s.id
    where s.id = ${scope.storyId}::uuid
      and s.org_id = ${scope.orgId}::uuid
      and s.workspace_id = ${scope.workspaceId}::uuid
      and s.campaign_id = ${scope.campaignId}::uuid
      and c.org_id = ${scope.orgId}::uuid
      and c.workspace_id = ${scope.workspaceId}::uuid
      and v.id = ${scope.storyVersionId}::uuid
      and (${!scope.requireCurrentFrozenStoryVersion} = true or (s.current_version_id = v.id and v.frozen_at is not null))
      and exists (
        select 1 from workspace_members wm
        where wm.workspace_id = ${scope.workspaceId}::uuid
          and wm.user_id = ${scope.actorUserId}::uuid
          and wm.role in ('admin', 'operator', 'editor', 'reviewer')
      )
  ) as ok`);
  if (!rows[0]?.ok) fail("SCRIPT_SEMANTIC_PROPOSAL_SCOPE_DENIED", "Script semantic proposal scope does not resolve");
}

function toRecord(row: typeof schema.aiStoryScriptSemanticProposals.$inferSelect): AuthorizedAiStoryScriptSemanticProposal {
  const proposal = AiStoryScriptSemanticProposalV1Schema.parse(row.proposal);
  const contentHash = sha256CanonicalIntegrityHash(proposal);
  if (
    row.lifecycleState !== "AUTHORIZED" ||
    row.contractVersion !== proposal.contractVersion ||
    row.contentHash !== contentHash
  ) {
    fail("SCRIPT_SEMANTIC_PROPOSAL_INTEGRITY_INVALID", "Persisted semantic proposal failed integrity checks");
  }
  if (row.profileId !== "PRODUCT_STORY" && row.profileId !== "COMMERCIAL_STORY") {
    fail("SCRIPT_SEMANTIC_PROPOSAL_PROFILE_INVALID", "Persisted semantic proposal profile is not canonical");
  }
  return {
    proposalId: row.proposalId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    campaignId: row.campaignId,
    storyId: row.storyId,
    storyVersionId: row.storyVersionId,
    contractVersion: proposal.contractVersion,
    profileId: row.profileId,
    lifecycleState: "AUTHORIZED",
    proposal,
    contentHash,
    semanticInputFingerprint: row.semanticInputFingerprint,
    originatingRunId: row.originatingRunId,
    groundingLineage: row.groundingLineage,
    authorizedBy: row.authorizedBy,
    authorizedAt: row.authorizedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export class AiStoryScriptSemanticProposalAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  async authorize(input: AuthorizeAiStoryScriptSemanticProposalInput): Promise<AuthorizedAiStoryScriptSemanticProposal> {
    if (input.acceptance === "REJECTED") {
      fail("SCRIPT_SEMANTIC_PROPOSAL_NOT_AUTHORIZED", "Rejected semantic proposals cannot become execution authority");
    }
    const proposal = AiStoryScriptSemanticProposalV1Schema.parse(input.proposal);
    if (!/^sha256:[0-9a-f]{64}$/.test(input.semanticInputFingerprint)) {
      fail("SCRIPT_SEMANTIC_PROPOSAL_FINGERPRINT_INVALID", "Semantic input fingerprint is invalid");
    }
    if (!input.originatingRunId.trim()) fail("SCRIPT_SEMANTIC_PROPOSAL_RUN_REQUIRED", "Originating generation identity is required");
    const contentHash = sha256CanonicalIntegrityHash(proposal);
    const proposalId = deterministicUuidFromFingerprint(
      "ai-story-script-semantic-proposal",
      `${input.storyVersionId}:${contentHash}`,
    );
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`script-semantic-proposal:${input.storyId}:${input.storyVersionId}`}))`);
      await assertScope(tx, input);
      const existing = await tx.select().from(schema.aiStoryScriptSemanticProposals).where(and(
        eq(schema.aiStoryScriptSemanticProposals.storyId, input.storyId),
        eq(schema.aiStoryScriptSemanticProposals.storyVersionId, input.storyVersionId),
      )).limit(1).for("update");
      if (existing[0]) {
        const current = toRecord(existing[0]);
        if (
          current.workspaceId !== input.workspaceId ||
          current.orgId !== input.orgId ||
          current.contentHash !== contentHash ||
          current.semanticInputFingerprint !== input.semanticInputFingerprint ||
          current.profileId !== input.profileId
        ) {
          fail("SCRIPT_SEMANTIC_PROPOSAL_IMMUTABLE", "An authorized semantic proposal already exists for this Story Version");
        }
        return current;
      }
      const authorizedAt = new Date(input.authorizedAt);
      const createdAt = authorizedAt;
      await tx.insert(schema.aiStoryScriptSemanticProposals).values({
        proposalId,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        campaignId: input.campaignId,
        storyId: input.storyId,
        storyVersionId: input.storyVersionId,
        contractVersion: proposal.contractVersion,
        profileId: input.profileId,
        lifecycleState: "AUTHORIZED",
        proposal,
        contentHash,
        semanticInputFingerprint: input.semanticInputFingerprint,
        originatingRunId: input.originatingRunId,
        groundingLineage: input.groundingLineage,
        authorizedBy: input.actorUserId,
        authorizedAt,
        createdAt,
      });
      const inserted = await tx.select().from(schema.aiStoryScriptSemanticProposals).where(and(
        eq(schema.aiStoryScriptSemanticProposals.proposalId, proposalId),
        eq(schema.aiStoryScriptSemanticProposals.workspaceId, input.workspaceId),
        eq(schema.aiStoryScriptSemanticProposals.storyId, input.storyId),
        eq(schema.aiStoryScriptSemanticProposals.storyVersionId, input.storyVersionId),
      )).limit(1);
      if (!inserted[0]) fail("SCRIPT_SEMANTIC_PROPOSAL_NOT_FOUND", "Authorized semantic proposal was not persisted");
      return toRecord(inserted[0]);
    });
  }

  /** Exact Story Version lookup. Never selects a latest proposal from another version. */
  async resolveExact(scope: AiStoryScriptScope): Promise<AuthorizedAiStoryScriptSemanticProposal | null> {
    await assertScope(this.db, { ...scope, requireCurrentFrozenStoryVersion: scope.requireCurrentFrozenStoryVersion });
    const rows = await this.db.select().from(schema.aiStoryScriptSemanticProposals).where(and(
      eq(schema.aiStoryScriptSemanticProposals.orgId, scope.orgId),
      eq(schema.aiStoryScriptSemanticProposals.workspaceId, scope.workspaceId),
      eq(schema.aiStoryScriptSemanticProposals.campaignId, scope.campaignId),
      eq(schema.aiStoryScriptSemanticProposals.storyId, scope.storyId),
      eq(schema.aiStoryScriptSemanticProposals.storyVersionId, scope.storyVersionId),
      eq(schema.aiStoryScriptSemanticProposals.lifecycleState, "AUTHORIZED"),
    ));
    if (rows.length === 0) return null;
    if (rows.length !== 1) fail("SCRIPT_SEMANTIC_PROPOSAL_AMBIGUOUS", "More than one authorized semantic proposal claims this Story Version");
    const record = toRecord(rows[0]!);
    if (record.storyId !== scope.storyId || record.storyVersionId !== scope.storyVersionId || record.workspaceId !== scope.workspaceId) {
      fail("SCRIPT_SEMANTIC_PROPOSAL_PIN_INVALID", "Resolved semantic proposal is not pinned to the requested Story Version");
    }
    return record;
  }
}
