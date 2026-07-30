/**
 * Seedance animation-video provider adapter.
 * Capability-driven; requires SEEDANCE_API_KEY (+ optional SEEDANCE_API_BASE_URL).
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
  type ProviderCancelResult,
  type ProviderExecutionContext,
  type ProviderLookupResult,
  type ProviderPayloadResolver,
} from "./contracts";

const ADAPTER_VERSION = "1.0.0";
const DEFAULT_BASE = "https://api.seedance.ai/v1";

const PayloadSchema = z
  .object({
    prompt: z.string().min(1),
    negativePrompt: z.string().optional(),
    durationSec: z.number().positive().optional(),
    aspectRatio: z.string().optional(),
    outputIndex: z.number().int().nonnegative().optional(),
    /** Campaign Asset product references from compiled ExecutionManifest. */
    assetReferences: z
      .array(
        z.object({
          assetId: z.string().uuid(),
          storagePath: z.string(),
          role: z.string().default("product"),
        })
      )
      .optional(),
    identityConstraints: z.array(z.string()).optional(),
    shotMap: z
      .array(
        z.object({
          shotId: z.string(),
          sceneId: z.string(),
          sectionIndex: z.number().int().nonnegative(),
        })
      )
      .optional(),
  })
  .strict();

const CAPABILITY = Object.freeze({
  providerId: "seedance",
  adapterVersion: ADAPTER_VERSION,
  capabilityId: "animation-video-generation",
  capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requiredProviderFeatures: ["LOOKUP"],
  nativeIdempotency: true,
  lookup: true,
  cancellation: true,
  callbacks: false,
  streaming: false,
  routing: {
    costClass: "MEDIUM",
    estimatedCostUsd: 0.35,
    latencyClass: "SLOW",
    qualityClass: "HIGH",
    reliabilityClass: "HIGH",
    regions: [],
    modelFamilies: ["seedance"],
    sensitiveDataAllowed: false,
    externalProcessing: true,
    trainingOptOut: true,
    zeroRetention: false,
    enterpriseControls: false,
  },
} satisfies ProviderCapabilityDeclaration);

function apiConfigured(): boolean {
  return Boolean(process.env.SEEDANCE_API_KEY?.trim());
}

function baseUrl(): string {
  return process.env.SEEDANCE_API_BASE_URL?.trim() || DEFAULT_BASE;
}

function mapError(error: unknown): ProviderAdapterError {
  const message =
    error instanceof Error ? error.message.slice(0, 500) : "Seedance request failed";
  let kind: ProviderErrorKind = "TERMINAL_FAILURE";
  if (/timeout|timed out/i.test(message)) kind = "TIMEOUT_UNKNOWN";
  if (/429|rate/i.test(message)) kind = "RATE_LIMITED";
  if (/401|403|auth/i.test(message)) kind = "AUTHENTICATION_FAILURE";
  if (/5\d\d|unavailable|network/i.test(message)) kind = "PROVIDER_UNAVAILABLE";
  return new ProviderAdapterError(
    createProviderError(kind, {
      code: `SEEDANCE_${kind}`,
      message,
      safeDetails: { providerId: "seedance" },
    }),
    { cause: error }
  );
}

async function seedanceFetch(
  path: string,
  init: RequestInit
): Promise<Response> {
  if (!apiConfigured()) {
    throw new Error("SEEDANCE_API_KEY is not configured");
  }
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.SEEDANCE_API_KEY!.trim()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export class SeedanceVideoAdapter implements ProviderAdapter {
  readonly providerId = "seedance";
  readonly adapterVersion = ADAPTER_VERSION;

  constructor(private readonly payloadResolver: ProviderPayloadResolver) {}

  capabilities(): ReadonlySet<ProviderCapabilityDeclaration> {
    // Availability: undeclared when key missing so router cannot select it.
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
      const createRes = await seedanceFetch("/generations", {
        method: "POST",
        body: JSON.stringify({
          prompt: payload.prompt,
          negative_prompt: payload.negativePrompt,
          duration: payload.durationSec ?? 5,
          aspect_ratio: payload.aspectRatio ?? "9:16",
          idempotency_key: request.executionIdentity.idempotencyKey,
          // Referenced Campaign Assets — animate existing product photos; do not invent product imagery.
          reference_assets: (payload.assetReferences ?? []).map((a) => ({
            asset_id: a.assetId,
            uri: a.storagePath,
            role: a.role,
          })),
          identity_constraints: payload.identityConstraints ?? [],
          shot_map: payload.shotMap ?? [],
        }),
      });
      if (!createRes.ok) {
        throw new Error(`Seedance create failed (${createRes.status})`);
      }
      const created = (await createRes.json()) as {
        id?: string;
        status?: string;
        video_url?: string;
        output_url?: string;
      };
      const providerRequestId = created.id;
      if (!providerRequestId) throw new Error("Seedance create returned no id");

      let status = created.status ?? "queued";
      let videoUrl = created.video_url ?? created.output_url;
      const deadline = Date.parse(context.timeoutDeadline);
      while (!videoUrl && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const lookup = await this.lookup(providerRequestId, context);
        if (lookup.status === "SUCCEEDED") {
          const out = lookup.result?.normalizedOutput as
            | { videoUrl?: string }
            | undefined;
          videoUrl = out?.videoUrl;
          status = "succeeded";
          break;
        }
        if (lookup.status === "FAILED") {
          throw new Error(lookup.error.message);
        }
        status = lookup.status === "RUNNING" ? "running" : status;
      }
      if (!videoUrl) {
        throw new Error("Seedance execution timed out before video URL");
      }

      const normalizedOutput = {
        mediaKind: "video" as const,
        videoUrl,
        providerRequestId,
        status,
        outputIndex: payload.outputIndex ?? 0,
      };
      return validateCanonicalProviderResult({
        contractVersion: "1",
        executionId: request.executionIdentity.executionId,
        providerAttemptId: context.providerAttemptId,
        normalizedOutput,
        resultReference: `provider-result://seedance/${providerRequestId}`,
        warnings: [],
        providerMetadata: {
          providerId: "seedance",
          providerVersion: "seedance-v1",
        },
        usage: {},
        cost: { amount: 0.35, currency: "USD", estimated: true },
        modelVersion: "seedance",
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
      const res = await seedanceFetch(`/generations/${providerRequestId}`, {
        method: "GET",
      });
      if (res.status === 404) return { status: "NOT_FOUND" };
      if (!res.ok) return { status: "UNKNOWN" };
      const body = (await res.json()) as {
        status?: string;
        video_url?: string;
        output_url?: string;
        error?: string;
      };
      const status = (body.status ?? "").toLowerCase();
      if (["failed", "error"].includes(status)) {
        return {
          status: "FAILED",
          providerRequestId,
          error: createProviderError("TERMINAL_FAILURE", {
            code: "SEEDANCE_FAILED",
            message: body.error ?? "Seedance generation failed",
          }),
        };
      }
      const videoUrl = body.video_url ?? body.output_url;
      if (videoUrl && ["succeeded", "completed", "ready"].includes(status)) {
        return {
          status: "SUCCEEDED",
          providerRequestId,
          result: {
            contractVersion: "1",
            executionId: "lookup",
            providerAttemptId: "lookup",
            normalizedOutput: { videoUrl, mediaKind: "video" },
            resultReference: `provider-result://seedance/${providerRequestId}`,
            warnings: [],
            providerMetadata: {
              providerId: "seedance",
              providerVersion: "seedance-v1",
            },
            usage: {},
            cost: { amount: 0, currency: "USD", estimated: true },
            modelVersion: "seedance",
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

  async cancel(
    providerRequestId: string,
    _context: ProviderExecutionContext
  ): Promise<ProviderCancelResult> {
    try {
      const res = await seedanceFetch(`/generations/${providerRequestId}/cancel`, {
        method: "POST",
      });
      if (res.status === 404) return { status: "UNKNOWN" };
      if (!res.ok) return { status: "UNKNOWN" };
      return { status: "CANCELLATION_REQUESTED", providerRequestId };
    } catch {
      return { status: "UNSUPPORTED" };
    }
  }
}

/** Declaration used by tests/docs when API key is present. */
export const SEEDANCE_VIDEO_CAPABILITY = CAPABILITY;
