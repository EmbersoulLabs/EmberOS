import { createCampaignFromContext, getDb } from "@ceo-agent/db";
import type { CreateCampaignContext } from "@ceo-agent/shared";
import { executeCampaignGenerate } from "@/lib/campaign-generate";

export type CreateCampaignWorkflowResult =
  | {
      ok: true;
      campaignId: string;
      taskId: string;
      taskStatus: string;
      campaignReused: boolean;
      taskReused: boolean;
    }
  | {
      ok: false;
      campaignId: string;
      campaignReused: boolean;
      error: string;
      code: string;
      status: number;
    };

/**
 * Canonical Wave 3 command: create/reuse one Campaign, then bind it to main's
 * existing idempotent Campaign run identity. Provider execution stays downstream.
 */
export async function createCampaignAndStartWorkflow(input: {
  orgId: string;
  userId: string;
  context: CreateCampaignContext;
}): Promise<CreateCampaignWorkflowResult> {
  const db = getDb();
  const created = await createCampaignFromContext(db, input);
  const run = await executeCampaignGenerate(db, created.campaign, input.userId, {
    contentLocale: input.context.inferredLanguage,
  });
  if (!run.ok) {
    return {
      ok: false,
      campaignId: created.campaign.id,
      campaignReused: created.reused,
      error: run.error,
      code: run.code,
      status: run.status,
    };
  }
  return {
    ok: true,
    campaignId: created.campaign.id,
    taskId: run.taskId,
    taskStatus: run.status,
    campaignReused: created.reused,
    taskReused: run.reused,
  };
}
