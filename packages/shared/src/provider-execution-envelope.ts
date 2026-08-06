import { z } from "zod";
import {
  CanonicalProviderRequestSchema,
  requestHash,
  type CanonicalProviderRequest,
} from "./provider-reliability-contracts";

export const EXECUTION_ENVELOPE_VERSION = "1" as const;

const NonEmptyStringSchema = z.string().trim().min(1);
const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const ExecutionEnvelopeContextSchema = z
  .object({
    executionId: NonEmptyStringSchema,
    correlationId: NonEmptyStringSchema,
    pipelineRunId: NonEmptyStringSchema,
    queueJobId: NonEmptyStringSchema.optional(),
    idempotencyKey: NonEmptyStringSchema,
    timeoutDeadline: z.string().datetime(),
    dataHandling: z.record(z.unknown()),
    trace: z.record(z.string()),
  })
  .strict();

export const ExecutionEnvelopeSchema = z
  .object({
    version: z.literal(EXECUTION_ENVELOPE_VERSION),
    envelopeId: NonEmptyStringSchema,
    payloadReference: NonEmptyStringSchema,
    tenantId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    executionContext: ExecutionEnvelopeContextSchema,
    capabilityId: NonEmptyStringSchema,
    capabilityVersion: VersionSchema,
    providerPolicySnapshot: z.record(z.unknown()),
    canonicalRequest: CanonicalProviderRequestSchema,
    requestHash: HashSchema,
    envelopeHash: HashSchema,
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    const identity = value.canonicalRequest.executionIdentity;
    const correlation = value.canonicalRequest.correlation;
    const conflicts = [
      value.tenantId !== identity.tenantId && "tenantId",
      value.workspaceId !== identity.workspaceId && "workspaceId",
      value.capabilityId !== identity.capabilityId && "capabilityId",
      value.capabilityVersion !== identity.capabilityVersion &&
        "capabilityVersion",
      value.executionContext.executionId !== identity.executionId &&
        "executionId",
      value.executionContext.idempotencyKey !== identity.idempotencyKey &&
        "idempotencyKey",
      value.executionContext.correlationId !== correlation.correlationId &&
        "correlationId",
      value.executionContext.pipelineRunId !== correlation.pipelineRunId &&
        "pipelineRunId",
      value.executionContext.queueJobId !== correlation.queueJobId &&
        "queueJobId",
    ].filter(Boolean);
    if (conflicts.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Envelope identity conflicts with canonical request: ${conflicts.join(", ")}`,
      });
    }
  });

export type ExecutionEnvelopeContext = Readonly<
  z.infer<typeof ExecutionEnvelopeContextSchema>
>;
export type ExecutionEnvelope = Readonly<z.infer<typeof ExecutionEnvelopeSchema>>;
export type CreateExecutionEnvelopeInput = Omit<
  ExecutionEnvelope,
  "requestHash" | "envelopeHash"
> & {
  readonly canonicalRequest: CanonicalProviderRequest;
};

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freeze(child);
    }
  }
  return value;
}

export function executionEnvelopeHashInput(
  envelope: Omit<ExecutionEnvelope, "envelopeHash" | "createdAt">
): Readonly<Record<string, unknown>> {
  return {
    version: envelope.version,
    envelopeId: envelope.envelopeId,
    payloadReference: envelope.payloadReference,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    executionContext: envelope.executionContext,
    capabilityId: envelope.capabilityId,
    capabilityVersion: envelope.capabilityVersion,
    providerPolicySnapshot: envelope.providerPolicySnapshot,
    canonicalRequest: envelope.canonicalRequest,
    requestHash: envelope.requestHash,
  };
}

export async function calculateExecutionEnvelopeHash(
  envelope: Omit<ExecutionEnvelope, "envelopeHash" | "createdAt">
): Promise<string> {
  return requestHash(executionEnvelopeHashInput(envelope));
}

export async function createExecutionEnvelope(
  input: CreateExecutionEnvelopeInput
): Promise<ExecutionEnvelope> {
  const canonicalRequest = CanonicalProviderRequestSchema.parse(
    structuredClone(input.canonicalRequest)
  );
  const canonicalRequestHash = await requestHash(canonicalRequest);
  const withoutHash = {
    ...structuredClone(input),
    canonicalRequest,
    requestHash: canonicalRequestHash,
  };
  const envelopeHash = await calculateExecutionEnvelopeHash(withoutHash);
  return freeze(
    ExecutionEnvelopeSchema.parse({ ...withoutHash, envelopeHash })
  ) as ExecutionEnvelope;
}

export async function validateExecutionEnvelope(
  input: unknown
): Promise<ExecutionEnvelope> {
  const envelope = ExecutionEnvelopeSchema.parse(structuredClone(input));
  const expectedRequestHash = await requestHash(envelope.canonicalRequest);
  if (envelope.requestHash !== expectedRequestHash) {
    throw new Error("Execution Envelope request hash is invalid");
  }
  const { envelopeHash, createdAt: _createdAt, ...stable } = envelope;
  const expectedEnvelopeHash = await calculateExecutionEnvelopeHash(stable);
  if (envelopeHash !== expectedEnvelopeHash) {
    throw new Error("Execution Envelope hash is invalid");
  }
  return freeze(envelope) as ExecutionEnvelope;
}
