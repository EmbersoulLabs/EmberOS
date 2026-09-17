import http from "node:http";
import https from "node:https";

const blockedTargets: string[] = [];
const originalFetch = globalThis.fetch;
const originalHttpRequest = http.request;
const originalHttpGet = http.get;
const originalHttpsRequest = https.request;
const originalHttpsGet = https.get;
let installed = false;

function targetHost(input: unknown): string {
  if (input instanceof URL) return input.hostname;
  if (typeof input === "string") return new URL(input).hostname;
  if (input && typeof input === "object") {
    const candidate = input as { url?: string; hostname?: string; host?: string };
    if (candidate.url) return new URL(candidate.url).hostname;
    return candidate.hostname ?? candidate.host ?? "";
  }
  return "";
}

export function assertLocalTestNetworkTarget(input: unknown): void {
  const rawHost = targetHost(input).toLowerCase();
  const host = rawHost === "::1" || rawHost === "[::1]" || rawHost.startsWith("[::1]:")
    ? "::1"
    : rawHost.split(":")[0];
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return;
  blockedTargets.push(host || "unknown");
  throw new Error("NETWORK_CALL_BLOCKED_BY_TEST_HARNESS");
}

export function blockedExternalNetworkAttempts(): readonly string[] {
  return blockedTargets;
}

export function installCertificationNetworkIsolation(): () => void {
  if (installed) return () => {};
  installed = true;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    assertLocalTestNetworkTarget(input);
    return originalFetch(input, init);
  }) as typeof fetch;
  http.request = ((...args: Parameters<typeof http.request>) => {
    assertLocalTestNetworkTarget(args[0]);
    return originalHttpRequest(...args);
  }) as typeof http.request;
  http.get = ((...args: Parameters<typeof http.get>) => {
    assertLocalTestNetworkTarget(args[0]);
    return originalHttpGet(...args);
  }) as typeof http.get;
  https.request = ((...args: Parameters<typeof https.request>) => {
    assertLocalTestNetworkTarget(args[0]);
    return originalHttpsRequest(...args);
  }) as typeof https.request;
  https.get = ((...args: Parameters<typeof https.get>) => {
    assertLocalTestNetworkTarget(args[0]);
    return originalHttpsGet(...args);
  }) as typeof https.get;
  return () => {
    installed = false;
    globalThis.fetch = originalFetch;
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    https.request = originalHttpsRequest;
    https.get = originalHttpsGet;
  };
}
