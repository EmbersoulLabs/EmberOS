import { z } from "zod";
import { requestHash } from "./provider-reliability-contracts";

export const EXECUTION_DISPATCH_VERSION = "1" as const;
export const EXECUTION_DISPATCH_STATUS = "DISPATCHED" as const;

const NonEmptyStringSchema = z.string().trim().min(1);
const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const DispatchWorkerHandoffSchema = z
  .object({
    envelopeId: NonEmptyStringSchema,
    payloadReference: NonEmptyStringSchema,
    dispatchContractVersion: z.literal(EXECUTION_DISPATCH_VERSION),
  })
  .strict();

export const ExecutionDispatchSchema = z
  .object({
    version: z.literal(EXECUTION_DISPATCH_VERSION),
    dispatchId: NonEmptyStringSchema,
    jobId: NonEmptyStringSchema,
    executionId: NonEmptyStringSchema,
    envelopeId: NonEmptyStringSchema,
    payloadReference: NonEmptyStringSchema,
    correlationId: NonEmptyStringSchema,
    tenantId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    capabilityId: NonEmptyStringSchema,
    capabilityVersion: VersionSchema,
    requestHash: HashSchema,
    envelopeHash: HashSchema,
    workerHandoff: DispatchWorkerHandoffSchema,
    dispatchHash: HashSchema,
    status: z.literal(EXECUTION_DISPATCH_STATUS),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.workerHandoff.envelopeId !== value.envelopeId ||
      value.workerHandoff.payloadReference !== value.payloadReference
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Worker handoff identity conflicts with Dispatch identity",
      });
    }
  });

export type ExecutionDispatch = Readonly<
  z.infer<typeof ExecutionDispatchSchema>
>;
export type CreateExecutionDispatchInput = Omit<
  ExecutionDispatch,
  "dispatchId" | "dispatchHash" | "status"
>;

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freeze(child);
    }
  }
  return value;
}

export function executionDispatchHashInput(
  dispatch: Omit<
    ExecutionDispatch,
    "dispatchId" | "dispatchHash" | "createdAt"
  >
): Readonly<Record<string, unknown>> {
  return {
    version: dispatch.version,
    jobId: dispatch.jobId,
    executionId: dispatch.executionId,
    envelopeId: dispatch.envelopeId,
    payloadReference: dispatch.payloadReference,
    correlationId: dispatch.correlationId,
    tenantId: dispatch.tenantId,
    workspaceId: dispatch.workspaceId,
    capabilityId: dispatch.capabilityId,
    capabilityVersion: dispatch.capabilityVersion,
    requestHash: dispatch.requestHash,
    envelopeHash: dispatch.envelopeHash,
    workerHandoff: dispatch.workerHandoff,
    status: dispatch.status,
  };
}

export async function createExecutionDispatch(
  input: CreateExecutionDispatchInput
): Promise<ExecutionDispatch> {
  const stable = {
    ...structuredClone(input),
    version: EXECUTION_DISPATCH_VERSION,
    status: EXECUTION_DISPATCH_STATUS,
  };
  const dispatchHash = await requestHash(executionDispatchHashInput(stable));
  const dispatchId = `dispatch:${dispatchHash.slice("sha256:".length)}`;
  return freeze(
    ExecutionDispatchSchema.parse({ ...stable, dispatchId, dispatchHash })
  ) as ExecutionDispatch;
}

export async function validateExecutionDispatch(
  input: unknown
): Promise<ExecutionDispatch> {
  const dispatch = ExecutionDispatchSchema.parse(structuredClone(input));
  const { dispatchId, dispatchHash, createdAt: _createdAt, ...stable } =
    dispatch;
  const expectedHash = await requestHash(executionDispatchHashInput(stable));
  if (dispatchHash !== expectedHash) {
    throw new Error("Execution Dispatch hash is invalid");
  }
  if (dispatchId !== `dispatch:${expectedHash.slice("sha256:".length)}`) {
    throw new Error("Execution Dispatch ID is invalid");
  }
  return freeze(dispatch) as ExecutionDispatch;
}
