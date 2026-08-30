import { NextRequest } from "next/server";
import { GET as runDbRoundtripBaseline } from "@/app/api/admin/internal/db-roundtrip-baseline/route";

export const dynamic = "force-dynamic";

export default async function DbRoundtripBaselinePage({
  searchParams,
}: {
  searchParams: { mode?: string; sequence?: string };
}) {
  const mode = searchParams.mode ?? "no-db";
  const request = new NextRequest(
    `https://emberos.internal/api/admin/internal/db-roundtrip-baseline?mode=${encodeURIComponent(mode)}`
  );
  const response = await runDbRoundtripBaseline(request);
  const body = await response.json();
  return (
    <main style={{ padding: 24 }}>
      <h1>Database round-trip baseline</h1>
      <pre data-testid="db-roundtrip-baseline-result">
        {JSON.stringify({ status: response.status, sequence: searchParams.sequence ?? null, body })}
      </pre>
    </main>
  );
}
