/**
 * Safe structured diagnostics for AI skill failures (no secrets / prompts / payloads).
 */
export function logAiSkillFailure(input: {
  correlationId: string;
  skillId: string;
  action?: string;
  campaignId?: string;
  assetId?: string;
  workspaceId?: string;
  code?: string;
  resultState: "failed" | "unavailable" | "invalid_input" | "normalize_failed";
}): void {
  console.error("[ai-skill]", {
    correlationId: input.correlationId,
    skillId: input.skillId,
    action: input.action ?? null,
    campaignId: input.campaignId ?? null,
    assetId: input.assetId ?? null,
    workspaceId: input.workspaceId ?? null,
    code: input.code ?? null,
    resultState: input.resultState,
  });
}
