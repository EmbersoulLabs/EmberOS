export class LocalGpuAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalGpuAccessError";
  }
}

export type LocalGpuServerActor = {
  readonly userId: string;
  readonly workspaceId: string;
  readonly organizationPlan: string | null;
  readonly platformAdminStatus: "ACTIVE_GRANT" | "BOOTSTRAP_ELIGIBLE" | "DENIED";
};

const CLIENT_AUTHORITY_KEYS = ["isSuperadmin", "role", "permissions", "isPlatformAdmin"] as const;

export function assertLocalGpuAccess(
  actor: LocalGpuServerActor,
  workspace: { workspaceId: string },
): void {
  if (!actor || typeof actor !== "object") throw new LocalGpuAccessError("LOCAL_GPU_ACCESS_DENIED");
  for (const key of CLIENT_AUTHORITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(actor, key)) {
      throw new LocalGpuAccessError("LOCAL_GPU_CLIENT_AUTHORITY_REJECTED");
    }
  }
  if (actor.workspaceId !== workspace.workspaceId) throw new LocalGpuAccessError("LOCAL_GPU_ACCESS_DENIED");
  if (actor.platformAdminStatus !== "ACTIVE_GRANT") throw new LocalGpuAccessError("LOCAL_GPU_ACCESS_DENIED");
}

/** Explicit LOCAL_GPU selection stays closed in this phase. Other providers are unchanged. */
export function resolveExplicitLocalGpuProviderAuthority(input: { requestedProvider?: string | null }): { kind: "EXISTING" } {
  if ((input.requestedProvider?.trim() ?? "") !== "LOCAL_GPU") return { kind: "EXISTING" };
  throw new LocalGpuAccessError("LOCAL_GPU_PROVIDER_DISABLED");
}
