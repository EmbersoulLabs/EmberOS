export const DEFAULT_VISION_ANALYSIS_TIMEOUT_MS = 180_000;

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 15 * 60_000;

export function getVisionAnalysisTimeoutMs(
  raw = process.env.VISION_ANALYSIS_TIMEOUT_MS
): number {
  if (!raw?.trim()) return DEFAULT_VISION_ANALYSIS_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) {
    throw new Error(
      `VISION_ANALYSIS_TIMEOUT_MS must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`
    );
  }
  return Math.floor(parsed);
}

export class VisionAnalysisTimeoutError extends Error {
  readonly code = "VISION_ANALYSIS_TIMEOUT";
  readonly retryable = true;
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(
      `Vision analysis timed out after ${Math.ceil(timeoutMs / 1000)} seconds. ` +
        "Your upload is preserved. Retry generation when the provider is available."
    );
    this.name = "VisionAnalysisTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function isVisionAnalysisTimeoutError(
  error: unknown
): error is VisionAnalysisTimeoutError {
  return (
    error instanceof VisionAnalysisTimeoutError ||
    (error instanceof Error &&
      "code" in error &&
      (error as Error & { code?: string }).code === "VISION_ANALYSIS_TIMEOUT")
  );
}

function isProviderTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String((error as Error & { code?: unknown }).code ?? "") : "";
  return (
    /timeout/i.test(error.name) ||
    /timed?\s*out/i.test(error.message) ||
    ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(code)
  );
}

/** Enforces a wall-clock deadline and asks cancellation-aware providers to abort. */
export async function withVisionAnalysisTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = getVisionAnalysisTimeoutMs()
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new VisionAnalysisTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timedOut]);
  } catch (error) {
    if (isVisionAnalysisTimeoutError(error)) throw error;
    if (controller.signal.aborted || isProviderTimeoutError(error)) {
      throw new VisionAnalysisTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
