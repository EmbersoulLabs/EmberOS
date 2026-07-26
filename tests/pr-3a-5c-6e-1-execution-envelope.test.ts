import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createExecutionEnvelope,
  validateExecutionEnvelope,
} from "@ceo-agent/shared";
import { createEnvelopeInput as input } from "./helpers/provider-execution-envelope";

describe("PR-3A.5C.6E.1 Execution Envelope", () => {
  it("creates a validated, deeply immutable canonical envelope", async () => {
    const envelope = await createExecutionEnvelope(input());
    expect(envelope.requestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(envelope.envelopeHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.canonicalRequest)).toBe(true);
    expect(Object.isFrozen(envelope.providerPolicySnapshot)).toBe(true);
    expect(() => {
      (envelope.providerPolicySnapshot as Record<string, unknown>).policyVersion =
        "2.0.0";
    }).toThrow();
  });

  it("excludes createdAt from the immutable envelope hash", async () => {
    const first = await createExecutionEnvelope(input());
    const second = await createExecutionEnvelope(
      input({ createdAt: "2027-02-03T04:05:06.000Z" })
    );
    expect(first.envelopeHash).toBe(second.envelopeHash);
    expect(first.createdAt).not.toBe(second.createdAt);
  });

  it("changes the hash when immutable request or policy content changes", async () => {
    const first = await createExecutionEnvelope(input());
    const changedRequest = input();
    const second = await createExecutionEnvelope({
      ...changedRequest,
      canonicalRequest: {
        ...changedRequest.canonicalRequest,
        outputSchema: {
          schemaId: "ChangedResult",
          schemaVersion: "1.0.0",
        },
      },
    });
    const third = await createExecutionEnvelope(
      input({
        providerPolicySnapshot: {
          policyVersion: "1.0.0",
          allowedProviders: ["provider-b"],
        },
      })
    );
    expect(second.envelopeHash).not.toBe(first.envelopeHash);
    expect(second.requestHash).not.toBe(first.requestHash);
    expect(third.envelopeHash).not.toBe(first.envelopeHash);
    expect(third.requestHash).toBe(first.requestHash);
  });

  it("rejects identity conflicts, missing fields, and tampered hashes", async () => {
    const conflicting = input({ capabilityVersion: "2.0.0" });
    await expect(createExecutionEnvelope(conflicting)).rejects.toThrow(
      /capabilityVersion/
    );
    await expect(
      createExecutionEnvelope(input({ payloadReference: "" }))
    ).rejects.toThrow();

    const envelope = await createExecutionEnvelope(input());
    await expect(
      validateExecutionEnvelope({
        ...envelope,
        requestHash: `sha256:${"f".repeat(64)}`,
      })
    ).rejects.toThrow(/request hash/);
    await expect(
      validateExecutionEnvelope({
        ...envelope,
        envelopeHash: `sha256:${"e".repeat(64)}`,
      })
    ).rejects.toThrow(/Envelope hash/);
  });

  it("keeps the repository isolated from execution and mutable stores", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../packages/db/src/queries/provider-execution-envelope.ts"
      ),
      "utf8"
    );
    expect(source).not.toMatch(
      /ProviderAdapter|ProviderRouter|OutboxDispatchWorker|ExecutionFinalizer/
    );
    expect(source).not.toMatch(
      /providerOutboxJobs|providerExecutions|providerAttempts/
    );
    expect(source).not.toMatch(/\.update\(|\.delete\(|\.execute\(/);
  });
});
