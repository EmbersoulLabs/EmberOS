/**
 * Agency pilot metrics — approval rate, resubmit rate, campaign funnel.
 *
 * Usage:
 *   pnpm pilot:metrics -- --list
 *   pnpm pilot:metrics -- --slug my-client-workspace
 *   pnpm pilot:metrics -- --workspace-id <uuid> --since 2026-06-01
 *   pnpm pilot:metrics -- --slug my-client --json
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  evaluatePilotMetrics,
  pilotPhase1Ready,
  pct,
  type PilotMetricCheck,
} from "@ceo-agent/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../apps/web/.env.local") });
config({ path: resolve(__dirname, "../apps/worker/.env") });

type Args = {
  list: boolean;
  slug?: string;
  workspaceId?: string;
  since?: string;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { list: false, json: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") args.list = true;
    else if (arg === "--slug") args.slug = argv[++i];
    else if (arg === "--workspace-id") args.workspaceId = argv[++i];
    else if (arg === "--since") args.since = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(`
Agency pilot metrics (Phase 1)

  pnpm pilot:metrics -- --list
  pnpm pilot:metrics -- --slug <workspace-slug>
  pnpm pilot:metrics -- --workspace-id <uuid> --since 2026-06-01
  pnpm pilot:metrics -- --slug <slug> --json

Targets (PLAN_PROMPT.md):
  • Internal first-pass approval ≥ 70%
  • Resubmit rate ≤ 30% (proxy for manual copy rework)

Options:
  --list            List all workspaces
  --slug <slug>     Pilot workspace slug
  --workspace-id    Pilot workspace UUID (alternative to --slug)
  --since <date>    Only reviews decided on/after YYYY-MM-DD
  --json            Machine-readable output
`);
      process.exit(0);
    }
  }

  return args;
}

function parseSince(since?: string): Date | null {
  if (!since) return null;
  const d = new Date(since);
  if (Number.isNaN(d.getTime())) {
    console.error(`[pilot:metrics] Invalid --since date: ${since}`);
    process.exit(1);
  }
  return d;
}

function verdictIcon(v: PilotMetricCheck["verdict"]): string {
  if (v === "pass") return "✓";
  if (v === "fail") return "✗";
  return "—";
}

async function listWorkspaces(sql: postgres.Sql) {
  const rows = await sql<
    {
      id: string;
      name: string;
      slug: string;
      org_name: string;
      campaign_count: number;
      review_count: number;
    }[]
  >`
    SELECT
      w.id,
      w.name,
      w.slug,
      o.name AS org_name,
      (SELECT COUNT(*)::int FROM campaigns c WHERE c.workspace_id = w.id) AS campaign_count,
      (SELECT COUNT(*)::int FROM reviews r WHERE r.workspace_id = w.id) AS review_count
    FROM workspaces w
    JOIN organizations o ON o.id = w.org_id
    ORDER BY o.name, w.name
  `;

  if (rows.length === 0) {
    console.log("No workspaces found.");
    return;
  }

  console.log("Workspaces:\n");
  for (const w of rows) {
    console.log(`  ${w.slug}`);
    console.log(`    name:     ${w.name}`);
    console.log(`    org:      ${w.org_name}`);
    console.log(`    id:       ${w.id}`);
    console.log(`    campaigns: ${w.campaign_count}  reviews: ${w.review_count}`);
    console.log("");
  }
}

async function loadWorkspace(sql: postgres.Sql, args: Args) {
  if (args.workspaceId) {
    const [row] = await sql<
      { id: string; name: string; slug: string; org_name: string }[]
    >`
      SELECT w.id, w.name, w.slug, o.name AS org_name
      FROM workspaces w
      JOIN organizations o ON o.id = w.org_id
      WHERE w.id = ${args.workspaceId}::uuid
      LIMIT 1
    `;
    return row ?? null;
  }

  if (args.slug) {
    const [row] = await sql<
      { id: string; name: string; slug: string; org_name: string }[]
    >`
      SELECT w.id, w.name, w.slug, o.name AS org_name
      FROM workspaces w
      JOIN organizations o ON o.id = w.org_id
      WHERE w.slug = ${args.slug}
      LIMIT 1
    `;
    return row ?? null;
  }

  return null;
}

async function reportMetrics(sql: postgres.Sql, workspaceId: string, since: Date | null) {
  const reviewFilter = since
    ? sql`AND (r.decided_at IS NULL OR r.decided_at >= ${since})`
    : sql``;

  const decidedFilter = since
    ? sql`AND r.decided_at >= ${since}`
    : sql``;

  const [internalFirstPass] = await sql<
    { approved: number; decided: number }[]
  >`
    WITH first_internal AS (
      SELECT r.decision
      FROM reviews r
      JOIN (
        SELECT creative_id, MIN(created_at) AS first_at
        FROM reviews
        WHERE workspace_id = ${workspaceId}::uuid
          AND reviewer_type = 'internal'
          AND decision IN ('approved', 'rejected')
        GROUP BY creative_id
      ) f ON f.creative_id = r.creative_id AND f.first_at = r.created_at
      WHERE r.workspace_id = ${workspaceId}::uuid
        AND r.reviewer_type = 'internal'
        ${decidedFilter}
    )
    SELECT
      COUNT(*) FILTER (WHERE decision = 'approved')::int AS approved,
      COUNT(*)::int AS decided
    FROM first_internal
  `;

  const [clientFirstPass] = await sql<
    { approved: number; decided: number }[]
  >`
    WITH first_client AS (
      SELECT r.decision
      FROM reviews r
      JOIN (
        SELECT creative_id, MIN(created_at) AS first_at
        FROM reviews
        WHERE workspace_id = ${workspaceId}::uuid
          AND reviewer_type = 'client'
          AND decision IN ('approved', 'rejected')
        GROUP BY creative_id
      ) f ON f.creative_id = r.creative_id AND f.first_at = r.created_at
      WHERE r.workspace_id = ${workspaceId}::uuid
        AND r.reviewer_type = 'client'
        ${decidedFilter}
    )
    SELECT
      COUNT(*) FILTER (WHERE decision = 'approved')::int AS approved,
      COUNT(*)::int AS decided
    FROM first_client
  `;

  const [reviewCycles] = await sql<
    {
      creatives_with_decided_internal: number;
      resubmitted_after_reject: number;
      ever_rejected: number;
    }[]
  >`
    WITH internal_decided AS (
      SELECT DISTINCT creative_id
      FROM reviews
      WHERE workspace_id = ${workspaceId}::uuid
        AND reviewer_type = 'internal'
        AND decision IN ('approved', 'rejected')
        ${decidedFilter}
    ),
    rejections AS (
      SELECT creative_id, MIN(decided_at) AS first_rejected_at
      FROM reviews
      WHERE workspace_id = ${workspaceId}::uuid
        AND decision = 'rejected'
        ${decidedFilter}
      GROUP BY creative_id
    ),
    resubmitted AS (
      SELECT DISTINCT r.creative_id
      FROM rejections rj
      JOIN reviews r ON r.creative_id = rj.creative_id
      WHERE r.workspace_id = ${workspaceId}::uuid
        AND r.created_at > rj.first_rejected_at
    )
    SELECT
      (SELECT COUNT(*)::int FROM internal_decided) AS creatives_with_decided_internal,
      (SELECT COUNT(*)::int FROM resubmitted) AS resubmitted_after_reject,
      (SELECT COUNT(DISTINCT creative_id)::int FROM rejections) AS ever_rejected
  `;

  const reviewBreakdown = await sql<
    { reviewer_type: string; decision: string; count: number }[]
  >`
    SELECT reviewer_type, decision, COUNT(*)::int AS count
    FROM reviews r
    WHERE r.workspace_id = ${workspaceId}::uuid
      ${reviewFilter}
    GROUP BY reviewer_type, decision
    ORDER BY reviewer_type, decision
  `;

  const campaignStatuses = await sql<{ status: string; count: number }[]>`
    SELECT status, COUNT(*)::int AS count
    FROM campaigns
    WHERE workspace_id = ${workspaceId}::uuid
    GROUP BY status
    ORDER BY count DESC
  `;

  const creativeStatuses = await sql<{ status: string; count: number }[]>`
    SELECT status, COUNT(*)::int AS count
    FROM creatives
    WHERE workspace_id = ${workspaceId}::uuid
    GROUP BY status
    ORDER BY count DESC
  `;

  const [portalStats] = await sql<
    { invites_total: number; invites_used: number; invites_active: number }[]
  >`
    SELECT
      COUNT(*)::int AS invites_total,
      COUNT(*) FILTER (WHERE used_at IS NOT NULL)::int AS invites_used,
      COUNT(*) FILTER (WHERE used_at IS NULL AND expires_at > NOW())::int AS invites_active
    FROM client_invites
    WHERE workspace_id = ${workspaceId}::uuid
  `;

  const checks = evaluatePilotMetrics({
    internalFirstPassApproved: internalFirstPass?.approved ?? 0,
    internalFirstPassDecided: internalFirstPass?.decided ?? 0,
    resubmittedCreatives: reviewCycles?.resubmitted_after_reject ?? 0,
    creativesWithReviews: reviewCycles?.creatives_with_decided_internal ?? 0,
  });

  const clientRate = pct(clientFirstPass?.approved ?? 0, clientFirstPass?.decided ?? 0);
  const rejectEverRate = pct(
    reviewCycles?.ever_rejected ?? 0,
    reviewCycles?.creatives_with_decided_internal ?? 0
  );

  const exportReadyCampaigns =
    campaignStatuses.find((c) => c.status === "export_ready")?.count ?? 0;
  const approvedCampaigns =
    campaignStatuses.find((c) => c.status === "approved")?.count ?? 0;
  const totalCampaigns = campaignStatuses.reduce((s, c) => s + c.count, 0);

  return {
    checks,
    phase1Ready: pilotPhase1Ready(checks),
    internalFirstPass,
    clientFirstPass,
    clientFirstPassRatePct: clientRate,
    reviewCycles,
    rejectEverRatePct: rejectEverRate,
    reviewBreakdown,
    campaignStatuses,
    creativeStatuses,
    portalStats,
    exportReadyCampaigns,
    approvedCampaigns,
    totalCampaigns,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("[pilot:metrics] DATABASE_URL is not set (.env.local or apps/worker/.env)");
    process.exit(1);
  }

  const since = parseSince(args.since);
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    if (args.list) {
      await listWorkspaces(sql);
      return;
    }

    if (!args.slug && !args.workspaceId) {
      console.error("[pilot:metrics] Provide --slug or --workspace-id (or --list). Use --help.");
      process.exit(1);
    }

    const workspace = await loadWorkspace(sql, args);
    if (!workspace) {
      console.error("[pilot:metrics] Workspace not found.");
      process.exit(1);
    }

    const metrics = await reportMetrics(sql, workspace.id, since);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            workspace,
            since: since?.toISOString().slice(0, 10) ?? null,
            ...metrics,
          },
          null,
          2
        )
      );
      return;
    }

    console.log("\nEmberOS Agency Pilot Metrics");
    console.log("═".repeat(40));
    console.log(`Workspace:  ${workspace.name} (${workspace.slug})`);
    console.log(`Org:        ${workspace.org_name}`);
    console.log(`ID:         ${workspace.id}`);
    if (since) console.log(`Since:      ${since.toISOString().slice(0, 10)}`);
    console.log("");

    console.log("Phase 1 targets");
    console.log("─".repeat(40));
    for (const check of metrics.checks) {
      const value =
        check.valuePct === null ? "n/a" : `${check.valuePct.toFixed(1)}%`;
      console.log(
        `  ${verdictIcon(check.verdict)} ${check.label}: ${value} (target ${check.targetLabel})`
      );
      console.log(`      ${check.detail}`);
    }
    console.log("");

    if (metrics.clientFirstPass && metrics.clientFirstPass.decided > 0) {
      console.log("Client portal (first-pass)");
      console.log("─".repeat(40));
      console.log(
        `  First-pass approval: ${metrics.clientFirstPassRatePct?.toFixed(1) ?? "n/a"}% (${metrics.clientFirstPass.approved}/${metrics.clientFirstPass.decided})`
      );
      console.log("");
    }

    console.log("Review activity");
    console.log("─".repeat(40));
    for (const row of metrics.reviewBreakdown) {
      console.log(`  ${row.reviewer_type.padEnd(10)} ${row.decision.padEnd(10)} ${row.count}`);
    }
    if (metrics.reviewCycles) {
      console.log(
        `  Ever rejected:       ${metrics.reviewCycles.ever_rejected}/${metrics.reviewCycles.creatives_with_decided_internal} (${metrics.rejectEverRatePct?.toFixed(1) ?? "n/a"}%)`
      );
      console.log(
        `  Resubmitted (post-reject): ${metrics.reviewCycles.resubmitted_after_reject}`
      );
    }
    console.log("");

    console.log("Campaign funnel");
    console.log("─".repeat(40));
    if (metrics.campaignStatuses.length === 0) {
      console.log("  (no campaigns)");
    } else {
      for (const row of metrics.campaignStatuses) {
        console.log(`  ${row.status.padEnd(28)} ${row.count}`);
      }
    }
    console.log(
      `  Export-ready / approved: ${metrics.exportReadyCampaigns + metrics.approvedCampaigns}/${metrics.totalCampaigns}`
    );
    console.log("");

    console.log("Creative statuses");
    console.log("─".repeat(40));
    if (metrics.creativeStatuses.length === 0) {
      console.log("  (no creatives)");
    } else {
      for (const row of metrics.creativeStatuses) {
        console.log(`  ${row.status.padEnd(28)} ${row.count}`);
      }
    }
    console.log("");

    console.log("Client portal invites");
    console.log("─".repeat(40));
    console.log(`  Total:   ${metrics.portalStats?.invites_total ?? 0}`);
    console.log(`  Used:    ${metrics.portalStats?.invites_used ?? 0}`);
    console.log(`  Active:  ${metrics.portalStats?.invites_active ?? 0}`);
    console.log("");

    console.log("═".repeat(40));
    if (metrics.phase1Ready) {
      console.log("✓ Phase 1 pilot metrics: PASS");
    } else {
      const hasData = metrics.checks.some((c) => c.verdict !== "insufficient_data");
      console.log(
        hasData
          ? "✗ Phase 1 pilot metrics: NOT YET PASS (see targets above)"
          : "— Insufficient review data — run more campaigns through internal review"
      );
    }
    console.log("");
  } catch (err) {
    console.error("[pilot:metrics] Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
