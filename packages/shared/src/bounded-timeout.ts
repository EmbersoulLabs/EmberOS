export const AI_STORY_REVIEW_TIMEOUT_MS = 20_000;
export const REVIEW_TIMEOUT_CODE = "REVIEW_TIMEOUT" as const;

export class BoundedTimeoutError extends Error {
  readonly code = REVIEW_TIMEOUT_CODE;
  readonly status = 504;

  constructor(message = "Review did not complete within the bounded timeout") {
    super(message);
    this.name = "BoundedTimeoutError";
  }
}

export async function withBoundedTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number = AI_STORY_REVIEW_TIMEOUT_MS,
  message?: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new BoundedTimeoutError(message));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
