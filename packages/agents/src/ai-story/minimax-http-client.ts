/**
 * Sprint 3 PR 3.4B — MiniMax Video Generation V2 HTTP client.
 *
 * Official contract (platform.minimax.io):
 * - API root: {baseUrl}/v2  (baseUrl may already include /v2)
 * - Create: POST /video_generation
 * - Lookup: GET  /query/video_generation/{task_id}
 * - Auth: Authorization: Bearer {apiKey}
 *
 * Never logs credentials or raw Authorization headers.
 */
import type { MinimaxAdapterConfig } from "./minimax-config";
import type { MinimaxVideoV2CreateRequest } from "./minimax-request-mapping";

export const MINIMAX_VIDEO_API_VERSION = "v2" as const;
export const MINIMAX_CREATE_PATH = "/video_generation" as const;
export const MINIMAX_LOOKUP_PATH_PREFIX = "/query/video_generation" as const;

export type MinimaxHttpResponse = {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
};

export type MinimaxHttpClient = {
  createGeneration(
    request: MinimaxVideoV2CreateRequest
  ): Promise<MinimaxHttpResponse>;
  getGeneration(providerRequestId: string): Promise<MinimaxHttpResponse>;
};

export type MinimaxFetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export class MinimaxHttpTransportError extends Error {
  readonly code = "MINIMAX_HTTP_TRANSPORT_ERROR";
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "MinimaxHttpTransportError";
  }
}

/**
 * Normalize configured host to MiniMax Video V2 API root.
 * Accepts either `https://api.minimax.io` or `…/v2`.
 */
export function resolveMinimaxVideoV2ApiRoot(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new MinimaxHttpTransportError("MiniMax baseUrl is empty");
  }
  if (/\/v2$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/v2`;
}

function sanitizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function createMinimaxHttpClient(input: {
  readonly config: MinimaxAdapterConfig;
  readonly fetchImpl?: MinimaxFetch;
}): MinimaxHttpClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const { config } = input;
  const apiRoot = resolveMinimaxVideoV2ApiRoot(config.baseUrl);

  async function request(
    path: string,
    init: RequestInit
  ): Promise<MinimaxHttpResponse> {
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
      throw new MinimaxHttpTransportError(`MiniMax transport failed: ${message}`);
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
      return request(MINIMAX_CREATE_PATH, {
        method: "POST",
        body: JSON.stringify(generationRequest),
      });
    },
    async getGeneration(providerRequestId) {
      const encoded = encodeURIComponent(providerRequestId);
      return request(`${MINIMAX_LOOKUP_PATH_PREFIX}/${encoded}`, {
        method: "GET",
      });
    },
  };
}
