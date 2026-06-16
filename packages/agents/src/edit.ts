import { callJsonModel } from "./llm";
import { EditPlanSchema } from "@ceo-agent/shared";
import type { CopyVariant, EditPlan, VisionAnalysis } from "@ceo-agent/shared";

export interface EditInput {
  vision: VisionAnalysis;
  copyVariant: CopyVariant;
  assetId: string;
  durationSec: number;
}

export async function runEditDirectorAgent(input: EditInput): Promise<{
  editPlan: EditPlan;
  usage: { input: number; output: number; costUsd: number };
}> {
  const moment = input.vision.suggestedMoments[0] ?? {
    startSec: 0,
    endSec: Math.min(input.durationSec, 30),
    reason: "default",
  };

  const system = `You are an Edit Director for short-form vertical video (9:16).
Output FFmpeg-executable timeline JSON. Target 15-60s. Subtitles in golden 3 seconds.
Do NOT output shell commands. Keep transitions simple for TikTok/XHS/Instagram.`;

  const user = JSON.stringify({
    hook: input.copyVariant.hook,
    durationSec: input.durationSec,
    moment,
    assetId: input.assetId,
  });

  const { result, usage } = await callJsonModel<unknown>(system, user, "EditPlan");
  const parsed = EditPlanSchema.safeParse(result);

  const editPlan: EditPlan = parsed.success
    ? parsed.data
    : {
        aspectRatio: "9:16",
        targetDurationSec: Math.min(input.durationSec, 30),
        outputResolution: { preview: "720x1280", export: "1080x1920" },
        clips: [
          {
            assetId: input.assetId,
            startSec: moment.startSec,
            endSec: Math.min(moment.endSec, input.durationSec),
            speed: 1,
          },
        ],
        subtitles: [
          {
            startSec: 0,
            endSec: 3,
            text: input.copyVariant.hook,
            style: "bold_center",
          },
        ],
        cover: { atSec: moment.startSec + 0.5, overlayText: input.copyVariant.title },
        audio: { keepOriginal: true, bgm: null, normalize: true },
        effects: [{ type: "fade_in", startSec: 0, durationSec: 0.3 }],
      };

  return { editPlan, usage };
}
