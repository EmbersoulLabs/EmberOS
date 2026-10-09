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

export function localGpuActorFromResolution(input: {
  userId: string;
  workspaceId: string;
  organizationPlan: string | null;
  resolution: { status: LocalGpuServerActor["platformAdminStatus"] };
}): LocalGpuServerActor {
  return {
    userId: input.userId,
    workspaceId: input.workspaceId,
    organizationPlan: input.organizationPlan,
    platformAdminStatus: input.resolution.status,
  };
}

/**
 * V1 access: an ACTIVE platform-admin grant is allowed. Agency and every
 * other non-superadmin identity are denied unless agency entitlement is
 * explicitly enabled. Client role claims are rejected.
 */
export function assertLocalGpuAccess(
  actor: LocalGpuServerActor,
  workspace: { workspaceId: string },
  policy: { agencyLocalGpuEnabled?: boolean } = {},
): void {
  if (!actor || typeof actor !== "object") {
    throw new LocalGpuAccessError("LOCAL_GPU_ACCESS_DENIED");
  }
  for (const key of CLIENT_AUTHORITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(actor, key)) {
      throw new LocalGpuAccessError("LOCAL_GPU_CLIENT_AUTHORITY_REJECTED");
    }
  }
  if (actor.workspaceId !== workspace.workspaceId) {
    throw new LocalGpuAccessError("LOCAL_GPU_ACCESS_DENIED");
  }
  if (actor.platformAdminStatus === "ACTIVE_GRANT") return;
  if (policy.agencyLocalGpuEnabled === true && actor.organizationPlan?.toLowerCase() === "agency") return;
  throw new LocalGpuAccessError("LOCAL_GPU_ACCESS_DENIED");
}
