/**
 * Flux marketing-image provider adapter.
 * Capability-driven; requires FLUX_API_KEY (+ optional FLUX_API_BASE_URL).
 */
import { z } from "zod";
import {
  createProviderError,
  requestHash,
  responseHash,
  validateCanonicalProviderRequest,
  validateCanonicalProviderResult,
  type CanonicalProviderRequest,
  type CanonicalProviderResult,
  type ProviderErrorKind,
} from "@ceo-agent/shared";
import {
  ProviderAdapterError,
  type ProviderAdapter,
  type ProviderCapabilityDeclaration,
  type ProviderExecutionContext,
  type ProviderLookupResult,
  type ProviderPayloadResolver,
} from "./contracts";

const ADAPTER_VERSION = "1.0.0";
const DEFAULT_BASE = "https://api.bfl.ai/v1";

const PayloadSchema = z
  .object({
    prompt: z.string().min(1),
    negativePrompt: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    outputIndex: z.number().int().nonnegative().optional(),
  })
  .strict();

const CAPABILITY = Object.freeze({
  providerId: "flux",
  adapterVersion: ADAPTER_VERSION,
  capabilityId: "marketing-image-generation",
  capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requiredProviderFeatures: [],
  nativeIdempotency: true,
  lookup: true,
  cancellation: false,
  callbacks: false,
  streaming: false,
  routing: {
    costClass: "LOW",
    estimatedCostUsd: 0.08,
    latencyClass: "STANDARD",
    qualityClass: "HIGH",
    reliabilityClass: "HIGH",
    regions: [],
    modelFamilies: ["flux"],
    sensitiveDataAllowed: false,
    externalProcessing: true,
    trainingOptOut: true,
    zeroRetention: false,
    enterpriseControls: false,
  },
} satisfies ProviderCapabilityDeclaration);

function apiConfigured(): boolean {
  return Boolean(process.env.FLUX_API_KEY?.trim());
}

function baseUrl(): string {
  return process.env.FLUX_API_BASE_URL?.trim() || DEFAULT_BASE;
}

function mapError(error: unknown): ProviderAdapterError {
  const message =
    error instanceof Error ? error.message.slice(0, 500) : "Flux request failed";
  let kind: ProviderErrorKind = "TERMINAL_FAILURE";
  if (/timeout|timed out/i.test(message)) kind = "TIMEOUT_UNKNOWN";
  if (/429|rate/i.test(message)) kind = "RATE_LIMITED";
  if (/401|403|auth/i.test(message)) kind = "AUTHENTICATION_FAILURE";
  if (/5\d\d|unavailable|network/i.test(message)) kind = "PROVIDER_UNAVAILABLE";
  return new ProviderAdapterError(
    createProviderError(kind, {
      code: `FLUX_${kind}`,
      message,
      safeDetails: { providerId: "flux" },
    }),
    { cause: error }
  );
}

export class FluxImageAdapter implements ProviderAdapter {
  readonly providerId = "flux";
  readonly adapterVersion = ADAPTER_VERSION;

  constructor(private readonly payloadResolver: ProviderPayloadResolver) {}

  capabilities(): ReadonlySet<ProviderCapabilityDeclaration> {
    if (!apiConfigured()) return new Set();
    return new Set([CAPABILITY]);
  }

  async execute(
    input: CanonicalProviderRequest,
    context: ProviderExecutionContext
  ): Promise<CanonicalProviderResult> {
    try {
      const request = validateCanonicalProviderRequest(input);
      const payload = PayloadSchema.parse(
        await this.payloadResolver.resolve(request.normalizedPayloadReference, context)
      );
      const res = await fetch(`${baseUrl()}/flux-pro`, {
        method: "POST",
        headers: {
          "x-key": process.env.FLUX_API_KEY!.trim(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: payload.prompt,
          width: payload.width ?? 768,
          height: payload.height ?? 1344,
          prompt_upsampling: false,
          safety_tolerance: 2,
        }),
      });
      if (!res.ok) throw new Error(`Flux create failed (${res.status})`);
      const body = (await res.json()) as {
        id?: string;
        status?: string;
        result?: { sample?: string };
        sample?: string;
      };
      const providerRequestId = body.id ?? request.executionIdentity.idempotencyKey;
      let imageUrl = body.result?.sample ?? body.sample;
      const deadline = Date.parse(context.timeoutDeadline);
      while (!imageUrl && body.id && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const lookup = await this.lookup(body.id, context);
        if (lookup.status === "SUCCEEDED") {
          imageUrl = (lookup.result?.normalizedOutput as { imageUrl?: string } | undefined)
            ?.imageUrl;
          break;
        }
        if (lookup.status === "FAILED") throw new Error(lookup.error.message);
      }
      if (!imageUrl) throw new Error("Flux execution completed without image URL");

      const normalizedOutput = {
        mediaKind: "image" as const,
        imageUrl,
        providerRequestId,
        outputIndex: payload.outputIndex ?? 0,
      };
      return validateCanonicalProviderResult({
        contractVersion: "1",
        executionId: request.executionIdentity.executionId,
        providerAttemptId: context.providerAttemptId,
        normalizedOutput,
        resultReference: `provider-result://flux/${providerRequestId}`,
        warnings: [],
        providerMetadata: {
          providerId: "flux",
          providerVersion: "flux-v1",
        },
        usage: {},
        cost: { amount: 0.08, currency: "USD", estimated: true },
        modelVersion: "flux-pro",
        requestHash: await requestHash(request),
        responseHash: await responseHash(normalizedOutput),
        retryable: false,
        validationStatus: "VALID",
      });
    } catch (error) {
      if (error instanceof ProviderAdapterError) throw error;
      throw mapError(error);
    }
  }

  async lookup(
    providerRequestId: string,
    _context: ProviderExecutionContext
  ): Promise<ProviderLookupResult> {
    try {
      const res = await fetch(`${baseUrl()}/get_result?id=${encodeURIComponent(providerRequestId)}`, {
        headers: { "x-key": process.env.FLUX_API_KEY!.trim() },
      });
      if (res.status === 404) return { status: "NOT_FOUND" };
      if (!res.ok) return { status: "UNKNOWN" };
      const body = (await res.json()) as {
        status?: string;
        result?: { sample?: string };
      };
      const status = (body.status ?? "").toLowerCase();
      if (["error", "failed"].includes(status)) {
        return {
          status: "FAILED",
          providerRequestId,
          error: createProviderError("TERMINAL_FAILURE", {
            code: "FLUX_FAILED",
            message: "Flux generation failed",
          }),
        };
      }
      if (body.result?.sample && ["ready", "success", "completed"].includes(status)) {
        return {
          status: "SUCCEEDED",
          providerRequestId,
          result: {
            contractVersion: "1",
            executionId: "lookup",
            providerAttemptId: "lookup",
            normalizedOutput: { imageUrl: body.result.sample, mediaKind: "image" },
            resultReference: `provider-result://flux/${providerRequestId}`,
            warnings: [],
            providerMetadata: { providerId: "flux", providerVersion: "flux-v1" },
            usage: {},
            cost: { amount: 0, currency: "USD", estimated: true },
            modelVersion: "flux-pro",
            requestHash: `sha256:${"0".repeat(64)}`,
            responseHash: `sha256:${"1".repeat(64)}`,
            retryable: false,
            validationStatus: "VALID",
          },
        };
      }
      return { status: "RUNNING", providerRequestId };
    } catch {
      return { status: "UNKNOWN" };
    }
  }
}

export const FLUX_IMAGE_CAPABILITY = CAPABILITY;
