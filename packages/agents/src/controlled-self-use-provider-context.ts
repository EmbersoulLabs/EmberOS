import { AsyncLocalStorage } from "node:async_hooks";
import { ControlledSelfUseAuthorityService } from "@ceo-agent/db";

export type ControlledSelfUseProviderContext = {
  reservationId: string;
  organizationId: string;
  workspaceId: string;
  executionIdentity: string;
  providerKey: "openai";
};

const context = new AsyncLocalStorage<ControlledSelfUseProviderContext>();

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
  if (!current || current.providerKey !== "openai") {
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
  await authority.markSubmitted(reservation.reservationId, new Date().toISOString());
  return globalThis.fetch(input, init);
}
