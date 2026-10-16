import { AsyncLocalStorage } from "node:async_hooks";
import {
  CertificationPlanningAuthorityService,
  ControlledSelfUseAuthorityService,
  type CertificationPlanningHttpGrant,
} from "@ceo-agent/db";

export type ControlledSelfUseProviderContext = {
  reservationId: string;
  organizationId: string;
  workspaceId: string;
  executionIdentity: string;
  providerKey: "openai";
};

const context = new AsyncLocalStorage<ControlledSelfUseProviderContext>();
const certificationHttpGrant = new AsyncLocalStorage<CertificationPlanningHttpGrant>();

/** Binds a claim that `claim()` already persisted. Client flags cannot create this store. */
export function withCertificationPlanningHttpGrant<T>(
  grant: CertificationPlanningHttpGrant,
  run: () => Promise<T>
): Promise<T> {
  return certificationHttpGrant.run(grant, run);
}

export function withControlledSelfUseProviderContext<T>(
  authority: ControlledSelfUseProviderContext,
  run: () => Promise<T>
): Promise<T> {
  return context.run(authority, run);
}

/** The final fail-closed boundary immediately before an OpenAI HTTP request. */
export async function controlledSelfUseProviderFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (process.env.AI_STORY_PROVIDER_DISPATCH_MODE !== "allowlisted_self_use") {
    return globalThis.fetch(input, init);
  }
  const current = context.getStore();
  if (current) {
    if (current.providerKey !== "openai") {
      throw new Error("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
    }
    const authority = new ControlledSelfUseAuthorityService();
    const reservation = await authority.getReservationById(current.reservationId);
    if (
      !reservation ||
      reservation.organizationId !== current.organizationId ||
      reservation.workspaceId !== current.workspaceId ||
      reservation.executionIdentity !== current.executionIdentity ||
      reservation.providerKey !== "openai" ||
      reservation.retryOrdinal !== 0 ||
      !["RESERVED", "SUBMITTED"].includes(reservation.status)
    ) {
      throw new Error("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
    }
    try {
      await authority.assertWorkspaceEligible({
        environment: "PRODUCTION",
        organizationId: current.organizationId,
        workspaceId: current.workspaceId,
        capabilityKey: reservation.capabilityKey,
        providerKey: reservation.providerKey,
        ...(reservation.actorUserId ? { actorUserId: reservation.actorUserId } : {}),
      });
    } catch {
      throw new Error("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
    }
    await authority.markSubmitted(reservation.reservationId, new Date().toISOString());
  } else {
    const grant = certificationHttpGrant.getStore();
    if (!grant) throw new Error("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
    try {
      await new CertificationPlanningAuthorityService().assertHttpTransportAuthorized(grant);
    } catch {
      throw new Error("CONTROLLED_SELF_USE_PROVIDER_HTTP_DENIED");
    }
  }
  return globalThis.fetch(input, init);
}
