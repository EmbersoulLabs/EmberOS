import { createHash } from "node:crypto";
import type {
  MediaPipelineType,
  PipelineExecutionPlan,
  PipelineExecutionRequest,
  PipelineRoute,
  PipelineType,
  RoutableAsset,
} from "./workflow-contracts";
import { dependenciesForRoute } from "./dependency-engine";

export type PipelineRouterInput = PipelineExecutionRequest;

function isPlayableVideo(asset: RoutableAsset): boolean {
  if (asset.type !== "video" && !asset.mimeType?.startsWith("video/")) return false;
  const duration = Number(asset.durationSec ?? 0);
  return Boolean(asset.storagePath) && (duration > 0 || asset.durationSec == null);
}

function isSupportedImage(asset: RoutableAsset): boolean {
  return (
    Boolean(asset.storagePath) &&
    (asset.type === "image" || Boolean(asset.mimeType?.startsWith("image/")))
  );
}

function dependencyStateToPipelineState(
  route: PipelineRoute,
  input: PipelineExecutionRequest
): PipelineRoute["state"] {
  const completed = input.completedResults[route.pipelineType];
  const retry = input.retryPipelineTypes.includes(route.pipelineType);
  if (completed?.state === "COMPLETED" && !retry) return "COMPLETED";

  const evaluation = dependenciesForRoute(route, input.dependencies);
  if (evaluation.state === "FAILED_TERMINAL") return "FAILED_TERMINAL";
  if (evaluation.state === "FAILED_RETRYABLE") return "FAILED_RETRYABLE";
  if (evaluation.state === "WAITING") return "WAITING_FOR_DEPENDENCY";
  return retry ? "FAILED_RETRYABLE" : "QUEUED";
}

function mediaRoute(
  pipelineType: MediaPipelineType,
  assets: RoutableAsset[],
  reason: string,
  input: PipelineExecutionRequest
): PipelineRoute {
  const route: PipelineRoute = {
    pipelineType,
    state: "QUEUED",
    assetIds: assets.map((asset) => asset.id),
    dependsOn: [
      "campaign",
      "business_profile",
      ...assets.flatMap((asset) => [
        `asset-upload:${asset.id}`,
        `asset-registration:${asset.id}`,
      ]),
    ],
    reason,
  };
  route.state = dependencyStateToPipelineState(route, input);
  return route;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

export function buildPipelineExecutionPlan(
  input: PipelineRouterInput
): PipelineExecutionPlan {
  const assets = [...input.selectedAssets].sort((a, b) => a.id.localeCompare(b.id));
  const videos = assets.filter(isPlayableVideo);
  const images = assets.filter(isSupportedImage);
  const routes: PipelineRoute[] = [];

  if (videos.length > 0) {
    routes.push(mediaRoute("VIDEO", videos, "Playable video asset selected", input));
  } else {
    routes.push({
      pipelineType: "VIDEO",
      state: "NOT_REQUIRED",
      assetIds: [],
      dependsOn: [],
      reason: "No playable video selected",
    });
  }

  if (images.length > 0) {
    routes.push(
      mediaRoute(
        "IMAGE_UNDERSTANDING",
        images,
        "Supported image asset selected",
        input
      )
    );
  } else {
    routes.push({
      pipelineType: "IMAGE_UNDERSTANDING",
      state: "NOT_REQUIRED",
      assetIds: [],
      dependsOn: [],
      reason: "No supported image selected",
    });
  }

  routes.push({
    pipelineType: "PRODUCT_IMAGE",
    state: "NOT_REQUIRED",
    assetIds: [],
    dependsOn: [],
    reason: "Product Image runtime is outside PR-2 and is not executable",
  });

  const requiredMedia = routes.filter(
    (route) =>
      route.pipelineType !== "PRODUCT_IMAGE" &&
      route.pipelineType !== "MARKETING" &&
      route.state !== "NOT_REQUIRED"
  );
  const mediaComplete = requiredMedia.every((route) => route.state === "COMPLETED");
  const marketingCompleted = input.completedResults.MARKETING?.state === "COMPLETED";
  routes.push({
    pipelineType: "MARKETING",
    state: marketingCompleted
      ? "COMPLETED"
      : requiredMedia.length > 0 && mediaComplete
        ? "QUEUED"
        : "WAITING_FOR_DEPENDENCY",
    assetIds: requiredMedia.flatMap((route) => route.assetIds),
    dependsOn: [
      "marketing_context",
      ...requiredMedia.map((route) => `pipeline:${route.pipelineType}`),
    ],
    reason:
      requiredMedia.length === 0
        ? "No supported media is available"
        : "Marketing waits for required normalized media results",
  });

  const runnable = requiredMedia
    .filter(
      (route) =>
        route.state === "QUEUED" ||
        route.state === "FAILED_RETRYABLE"
    )
    .map((route) => route.pipelineType as MediaPipelineType);
  const stable = stableValue({
    campaignId: input.campaignId,
    workspaceId: input.workspaceId,
    campaignObjective: input.campaignObjective,
    requestedOutputs: [...input.requestedOutputs].sort(),
    enabledCapabilities: [...input.enabledCapabilities].sort(),
    assets: assets.map((asset) => [
      asset.id,
      asset.type,
      asset.mimeType ?? "",
      asset.status ?? "",
    ]),
    routes: routes.map((route) => [
      route.pipelineType,
      route.state,
      route.assetIds,
      route.reason,
    ]),
  });

  return {
    campaignId: input.campaignId,
    workspaceId: input.workspaceId,
    routes,
    // This is an execution capability, not a claim that existing production
    // media runners are already safely independent.
    concurrencyGroups: runnable.length > 0 ? [runnable] : [],
    reusedResults: input.completedResults,
    deterministicKey: createHash("sha256")
      .update(JSON.stringify(stable))
      .digest("hex"),
  };
}

export function getPipelineRoute(
  plan: PipelineExecutionPlan,
  pipelineType: PipelineType
): PipelineRoute {
  const route = plan.routes.find((item) => item.pipelineType === pipelineType);
  if (!route) throw new Error(`Pipeline route missing: ${pipelineType}`);
  return route;
}
