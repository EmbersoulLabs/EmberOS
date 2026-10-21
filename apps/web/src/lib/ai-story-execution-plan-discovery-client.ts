export type CurrentExecutionPlanDiscovery = {
  executionPlan: null | {
    executionPlanId: string;
    status: string;
    storyVersionId: string;
    animationPackageId: string;
    sceneIntentCount: number;
    compiledAt: string;
  };
};

export function generationReviewFailureMessage(data: unknown): string {
  if (!data || typeof data !== "object") return "Generation review did not create an Execution Plan";
  const blockers = (data as { qc?: { blockingErrors?: unknown } }).qc?.blockingErrors;
  if (!Array.isArray(blockers) || blockers.length === 0) {
    return "Generation review did not create an Execution Plan";
  }
  return blockers.map((item) => {
    if (!item || typeof item !== "object") return "GENERATION_REVIEW_BLOCKED";
    const finding = item as { code?: unknown; message?: unknown };
    const code = typeof finding.code === "string" ? finding.code : "GENERATION_REVIEW_BLOCKED";
    const message = typeof finding.message === "string" ? finding.message : "Execution QC blocked this Scene";
    return `${code}: ${message}`;
  }).join(" · ");
}

export async function fetchCurrentExecutionPlan(
  input: { campaignId: string; storyId: string },
  fetchImpl: typeof fetch = fetch
): Promise<CurrentExecutionPlanDiscovery> {
  const response = await fetchImpl(
    `/api/campaigns/${input.campaignId}/ai-stories/${input.storyId}/execution-plans/current`,
    { method: "GET", credentials: "same-origin", cache: "no-store" }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Execution Plan discovery failed");
  }
  return data as CurrentExecutionPlanDiscovery;
}
