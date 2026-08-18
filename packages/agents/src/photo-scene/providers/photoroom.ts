import { PhotoSceneExtractionError } from "@ceo-agent/shared";
import { validateExtractedPng } from "../png";
import type {
  BackgroundRemovalInput,
  BackgroundRemovalOutput,
  BackgroundRemovalProvider,
} from "../background-removal";
import {
  PHOTOROOM_SEGMENT_URL,
  isAbortTimeout,
  mapPhotoroomHttpStatus,
  photoroomConfiguredCostUsd,
  providerTimeoutMs,
} from "./photoroom-config";

export type PhotoroomFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: Buffer;
    signal: AbortSignal;
  }
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

function extensionForMime(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

function multipartBody(input: BackgroundRemovalInput): { body: Buffer; contentType: string } {
  const boundary = `----EmberOSPhotoScene${Date.now().toString(16)}`;
  const ext = extensionForMime(input.mimeType);
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="image_file"; filename="source.${ext}"\r\n` +
      `Content-Type: ${input.mimeType || "application/octet-stream"}\r\n\r\n`,
    "utf8"
  );
  const fields = Buffer.from(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\npng` +
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="channels"\r\n\r\nrgba` +
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\nfull` +
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="crop"\r\n\r\nfalse` +
      `\r\n--${boundary}--\r\n`,
    "utf8"
  );
  return {
    body: Buffer.concat([header, input.bytes, fields]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function redactedProviderMessage(status: number): string {
  return `Background removal provider rejected the request (${status})`;
}

export class PhotoroomBackgroundRemovalProvider implements BackgroundRemovalProvider {
  readonly key = "photoroom";

  constructor(
    private readonly options: {
      apiKey: string;
      timeoutMs?: number;
      costUsd?: number;
      fetchImpl?: PhotoroomFetch;
      endpoint?: string;
    }
  ) {
    if (!options.apiKey.trim()) {
      throw new PhotoSceneExtractionError(
        "PROVIDER_UNAVAILABLE",
        "Background removal provider is not configured"
      );
    }
  }

  async removeBackground(input: BackgroundRemovalInput): Promise<BackgroundRemovalOutput> {
    const timeoutMs = this.options.timeoutMs ?? providerTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const { body, contentType } = multipartBody(input);
    const fetchImpl =
      this.options.fetchImpl ??
      (async (url, init) => {
        const response = await fetch(url, {
          method: init.method,
          headers: init.headers,
          body: new Uint8Array(init.body),
          signal: init.signal,
        });
        return {
          status: response.status,
          headers: response.headers,
          arrayBuffer: () => response.arrayBuffer(),
        };
      });
    try {
      const response = await fetchImpl(this.options.endpoint ?? PHOTOROOM_SEGMENT_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.options.apiKey,
          "Content-Type": contentType,
        },
        body,
        signal: controller.signal,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.status < 200 || response.status >= 300) {
        throw new PhotoSceneExtractionError(
          mapPhotoroomHttpStatus(response.status),
          redactedProviderMessage(response.status)
        );
      }
      const validated = validateExtractedPng(bytes);
      return {
        bytes,
        mimeType: "image/png",
        width: validated.width,
        height: validated.height,
        costUsd: this.options.costUsd ?? photoroomConfiguredCostUsd(),
        providerKey: this.key,
      };
    } catch (err) {
      if (err instanceof PhotoSceneExtractionError) throw err;
      if (isAbortTimeout(err)) {
        throw new PhotoSceneExtractionError(
          "PROVIDER_UNAVAILABLE",
          "Background removal provider timed out"
        );
      }
      throw new PhotoSceneExtractionError(
        "PROVIDER_UNAVAILABLE",
        "Background removal provider is unavailable"
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createPhotoroomProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: PhotoroomFetch
): PhotoroomBackgroundRemovalProvider {
  const apiKey = (env.PHOTOROOM_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new PhotoSceneExtractionError(
      "PROVIDER_UNAVAILABLE",
      "Background removal provider is not configured"
    );
  }
  return new PhotoroomBackgroundRemovalProvider({
    apiKey,
    timeoutMs: providerTimeoutMs(env),
    costUsd: photoroomConfiguredCostUsd(env),
    fetchImpl,
  });
}
