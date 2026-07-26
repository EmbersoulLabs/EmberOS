import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  ExecutionEnvelopeConflictError,
  ExecutionEnvelopeRepository,
} from "@ceo-agent/db";
import { createExecutionEnvelope } from "@ceo-agent/shared";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { createEnvelopeInput } from "./helpers/provider-execution-envelope";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("PR-3A.5C.6E.1 Execution Envelope repository", () => {
  let sql: Sql;
  const envelopeIds = new Set<string>();

  beforeAll(async () => {
    sql = createIntegrationSql();
    const statements = readFileSync(
      resolve(__dirname, "../packages/db/sql/provider-execution-envelope.sql"),
      "utf8"
    )
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await sql.unsafe(statement);
  });

  afterAll(async () => {
    if (envelopeIds.size > 0) {
      await sql`
        DELETE FROM provider_execution_envelopes
        WHERE envelope_id = ANY(${[...envelopeIds]})
      `;
    }
    await sql.end();
    await closeDb();
  });

  function uniqueInput() {
    const suffix = crypto.randomUUID();
    const value = createEnvelopeInput({
      envelopeId: `envelope-${suffix}`,
      payloadReference: `provider-envelope://${suffix}`,
      createdAt: new Date().toISOString(),
    });
    envelopeIds.add(value.envelopeId);
    return value;
  }

  it("creates and reconstructs the exact canonical request by both identities", async () => {
    const logs: unknown[] = [];
    const repository = new ExecutionEnvelopeRepository(undefined, {
      logger: { log: (entry) => logs.push(entry) },
    });
    const envelope = await createExecutionEnvelope(uniqueInput());
    const created = await repository.createEnvelope(envelope);
    const byId = await repository.getEnvelope(envelope.envelopeId);
    const byReference = await repository.getEnvelopeByPayloadReference(
      envelope.payloadReference
    );

    expect(created).toEqual(envelope);
    expect(byId).toEqual(envelope);
    expect(byReference).toEqual(envelope);
    expect(byReference?.canonicalRequest).toEqual(envelope.canonicalRequest);
    expect(await repository.exists(envelope.payloadReference)).toBe(true);
    expect(Object.isFrozen(byReference)).toBe(true);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "execution_envelope.created",
          envelopeId: envelope.envelopeId,
        }),
        expect.objectContaining({
          event: "execution_envelope.lookup",
          payloadReference: envelope.payloadReference,
        }),
      ])
    );
    expect(JSON.stringify(logs)).not.toContain(
      envelope.canonicalRequest.normalizedPayloadReference.uri
    );
  });

  it("rejects duplicate IDs and payload references without replacing content", async () => {
    const repository = new ExecutionEnvelopeRepository();
    const original = await createExecutionEnvelope(uniqueInput());
    await repository.createEnvelope(original);

    await expect(repository.createEnvelope(original)).rejects.toBeInstanceOf(
      ExecutionEnvelopeConflictError
    );
    const conflicting = await createExecutionEnvelope({
      ...uniqueInput(),
      payloadReference: original.payloadReference,
    });
    await expect(
      repository.createEnvelope(conflicting)
    ).rejects.toBeInstanceOf(ExecutionEnvelopeConflictError);
    expect(
      await repository.getEnvelopeByPayloadReference(original.payloadReference)
    ).toEqual(original);
  });

  it("logs validation failure without writing invalid content", async () => {
    const log = vi.fn();
    const repository = new ExecutionEnvelopeRepository(undefined, {
      logger: { log },
    });
    const envelope = await createExecutionEnvelope(uniqueInput());
    await expect(
      repository.createEnvelope({
        ...envelope,
        envelopeHash: `sha256:${"f".repeat(64)}`,
      })
    ).rejects.toThrow(/Envelope hash/);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "execution_envelope.validation_failed",
        envelopeId: envelope.envelopeId,
      })
    );
    expect(await repository.getEnvelope(envelope.envelopeId)).toBeNull();
  });
});
