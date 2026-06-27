import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { desc, ilike, or, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });
config({ path: resolve(__dirname, "../../../.env.local") });

const nameFilter = process.argv[2] ?? "bouquet";

const db = getDb();
const campaigns = await db
  .select()
  .from(schema.campaigns)
  .where(
    or(
      ilike(schema.campaigns.name, `%${nameFilter}%`),
      ilike(schema.campaigns.name, "%portfolio%"),
      ilike(schema.campaigns.name, "%florist%")
    )
  )
  .orderBy(desc(schema.campaigns.createdAt))
  .limit(3);

for (const c of campaigns) {
  console.log("\n=== CAMPAIGN ===");
  console.log(JSON.stringify({
    id: c.id,
    name: c.name,
    goal: c.goal,
    campaignGoal: c.campaignGoal,
    industry: c.industry,
    status: c.status,
    metadata: c.metadata,
    strategyProduct: (c.strategyJson as { product?: string; marketingGoal?: string; marketingAngle?: string } | null)?.product,
    strategyGoal: (c.strategyJson as { marketingGoal?: string } | null)?.marketingGoal,
    strategyAngle: (c.strategyJson as { marketingAngle?: string } | null)?.marketingAngle,
  }, null, 2));

  const tasks = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.campaignId, c.id))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(1);

  const assets = await db
    .select({ type: schema.assets.type, durationSec: schema.assets.durationSec, width: schema.assets.width, height: schema.assets.height })
    .from(schema.assets)
    .where(eq(schema.assets.campaignId, c.id));

  for (const t of tasks) {
    const progress = (t.stepProgress ?? {}) as Record<string, { output?: unknown }>;
    const vision = progress.vision_analyze?.output as {
      subjects?: string[];
      products?: { name: string }[];
      confidence?: number;
      scenes?: { description: string }[];
    } | undefined;
    const content = progress.content_generate?.output as { hooks?: { text: string; type: string }[]; voiceScripts?: Record<string, string> } | undefined;
    const hooksJson = t.hooksJson as { hooks?: { text: string }[] } | null;
    const copyOut = progress.copy_generate?.output as { hook?: string; body?: string }[] | undefined;

    const isFallback =
      vision?.confidence === 0.65 &&
      (vision?.subjects?.includes("product showcase") || vision?.subjects?.includes("产品展示"));

    console.log("\n--- TASK ---");
    console.log(JSON.stringify({
      taskId: t.id,
      status: t.status,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
      assetCount: assets.length,
      assets: assets.map((a) => ({ type: a.type, durationSec: a.durationSec, width: a.width, height: a.height })),
      visionConfidence: vision?.confidence,
      visionIsFallback: isFallback,
      hooksJson: hooksJson?.hooks?.map((h) => h.text),
      visionSubjects: vision?.subjects,
      visionProducts: vision?.products,
      visionScenes: vision?.scenes?.slice(0, 2).map((s) => s.description),
      contentHooks: content?.hooks?.slice(0, 4).map((h) => ({ type: h.type, text: h.text })),
      voice15: content?.voiceScripts?.["15s"],
      copyClip0: Array.isArray(copyOut?.[0]) ? copyOut?.[0]?.map((v: { hook?: string; body?: string; locale?: string }) => ({ locale: v.locale, hook: v.hook, body: v.body?.slice(0, 120) })) : copyOut,
    }, null, 2));
  }
}

process.exit(0);
