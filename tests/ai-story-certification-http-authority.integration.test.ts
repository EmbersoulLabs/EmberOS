import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "../packages/shared/node_modules/zod";
import type { Sql } from "postgres";
import {
  closeDb,
  CertificationPlanningAuthorityError,
  CertificationPlanningAuthorityService,
  type CertificationPlanningHttpGrant,
} from "@ceo-agent/db";
import { createIntegrationSql, getIntegrationDbUrl, RUN_DB_INTEGRATION } from "./helpers/db-integration";
import type { Phase2aIdSet } from "./helpers/ai-story-phase-2a";
import { cleanupPr32Tenant, PR32_USER_A, seedPr32Tenant } from "./helpers/ai-story-pr32-scheduling";
import { installCertificationNetworkIsolation } from "./helpers/certification-network-isolation";
import { callJsonModel, callStructuredJsonModel, withCertificationPlanningContext } from "../packages/agents/src/llm";
import {
  controlledSelfUseProviderFetch,
  withCertificationPlanningHttpGrant,
  withControlledSelfUseProviderContext,
} from "../packages/agents/src/controlled-self-use-provider-context";

if (process.env.CI === "true" && (!RUN_DB_INTEGRATION || !getIntegrationDbUrl())) {
  throw new Error("CERTIFICATION_POSTGRES_REQUIRED_IN_CI");
}
const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

function completionResponse(): Response {
  return new Response(JSON.stringify({
    id: "chatcmpl-certification-http-test",
    object: "chat.completion",
    created: 1,
    model: "gpt-4o-mini-2024-07-18",
    choices: [{ index: 0, message: { role: "assistant", content: "{\"ok\":true}" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describeIntegration("certification planning HTTP authority", () => {
  let sql: Sql;
  let restoreNetwork: () => void;
  const ids: Phase2aIdSet = {
    orgId: randomUUID(), workspaceId: randomUUID(), campaignId: randomUUID(), storyId: randomUUID(),
    storyVersionId: randomUUID(), animationPackageId: randomUUID(), assetId: randomUUID(),
  };
  const previousMode = process.env.AI_STORY_PROVIDER_DISPATCH_MODE;
  const previousKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    restoreNetwork = installCertificationNetworkIsolation();
    sql = createIntegrationSql();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "certification-http");
    process.env.AI_STORY_PROVIDER_DISPATCH_MODE = "allowlisted_self_use";
    process.env.OPENAI_API_KEY = "test-certification-http-not-a-provider-secret";
  }, 120_000);

  afterAll(async () => {
    if (previousMode === undefined) delete process.env.AI_STORY_PROVIDER_DISPATCH_MODE;
    else process.env.AI_STORY_PROVIDER_DISPATCH_MODE = previousMode;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (!sql) return;
    await sql`delete from certification_planning_claims where planning_authority_id in (select planning_authority_id from certification_planning_authorities where org_id=${ids.orgId}::uuid)`;
    await sql`delete from certification_planning_authorities where org_id=${ids.orgId}::uuid`;
    await cleanupPr32Tenant(sql, ids);
    await sql.end();
    await closeDb();
    restoreNetwork?.();
  }, 120_000);

  async function withTransportMock<T>(run: (calls: string[]) => Promise<T>): Promise<T> {
    const isolated = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      return completionResponse();
    }) as typeof fetch;
    try {
      return await run(calls);
    } finally {
      globalThis.fetch = isolated;
    }
  }

  function identity(certificationRunId = randomUUID()) {
    return {
      environment: "PRODUCTION" as const,
      certificationRunId,
      orgId: ids.orgId,
      workspaceId: ids.workspaceId,
      campaignId: ids.campaignId,
      storyId: ids.storyId,
      actorUserId: PR32_USER_A,
    };
  }

  it("lets a claimed Story Polish and a later planning stage reach the transport mock", async () => {
    const service = new CertificationPlanningAuthorityService();
    const scope = identity();
    await service.provision({
      ...scope,
      authorizedBy: PR32_USER_A,
      authorizationReason: "http transport certification",
      authorizedAt: new Date().toISOString(),
      maxPlanningCostUsd: "0.50",
      maxLogicalCalls: 9,
      maxTransportAttempts: 1,
      model: "gpt-4o-mini-2024-07-18",
    });
    await withTransportMock(async (calls) => {
      await withCertificationPlanningContext({ ...scope, logicalCallSuffix: "initial" }, async () => {
        const polish = await callStructuredJsonModel({
          system: "certification",
          user: "story",
          schema: z.object({ ok: z.boolean() }),
          schemaName: "certification_polish",
        });
        expect(polish.result).toEqual({ ok: true });
        const later = await callJsonModel<{ ok: boolean }>("certification", "story", "{ok:boolean}", { certificationStage: "creative_context" });
        expect(later.result).toEqual({ ok: true });
      });
      expect(calls.length).toBe(2);
      expect(calls.every((url) => url.includes("api.openai.com"))).toBe(true);
    });
    const [authority] = await sql`
      select spent_planning_cost_usd::text as spent, reserved_planning_cost_usd::text as reserved, consumed_logical_calls as consumed
      from certification_planning_authorities
      where certification_run_id=${scope.certificationRunId}::uuid
    `;
    expect(authority).toEqual({ spent: "0.02", reserved: "0.00", consumed: 2 });
  }, 120_000);

  it("rejects missing, mismatched, and client-only grants before HTTP", async () => {
    const service = new CertificationPlanningAuthorityService();
    const scope = identity();
    await service.provision({
      ...scope,
      authorizedBy: PR32_USER_A,
      authorizationReason: "http denial certification",
      authorizedAt: new Date().toISOString(),
      maxPlanningCostUsd: "0.50",
      maxLogicalCalls: 4,
      maxTransportAttempts: 1,
      model: "gpt-4o-mini-2024-07-18",
    });
    const claim = await service.claim({
      ...scope,
      logicalCallIdentity: "story_polish:initial",
      stage: "story_polish",
      model: "gpt-4o-mini-2024-07-18",
      maxOutputTokens: 4096,
      maxRetries: 0,
      claimedAt: new Date().toISOString(),
    });
    const grant: CertificationPlanningHttpGrant = {
      ...scope,
      planningClaimId: claim.planningClaimId,
      logicalCallIdentity: "story_polish:initial",
      model: "gpt-4o-mini-2024-07-18",
    };
    await withTransportMock(async (calls) => {
      await expect(withCertificationPlanningContext({ ...scope, logicalCallSuffix: "initial" }, () =>
        controlledSelfUseProviderFetch("https://api.openai.com/v1/chat/completions", { method: "POST" })
      )).rejects.toThrow("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
      await expect(withCertificationPlanningHttpGrant({ ...grant, planningClaimId: randomUUID() }, () =>
        controlledSelfUseProviderFetch("https://api.openai.com/v1/chat/completions")
      )).rejects.toThrow("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
      await expect(withCertificationPlanningHttpGrant({ ...grant, storyId: randomUUID() }, () =>
        controlledSelfUseProviderFetch("https://api.openai.com/v1/chat/completions")
      )).rejects.toThrow("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
      await expect(withCertificationPlanningHttpGrant({ ...grant, orgId: randomUUID() }, () =>
        controlledSelfUseProviderFetch("https://api.openai.com/v1/chat/completions")
      )).rejects.toThrow("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
      await expect(withCertificationPlanningHttpGrant({ ...grant, actorUserId: randomUUID() }, () =>
        controlledSelfUseProviderFetch("https://api.openai.com/v1/chat/completions")
      )).rejects.toThrow("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
      await expect(service.assertHttpTransportAuthorized({ ...grant, storyId: randomUUID() })).rejects.toBeInstanceOf(CertificationPlanningAuthorityError);
      await expect(withControlledSelfUseProviderContext({
        reservationId: randomUUID(),
        organizationId: ids.orgId,
        workspaceId: ids.workspaceId,
        executionIdentity: "not-a-certification-call",
        providerKey: "openai",
      }, () => withCertificationPlanningHttpGrant(grant, () =>
        controlledSelfUseProviderFetch("https://api.openai.com/v1/chat/completions")
      ))).rejects.toThrow("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
      await service.failUnknown({ planningClaimId: claim.planningClaimId, completedAt: new Date().toISOString() });
      await expect(withCertificationPlanningHttpGrant(grant, () =>
        controlledSelfUseProviderFetch("https://api.openai.com/v1/chat/completions")
      )).rejects.toThrow("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
      expect(calls).toEqual([]);
    });
  }, 120_000);

  it("blocks an exhausted budget before any provider request", async () => {
    const service = new CertificationPlanningAuthorityService();
    const scope = identity();
    await service.provision({
      ...scope,
      authorizedBy: PR32_USER_A,
      authorizationReason: "http budget certification",
      authorizedAt: new Date().toISOString(),
      maxPlanningCostUsd: "0.02",
      maxLogicalCalls: 1,
      maxTransportAttempts: 1,
      model: "gpt-4o-mini-2024-07-18",
    });
    await withTransportMock(async (calls) => {
      await expect(withCertificationPlanningContext({ ...scope, logicalCallSuffix: "initial" }, () =>
        callStructuredJsonModel({
          system: "certification",
          user: "story",
          schema: z.object({ ok: z.boolean() }),
          schemaName: "certification_polish",
        })
      )).rejects.toThrow("Projected planning cost exceeds remaining authority");
      expect(calls).toEqual([]);
    });
    const [authority] = await sql`
      select spent_planning_cost_usd::text as spent, reserved_planning_cost_usd::text as reserved, consumed_logical_calls as consumed
      from certification_planning_authorities
      where certification_run_id=${scope.certificationRunId}::uuid
    `;
    expect(authority).toEqual({ spent: "0.00", reserved: "0.00", consumed: 0 });
  }, 120_000);
});
