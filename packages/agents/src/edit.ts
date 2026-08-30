import type { CopyVariant, EditPlan, PresetProfile, VisionAnalysis } from "@ceo-agent/shared";
import { buildMontageEditPlan } from "./motion-compose";

export interface EditInput {
  vision: VisionAnalysis;
  copyVariants: CopyVariant[];
  preset: PresetProfile;
  assetId: string;
  durationSec: number;
  goal?: string;
  campaignName?: string;
}

export async function runEditDirectorAgent(input: EditInput): Promise<{
  editPlan: EditPlan;
  usage: { input: number; output: number; costUsd: number };
}> {
  const editPlan = buildMontageEditPlan({
    vision: input.vision,
    preset: input.preset,
    copyVariants: input.copyVariants,
    assetId: input.assetId,
    sourceDurationSec: input.durationSec,
  });

  return { editPlan, usage: { input: 0, output: 0, costUsd: 0 } };
}
