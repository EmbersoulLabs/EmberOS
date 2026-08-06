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
import type { SeedanceAdapterConfig } from "./seedance-config";
import type { SeedanceModelArkCreateRequest } from "./seedance-request-mapping";

export const SEEDANCE_MODELARK_API_VERSION = "v3" as const;
export const SEEDANCE_CREATE_PATH = "/contents/generations/tasks" as const;
export const SEEDANCE_LOOKUP_PATH_PREFIX =
  "/contents/generations/tasks" as const;

export type SeedanceHttpResponse = {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
};

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
    return {
      status: response.status,
      ok: response.ok,
      body,
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
