export const MAX_SIGNED_URL_REFRESH_ATTEMPTS = 1;

export type PreviewDeliveryStatus = "INITIAL" | "REFRESHING" | "READY" | "TERMINAL_PREVIEW_ERROR";

export type PreviewDeliveryState = {
  artifactIdentity: string;
  refreshAttempts: number;
  status: PreviewDeliveryStatus;
};

type PreviewArtifact = {
  id?: unknown;
  renderCacheFingerprint?: unknown;
  updatedAt?: unknown;
};

/** Stable across signed-URL refreshes; changes only with a different rendered artifact. */
export function previewArtifactIdentity(
  creative: PreviewArtifact | null | undefined,
  rendition = "preview"
): string {
  const id = typeof creative?.id === "string" ? creative.id : "unknown-creative";
  const fingerprint =
    typeof creative?.renderCacheFingerprint === "string" && creative.renderCacheFingerprint
      ? creative.renderCacheFingerprint
      : creative?.updatedAt instanceof Date
        ? creative.updatedAt.toISOString()
        : typeof creative?.updatedAt === "string" && creative.updatedAt
          ? creative.updatedAt
          : "unknown-artifact";
  return `${id}:${rendition}:${fingerprint}`;
}

export function initialPreviewDeliveryState(artifactIdentity: string): PreviewDeliveryState {
  return { artifactIdentity, refreshAttempts: 0, status: "INITIAL" };
}

function stateForArtifact(
  state: PreviewDeliveryState | undefined,
  artifactIdentity: string
): PreviewDeliveryState {
  return state?.artifactIdentity === artifactIdentity
    ? state
    : initialPreviewDeliveryState(artifactIdentity);
}

export function recordPreviewDeliveryFailure(
  state: PreviewDeliveryState | undefined,
  artifactIdentity: string
): { state: PreviewDeliveryState; shouldRefresh: boolean } {
  const current = stateForArtifact(state, artifactIdentity);
  if (current.refreshAttempts >= MAX_SIGNED_URL_REFRESH_ATTEMPTS) {
    return {
      state: { ...current, status: "TERMINAL_PREVIEW_ERROR" },
      shouldRefresh: false,
    };
  }
  return {
    state: {
      ...current,
      refreshAttempts: current.refreshAttempts + 1,
      status: "REFRESHING",
    },
    shouldRefresh: true,
  };
}

export function recordPreviewDeliverySuccess(
  state: PreviewDeliveryState | undefined,
  artifactIdentity: string
): PreviewDeliveryState {
  const current = stateForArtifact(state, artifactIdentity);
  return { ...current, status: "READY" };
}

export function recordPreviewRefreshFailure(
  state: PreviewDeliveryState,
  artifactIdentity: string
): PreviewDeliveryState {
  const current = stateForArtifact(state, artifactIdentity);
  return { ...current, status: "TERMINAL_PREVIEW_ERROR" };
}
