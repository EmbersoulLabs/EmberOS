import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("Controlled Self-Use runtime boundaries", () => {
  it("restricts Production authority to EmberSoulLabs and no customer wildcard", () => {
    const service = read("packages/db/src/queries/controlled-self-use.ts");
    const migration = read("supabase/migrations/20260926055546_controlled_self_use_authority_v1.sql");
    expect(service).toContain("52519c8c-4011-478f-bf09-34e087e4bbdd");
    expect(service).toContain("Production Controlled Self-Use is restricted to EmberSoulLabs");
    expect(migration).toContain("controlled_self_use_production_org_check");
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i);
  });

  it("filters AI Story outbox selection before dispatch claim", () => {
    const dispatch = read("packages/db/src/queries/provider-execution-dispatch.ts");
    const cycle = read("apps/worker/src/ai-story-provider-worker-cycle.ts");
    expect(dispatch).toContain("controlledSelfUseOnly");
    expect(dispatch).toContain("self_use_authority.status = 'ACTIVE'");
    expect(dispatch).toContain("self_use_workspace.org_id = self_use_authority.organization_id");
    expect(cycle).toContain("controlledSelfUseOnly: controlledSelfUse");
    expect(cycle).toContain("zero automatic paid retries");
  });

  it("requires the dedicated one-attempt Campaign queue and final HTTP reservation gate", () => {
    const queue = read("packages/queue/src/index.ts");
    const worker = read("apps/worker/src/processors/index.ts");
    const provider = read("packages/agents/src/controlled-self-use-provider-context.ts");
    expect(queue).toContain('attempts: 1');
    expect(queue).toContain("controlled-self-use-pipeline-");
    expect(worker).toContain("CONTROLLED_SELF_USE_PRECLAIM_DENIED");
    expect(worker).toContain("CONTROLLED_SELF_USE_RENDER_RESERVATION_DENIED");
    expect(worker).toContain("withControlledSelfUseProviderContext");
    expect(provider).toContain("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
    expect(provider.indexOf("markSubmitted")).toBeLessThan(provider.lastIndexOf("globalThis.fetch"));
  });

  it("routes every OpenAI SDK construction through the final reservation gate", () => {
    const llm = read("packages/agents/src/llm.ts");
    const image = read("packages/agents/src/creative-image/openai-creative-image-adapter.ts");
    const keyframeQc = read("packages/agents/src/ai-story/openai-scene-keyframe-qc-adapter.ts");
    for (const source of [llm, image, keyframeQc]) {
      expect(source).toContain("controlledSelfUseProviderFetch");
      expect(source).toContain("maxRetries: 0");
    }
  });

  it("requires Billing Account and durable reservation in both product paths", () => {
    const campaign = read("apps/web/src/lib/campaign-generate.ts");
    const planning = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/generate/route.ts");
    const storyWorker = read("apps/worker/src/ai-story-certification-commercial-reservation.ts");
    expect(campaign).toContain("BillingAccountRepositoryImpl");
    expect(campaign).toContain("maximumCostUsd: \"0.50\"");
    expect(planning).toContain("CONTROLLED_SELF_USE_PLANNING_BILLING_AUTHORITY_DENIED");
    expect(storyWorker).toContain("AiStoryControlledSelfUseCommercialReservationGate");
    expect(storyWorker).toContain('providerKey: "seedance"');
    const commercial = read("packages/agents/src/commercial/commercial-authorization-runtime.ts");
    const authority = read("packages/db/src/queries/controlled-self-use.ts");
    expect(commercial).toContain("authorizeOneAiStoryExecution");
    expect(commercial).toContain("creditReservationId: oneShot.creditReservationId");
    expect(authority).toContain("expiresAt");
    expect(authority).toContain("Execution-bound Production Controlled Self-Use product credits");
    expect(authority).not.toContain("1000");
  });

  it("keeps uncertified V2V outside the self-use capability contract", () => {
    const migration = read("supabase/migrations/20260926055546_controlled_self_use_authority_v1.sql");
    const service = read("packages/db/src/queries/controlled-self-use.ts");
    expect(migration).not.toContain("VIDEO_TO_VIDEO");
    expect(service).not.toContain("runway");
  });
});
