/**
 * Sprint 3 PR 3.4A — Seedance / BytePlus ModelArk HTTP client.
 *
 * Official contract (ModelArk Video Generation API, ap-southeast):
 * - API root: {baseUrl}/api/v3  (baseUrl may already include /api/v3)
 * - Create: POST /contents/generations/tasks
 * - Lookup: GET  /contents/generations/tasks/{id}
 *
 * Never logs credentials or raw Authorization headers.
 */
import { createHash } from "node:crypto";
import type { SeedanceAdapterConfig } from "./seedance-config";
import type { SeedanceModelArkCreateRequest } from "./seedance-request-mapping";

export const SEEDANCE_MODELARK_API_VERSION = "v3" as const;
export const SEEDANCE_CREATE_PATH = "/contents/generations/tasks" as const;
export const SEEDANCE_LOOKUP_PATH_PREFIX =
  "/contents/generations/tasks" as const;

/**
 * Response headers safe to retain as diagnostic evidence. Allowlisted so that
 * Set-Cookie, Authorization echoes and other credential-bearing headers can
 * never be read out of a Provider response.
 */
export const SEEDANCE_DIAGNOSTIC_TRACE_HEADERS: ReadonlyArray<string> = [
  "x-request-id",
  "x-tt-logid",
  "x-tt-trace-id",
  "x-amzn-requestid",
  "x-amz-request-id",
  "request-id",
  "x-trace-id",
];

export type SeedanceHttpResponse = {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
  /**
   * SHA-256 of the exact response body bytes as text. The raw body is never
   * retained; only this hash is durable.
   *
   * Optional so pre-existing clients and harnesses remain valid; callers fall
   * back to a canonical hash of the parsed body when it is absent.
   */
  readonly bodyHash?: string;
  /** Provider request/trace id from the allowlisted headers, when present. */
  readonly traceId?: string;
};

/** `sha256:<hex>` over the literal response text, matching persistence hashes. */
export function seedanceResponseBodyHash(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function readTraceHeader(response: Response): string | undefined {
  for (const header of SEEDANCE_DIAGNOSTIC_TRACE_HEADERS) {
    const value = response.headers?.get?.(header);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export type SeedanceHttpClient = {
  createGeneration(
    request: SeedanceModelArkCreateRequest
  ): Promise<SeedanceHttpResponse>;
  getGeneration(providerRequestId: string): Promise<SeedanceHttpResponse>;
};

export type SeedanceFetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export class SeedanceHttpTransportError extends Error {
  readonly code = "SEEDANCE_HTTP_TRANSPORT_ERROR";
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "SeedanceHttpTransportError";
  }
}

/**
 * Normalize configured host to ModelArk API root.
 * Accepts either `https://ark…bytepluses.com` or `…/api/v3`.
 */
export function resolveSeedanceModelArkApiRoot(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new SeedanceHttpTransportError("Seedance baseUrl is empty");
  }
  if (/\/api\/v3$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/api/v3`;
}

function sanitizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function createSeedanceHttpClient(input: {
  readonly config: SeedanceAdapterConfig;
  readonly fetchImpl?: SeedanceFetch;
}): SeedanceHttpClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const { config } = input;
  const apiRoot = resolveSeedanceModelArkApiRoot(config.baseUrl);

  async function request(
    path: string,
    init: RequestInit
  ): Promise<SeedanceHttpResponse> {
    const url = `${apiRoot}${sanitizePath(path)}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 200) : "network failure";
      throw new SeedanceHttpTransportError(`Seedance transport failed: ${message}`);
    }

    let body: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = { raw: "[non-json]" };
      }
    }
    const traceId = readTraceHeader(response);
    return {
      status: response.status,
      ok: response.ok,
      body,
      bodyHash: seedanceResponseBodyHash(text),
      ...(traceId ? { traceId } : {}),
    };
  }

  return {
    async createGeneration(generationRequest) {
      return request(SEEDANCE_CREATE_PATH, {
        method: "POST",
        body: JSON.stringify(generationRequest),
      });
    },
    async getGeneration(providerRequestId) {
      const encoded = encodeURIComponent(providerRequestId);
      return request(`${SEEDANCE_LOOKUP_PATH_PREFIX}/${encoded}`, {
        method: "GET",
      });
    },
  };
}
