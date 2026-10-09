/**
 * Public LOCAL_GPU connectivity smoke. No generation.
 * Prints status only. Never prints LOCAL_GPU_SIGNING_SECRET.
 */
import { LocalGpuCloudAdapter } from "../packages/agents/src/ai-story/local-gpu-adapter";
import { loadLocalGpuConfigFromEnv } from "../packages/agents/src/ai-story/local-gpu-config";
import { localGpuActorFromResolution } from "../packages/agents/src/ai-story/local-gpu-access";

const actor = localGpuActorFromResolution({
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  organizationPlan: null,
  resolution: { status: "ACTIVE_GRANT" },
});

async function probe(environment: "staging" | "production") {
  const configuredSecret = process.env.LOCAL_GPU_SIGNING_SECRET?.trim() ?? "";
  const config = loadLocalGpuConfigFromEnv({
    ...process.env,
    LOCAL_GPU_PROVIDER_ENABLED: "true",
    LOCAL_GPU_BASE_URL: "https://local-gpu.embersoullabs.com",
    LOCAL_GPU_ENVIRONMENT: environment,
    LOCAL_GPU_SIGNING_SECRET: configuredSecret || "health-probe-does-not-call-protected-routes",
    AGENCY_LOCAL_GPU_ENABLED: "false",
  });
  const adapter = new LocalGpuCloudAdapter({ ...config, signingSecret: configuredSecret || null, enabled: true });
  const health = await adapter.health();
  let capabilities = "BLOCKED_SECRET_UNSET";
  let workflows: string[] = [];
  if (configuredSecret) {
    try {
      const report = await adapter.capabilities({
        actor,
        workspaceId: actor.workspaceId,
        workflow: "CAPABILITIES",
      });
      workflows = report.workflows;
      capabilities = workflows.includes("MINIMAX_H3_R2V") ? "PASS" : "FAIL_WORKFLOW_MISSING";
    } catch {
      capabilities = "FAIL";
    }
  }
  return {
    environment,
    baseUrl: config.baseUrl,
    health: health.state === "AVAILABLE" ? "PASS" : "FAIL",
    capabilities,
    minimaxH3R2v: workflows.includes("MINIMAX_H3_R2V"),
  };
}

async function main() {
  const staging = await probe("staging");
  const production = await probe("production");
  console.log(JSON.stringify({
    STAGING_PUBLIC_HEALTH: staging.health,
    PRODUCTION_PUBLIC_HEALTH: production.health,
    STAGING_CAPABILITIES: staging.capabilities,
    PRODUCTION_CAPABILITIES: production.capabilities,
    REAL_H3_GENERATION_RUN: "NO",
  }, null, 2));
  if (staging.health !== "PASS" || production.health !== "PASS") process.exitCode = 1;
}

void main();
