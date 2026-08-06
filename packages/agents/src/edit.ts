import type {
  CampaignAIContext,
  CopyVariant,
  EditPlan,
  PresetProfile,
  VisionAnalysis,
} from "@ceo-agent/shared";
import { buildMontageEditPlan } from "./motion-compose";

/**
 * Edit Director — AD-001
 * Required: campaignContext, copyVariants, preset, assetId, durationSec
 * Optional: vision (prefer context.vision), campaignName
 * Consumes from context: campaignObjective (goal), vision
 */
export interface EditInput {
  campaignContext: CampaignAIContext;
  vision?: VisionAnalysis;
  copyVariants: CopyVariant[];
  preset: PresetProfile;
  assetId: string;
  durationSec: number;
  campaignName?: string;
}

export async function runEditDirectorAgent(input: EditInput): Promise<{
  editPlan: EditPlan;
  usage: { input: number; output: number; costUsd: number };
}> {
  const vision = input.vision ?? input.campaignContext.vision;
  if (!vision) {
    throw new Error("Edit Director requires vision on CampaignAIContext");
  }

  const editPlan = buildMontageEditPlan({
    vision,
    preset: input.preset,
    copyVariants: input.copyVariants,
    assetId: input.assetId,
    sourceDurationSec: input.durationSec,
  });

  return { editPlan, usage: { input: 0, output: 0, costUsd: 0 } };
}
