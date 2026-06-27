import { sql, eq, desc } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";

export async function fetchAdminOverview() {
  const db = getDb();

  const [summaryRow] = await db.execute<{ orgs: string; workspaces: string; campaigns: string; pending_reviews: string; failed_tasks: string }>(sql`
    SELECT
      (SELECT COUNT(*)::text FROM organizations) AS orgs,
      (SELECT COUNT(*)::text FROM workspaces) AS workspaces,
      (SELECT COUNT(*)::text FROM campaigns) AS campaigns,
      (SELECT COUNT(*)::text FROM reviews WHERE decision = 'pending') AS pending_reviews,
      (SELECT COUNT(*)::text FROM tasks WHERE status = 'failed') AS failed_tasks
  `);

  const workspaceRows = await db.execute<{
    id: string;
    name: string;
    slug: string;
    org_name: string;
    campaigns: string;
    pending_reviews: string;
    compliance_failed: string;
  }>(sql`
    SELECT
      w.id,
      w.name,
      w.slug,
      o.name AS org_name,
      (SELECT COUNT(*)::text FROM campaigns c WHERE c.workspace_id = w.id) AS campaigns,
      (SELECT COUNT(*)::text FROM reviews r WHERE r.workspace_id = w.id AND r.decision = 'pending') AS pending_reviews,
      (SELECT COUNT(*)::text FROM creatives cr WHERE cr.workspace_id = w.id AND cr.status = 'compliance_failed') AS compliance_failed
    FROM workspaces w
    JOIN organizations o ON o.id = w.org_id
    ORDER BY o.name, w.name
  `);

  const failedTasks = await db
    .select({
      id: schema.tasks.id,
      campaignId: schema.tasks.campaignId,
      workspaceId: schema.tasks.workspaceId,
      status: schema.tasks.status,
      errorMessage: schema.tasks.errorMessage,
      createdAt: schema.tasks.createdAt,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.status, "failed"))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(10);

  const campaignStatusRows = await db.execute<{ status: string; count: string }>(sql`
    SELECT status, COUNT(*)::text AS count
    FROM campaigns
    GROUP BY status
    ORDER BY COUNT(*) DESC
  `);

  return {
    summary: {
      organizations: Number(summaryRow?.orgs ?? 0),
      workspaces: Number(summaryRow?.workspaces ?? 0),
      campaigns: Number(summaryRow?.campaigns ?? 0),
      pendingReviews: Number(summaryRow?.pending_reviews ?? 0),
      failedTasks: Number(summaryRow?.failed_tasks ?? 0),
    },
    workspaces: workspaceRows.map((w) => ({
      id: w.id,
      name: w.name,
      slug: w.slug,
      orgName: w.org_name,
      campaigns: Number(w.campaigns),
      pendingReviews: Number(w.pending_reviews),
      complianceFailed: Number(w.compliance_failed),
    })),
    campaignStatuses: campaignStatusRows.map((r) => ({
      status: r.status,
      count: Number(r.count),
    })),
    recentFailedTasks: failedTasks.map((t) => ({
      id: t.id,
      campaignId: t.campaignId,
      workspaceId: t.workspaceId,
      errorMessage: t.errorMessage,
      createdAt: t.createdAt?.toISOString() ?? null,
    })),
  };
}
