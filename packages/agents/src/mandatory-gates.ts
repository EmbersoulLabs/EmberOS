import type { StepProgress } from "@ceo-agent/shared";

export interface MandatoryGateInput {
  progress: StepProgress;
  creativeRegistered: boolean;
  outputReady: boolean;
}

export interface MandatoryGateResult {
  ready: boolean;
  missing: string[];
}

export function evaluateMandatoryGates(
  input: MandatoryGateInput
): MandatoryGateResult {
  const missing: string[] = [];
  if (input.progress.ffmpeg_render?.status !== "completed") {
    missing.push("validation");
  }
  if (input.progress.compliance_check?.status !== "completed") {
    missing.push("compliance");
  }
  if (input.progress.marketing_score?.status !== "completed") {
    missing.push("marketing_score");
  }
  if (!input.creativeRegistered) {
    missing.push("creative_registration");
  }
  if (!input.outputReady) {
    missing.push("output_readiness");
  }
  return { ready: missing.length === 0, missing };
}

export function assertMandatoryGatesComplete(input: MandatoryGateInput): void {
  const result = evaluateMandatoryGates(input);
  if (!result.ready) {
    throw new Error(`Mandatory gates incomplete: ${result.missing.join(", ")}`);
  }
}
