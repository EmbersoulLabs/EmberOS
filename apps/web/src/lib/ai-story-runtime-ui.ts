/**
 * Sprint 3 PR 3.7 Phase E — pure UI helpers for product runtime status.
 */
import type { ProductRuntimeStatus, WorkspaceRole } from "@ceo-agent/shared";
import { isProductRuntimePollingStatus } from "@ceo-agent/shared";

export function canShowExecuteButton(role: WorkspaceRole | string | null | undefined): boolean {
  return role === "admin" || role === "operator";
}

export function formatProductRuntimeStatus(
  status: ProductRuntimeStatus | string | null | undefined
): string {
  switch (status) {
    case "READY_FOR_EXECUTION":
      return "Ready";
    case "AUTHORIZED":
      return "Starting";
    case "SCENES_RUNNING":
      return "Scenes running";
    case "RECONCILIATION_REQUIRED":
      return "Reconciliation required";
    case "SCENES_FAILED":
      return "Scene generation failed";
    case "SCENES_COMPLETE":
      return "Scenes complete";
    case "WAITING_FOR_ASSEMBLY":
      return "Waiting for assembly";
    case "ASSEMBLING":
      return "Assembling";
    case "ASSEMBLY_FAILED":
      return "Assembly failed";
    case "SUCCEEDED":
      return "Completed";
    case "NOT_READY":
    default:
      return "Not ready";
  }
}

export function shouldPollProductRuntime(
  status: ProductRuntimeStatus | string | null | undefined
): boolean {
  if (!status) return false;
  return isProductRuntimePollingStatus(status as ProductRuntimeStatus);
}

export const PRODUCT_RUNTIME_POLL_INTERVAL_MS = 4_000;
