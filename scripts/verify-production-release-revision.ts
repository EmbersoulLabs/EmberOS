async function main(): Promise<void> {
  const expected =
    process.argv[2]?.trim() ||
    process.env.EXPECTED_EMBEROS_RELEASE_REVISION?.trim();
  const origin =
    process.argv[3]?.trim() || process.env.EMBEROS_PRODUCTION_ORIGIN?.trim();

  if (!expected) throw new Error("Expected release revision is required");
  if (!origin) throw new Error("Production origin is required");

  const response = await fetch(new URL("/api/health", origin));
  if (!response.ok) {
    throw new Error(`Production health failed with HTTP ${response.status}`);
  }
  const body = (await response.json()) as { releaseRevision?: unknown };
  if (typeof body.releaseRevision !== "string" || !body.releaseRevision.trim()) {
    throw new Error("CERT_RELEASE_REVISION_MISSING");
  }
  if (body.releaseRevision !== expected) {
    throw new Error(
      `CERT_RELEASE_REVISION_MISMATCH expected=${expected} actual=${body.releaseRevision}`
    );
  }
  console.log(
    JSON.stringify({
      status: "PASS",
      releaseRevision: body.releaseRevision,
    })
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Release verification failed");
  process.exitCode = 1;
});
