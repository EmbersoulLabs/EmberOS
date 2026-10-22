/** Hostname only. Never return the raw connection string. */
export function redisLogLabel(url: string): string {
  try {
    return new URL(url.replace(/^redis:\/\//, "http://")).hostname || "unparsed";
  } catch {
    return "unparsed";
  }
}
