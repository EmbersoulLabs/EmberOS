import { eq } from "drizzle-orm";
import {
  validateExecutionEnvelope,
  type ExecutionEnvelope,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;

export class ExecutionEnvelopeConflictError extends Error {
  readonly code = "EXECUTION_ENVELOPE_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ExecutionEnvelopeConflictError";
  }
}

export interface ExecutionEnvelopeLogEntry {
  readonly event:
    | "execution_envelope.created"
    | "execution_envelope.lookup"
    | "execution_envelope.repository_read"
    | "execution_envelope.validation_failed";
  readonly envelopeId?: string;
  readonly payloadReference?: string;
  readonly reason?: string;
  readonly timestamp: string;
}

export interface ExecutionEnvelopeLogger {
  log(entry: ExecutionEnvelopeLogEntry): void;
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freeze(child);
    }
  }
  return value;
}

function toEnvelope(
  row: typeof schema.providerExecutionEnvelopes.$inferSelect
): ExecutionEnvelope {
  return freeze({
    version: row.version,
    envelopeId: row.envelopeId,
    payloadReference: row.payloadReference,
    tenantId: row.orgId,
    workspaceId: row.workspaceId,
    executionContext: row.executionContext,
    capabilityId: row.capabilityId,
    capabilityVersion: row.capabilityVersion,
    providerPolicySnapshot: row.providerPolicySnapshot,
    canonicalRequest: row.canonicalRequest,
    requestHash: row.requestHash,
    envelopeHash: row.envelopeHash,
    createdAt: row.createdAt.toISOString(),
  }) as ExecutionEnvelope;
}

export class ExecutionEnvelopeRepository {
  private readonly logger: ExecutionEnvelopeLogger;
  private readonly now: () => Date;

  constructor(
    private readonly db: Db = getDb(),
    options: {
      logger?: ExecutionEnvelopeLogger;
      now?: () => Date;
    } = {}
  ) {
    this.logger = options.logger ?? { log: () => undefined };
    this.now = options.now ?? (() => new Date());
  }

  async createEnvelope(input: ExecutionEnvelope): Promise<ExecutionEnvelope> {
    let envelope: ExecutionEnvelope;
    try {
      envelope = await validateExecutionEnvelope(input);
    } catch (error) {
      this.logger.log({
        event: "execution_envelope.validation_failed",
        envelopeId:
          typeof input === "object" && input ? input.envelopeId : undefined,
        reason: error instanceof Error ? error.message : "Invalid envelope",
        timestamp: this.now().toISOString(),
      });
      throw error;
    }

    const rows = await this.db
      .insert(schema.providerExecutionEnvelopes)
      .values({
        envelopeId: envelope.envelopeId,
        version: envelope.version,
        payloadReference: envelope.payloadReference,
        orgId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        executionContext: envelope.executionContext,
        capabilityId: envelope.capabilityId,
        capabilityVersion: envelope.capabilityVersion,
        providerPolicySnapshot: envelope.providerPolicySnapshot,
        canonicalRequest: envelope.canonicalRequest,
        requestHash: envelope.requestHash,
        envelopeHash: envelope.envelopeHash,
        createdAt: new Date(envelope.createdAt),
      })
      .onConflictDoNothing()
      .returning();
    if (!rows[0]) {
      throw new ExecutionEnvelopeConflictError(
        "Envelope ID or payloadReference already exists"
      );
    }
    const created = await validateExecutionEnvelope(toEnvelope(rows[0]));
    this.logger.log({
      event: "execution_envelope.created",
      envelopeId: created.envelopeId,
      payloadReference: created.payloadReference,
      timestamp: this.now().toISOString(),
    });
    return created;
  }

  async getEnvelope(envelopeId: string): Promise<ExecutionEnvelope | null> {
    this.logger.log({
      event: "execution_envelope.repository_read",
      envelopeId,
      timestamp: this.now().toISOString(),
    });
    const [row] = await this.db
      .select()
      .from(schema.providerExecutionEnvelopes)
      .where(eq(schema.providerExecutionEnvelopes.envelopeId, envelopeId))
      .limit(1);
    return row ? validateExecutionEnvelope(toEnvelope(row)) : null;
  }

  async getEnvelopeByPayloadReference(
    payloadReference: string
  ): Promise<ExecutionEnvelope | null> {
    this.logger.log({
      event: "execution_envelope.lookup",
      payloadReference,
      timestamp: this.now().toISOString(),
    });
    const [row] = await this.db
      .select()
      .from(schema.providerExecutionEnvelopes)
      .where(
        eq(schema.providerExecutionEnvelopes.payloadReference, payloadReference)
      )
      .limit(1);
    return row ? validateExecutionEnvelope(toEnvelope(row)) : null;
  }

  async exists(payloadReference: string): Promise<boolean> {
    return (await this.getEnvelopeByPayloadReference(payloadReference)) !== null;
  }
}
