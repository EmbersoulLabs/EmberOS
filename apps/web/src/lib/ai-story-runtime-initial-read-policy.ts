/** V1 read policy: one mount read; additional reads require an explicit caller action. */
export const INITIAL_RUNTIME_READ_ATTEMPTS = 1;

export async function readInitialRuntimeOnce<T>(read: () => Promise<T>): Promise<T> {
  return read();
}

export async function readRuntimeAfterUserRetry<T>(read: () => Promise<T>): Promise<T> {
  return read();
}
