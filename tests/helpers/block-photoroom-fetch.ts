/**
 * Blocks Photoroom HTTP for zero-paid-API certification.
 * Import this module first in the runtime cert.
 */
const originalFetch = globalThis.fetch.bind(globalThis);
let photoroomNetworkCallCount = 0;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  if (/photoroom\.com/i.test(url)) {
    photoroomNetworkCallCount += 1;
    throw new Error("BLOCKED_ZERO_PAID_API_SAFETY");
  }
  return originalFetch(input, init);
}) as typeof fetch;

export function getPhotoroomNetworkCallCount(): number {
  return photoroomNetworkCallCount;
}
