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
