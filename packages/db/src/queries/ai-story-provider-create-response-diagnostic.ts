/**
 * ai-story-provider-create-response-diagnostic.v1 persistence.
 *
 * Append-only and idempotent: reprocessing the same Provider response converges
 * on the existing row instead of writing conflicting evidence. Rows are never
 * updated or deleted, and evidence is never fabricated for historical attempts.
 */
import { desc, eq } from "drizzle-orm";
import {
  AiStoryProviderCreateResponseDiagnosticSchema,
  assertAiStoryProviderDiagnosticIsSecretSafe,
  type AiStoryProviderCreateResponseDiagnostic,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";
import { deterministicPersistenceUuid } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export type AppendProviderCreateResponseDiagnosticInput = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly diagnostic: AiStoryProviderCreateResponseDiagnostic;
};

export type AppendProviderCreateResponseDiagnosticResult = {
  readonly diagnostic: AiStoryProviderCreateResponseDiagnostic;
  /** True when identical evidence already existed for this fingerprint. */
  readonly converged: boolean;
};

export class AiStoryProviderCreateResponseDiagnosticRepository {
  constructor(private readonly db: Db = getDb()) {}

  async appendProviderCreateResponseDiagnostic(
    input: AppendProviderCreateResponseDiagnosticInput
  ): Promise<AppendProviderCreateResponseDiagnosticResult> {
    const parsed = AiStoryProviderCreateResponseDiagnosticSchema.parse(
      input.diagnostic
    ) as AiStoryProviderCreateResponseDiagnostic;

    // Defence in depth: refuse to persist credential or URL material even if a
    // caller assembled the envelope without the adapter's sanitizers.
    assertAiStoryProviderDiagnosticIsSecretSafe(parsed);

    const diagnosticId = deterministicPersistenceUuid(
      "ai-story-provider-create-response-diagnostic",
      {
        providerAttemptId: parsed.providerAttemptId,
        compiledRequestId: parsed.compiledRequestId,
        diagnosticFingerprint: parsed.diagnosticFingerprint,
      }
    );

    const inserted = await this.db
      .insert(schema.aiStoryProviderCreateResponseDiagnostics)
      .values({
        diagnosticId,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        providerAttemptId: parsed.providerAttemptId,
        compiledRequestId: parsed.compiledRequestId,
        requestFingerprint: parsed.requestFingerprint,
        contractVersion: parsed.contractVersion,
        provider: parsed.provider,
        model: parsed.model,
        endpointFamily: parsed.endpointFamily,
        observationKind: parsed.observationKind,
        httpStatus: parsed.httpStatus ?? null,
        nativeErrorCode: parsed.nativeErrorCode ?? null,
        nativeErrorType: parsed.nativeErrorType ?? null,
        nativeErrorMessage: parsed.nativeErrorMessage ?? null,
        providerTraceId: parsed.providerTraceId ?? null,
        taskId: parsed.taskId ?? null,
        errorCategory: parsed.errorCategory,
        transportErrorMessage: parsed.transportErrorMessage ?? null,
        accepted: parsed.accepted,
        retryable: parsed.retryable,
        reconciliationRequired: parsed.reconciliationRequired,
        responseHash: parsed.responseHash,
        normalizationResult: parsed.normalizationResult,
        diagnosticFingerprint: parsed.diagnosticFingerprint,
        diagnostic: parsed,
        observedAt: new Date(parsed.observedAt),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      return { diagnostic: parsed, converged: false };
    }

    const [existing] = await this.db
      .select()
      .from(schema.aiStoryProviderCreateResponseDiagnostics)
      .where(
        eq(
          schema.aiStoryProviderCreateResponseDiagnostics.diagnosticFingerprint,
          parsed.diagnosticFingerprint
        )
      )
      .limit(1);

    if (!existing) {
      throw new Error(
        "Provider create-response diagnostic could not be appended or resolved"
      );
    }

    return {
      diagnostic: AiStoryProviderCreateResponseDiagnosticSchema.parse(
        existing.diagnostic
      ) as AiStoryProviderCreateResponseDiagnostic,
      converged: true,
    };
  }

  /** Newest-first evidence for an attempt. Empty for legacy attempts. */
  async listProviderCreateResponseDiagnosticsByAttemptId(
    providerAttemptId: string
  ): Promise<ReadonlyArray<AiStoryProviderCreateResponseDiagnostic>> {
    const rows = await this.db
      .select()
      .from(schema.aiStoryProviderCreateResponseDiagnostics)
      .where(
        eq(
          schema.aiStoryProviderCreateResponseDiagnostics.providerAttemptId,
          providerAttemptId
        )
      )
      .orderBy(
        desc(schema.aiStoryProviderCreateResponseDiagnostics.observedAt)
      );

    return rows.map(
      (row: { diagnostic: unknown }) =>
        AiStoryProviderCreateResponseDiagnosticSchema.parse(
          row.diagnostic
        ) as AiStoryProviderCreateResponseDiagnostic
    );
  }

  /**
   * Latest evidence for an attempt, or undefined when none was persisted.
   * Undefined means NOT PERSISTED / UNKNOWN — never an implied rejection.
   */
  async getLatestProviderCreateResponseDiagnosticByAttemptId(
    providerAttemptId: string
  ): Promise<AiStoryProviderCreateResponseDiagnostic | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.aiStoryProviderCreateResponseDiagnostics)
      .where(
        eq(
          schema.aiStoryProviderCreateResponseDiagnostics.providerAttemptId,
          providerAttemptId
        )
      )
      .orderBy(desc(schema.aiStoryProviderCreateResponseDiagnostics.observedAt))
      .limit(1);

    if (!row) {
      return undefined;
    }
    return AiStoryProviderCreateResponseDiagnosticSchema.parse(
      row.diagnostic
    ) as AiStoryProviderCreateResponseDiagnostic;
  }
}
