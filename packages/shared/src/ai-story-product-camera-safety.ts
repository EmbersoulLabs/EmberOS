import { z } from "zod";
import { AI_STORY_CAMERA_FAMILIES } from "./ai-story-director-plan";

export const AI_STORY_SHOT_CAMERA_SAFETY_CONTRACT_VERSION =
  "ai-story-shot-camera-safety.v1" as const;

/**
 * Formal record of the PRODUCT_GROUNDED_VIDEO identity-safe camera restriction
 * already enforced by shot planning and the authored Director product-camera gate.
 * Identity-safe families are only the movements that restriction names.
 * Those movements are not permitted to introduce dramatic perspective, an unseen
 * product surface, or a product identity transformation.
 */
export const AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY = Object.freeze({
  policyId: "product-grounded-video-identity-safe-camera.v1",
  policyVersion: 1,
  evidenceSource: "PRODUCT_GROUNDED_VIDEO_IDENTITY_SAFE_CAMERA_RESTRICTION",
  identitySafeFacts: Object.freeze({
    perspectiveChange: "MINIMAL",
    revealsUnseenProductSurface: false,
    productIdentityTransformation: false,
  }),
  identitySafeFamilies: Object.freeze([
    "LOCKED",
    "STATIC",
    "SLOW_PUSH_IN",
    "SLOW_PULL_BACK",
    "MINOR_LATERAL_DOLLY",
    "SMALL_ARC",
    "RACK_FOCUS",
    "GENTLE_PARALLAX",
  ] as const),
});

const CameraFamily = z.enum(AI_STORY_CAMERA_FAMILIES);

export const AiStoryShotCameraSafetySchema = z.object({
  contractVersion: z.literal(AI_STORY_SHOT_CAMERA_SAFETY_CONTRACT_VERSION),
  perspectiveChange: z.enum(["MINIMAL", "MODERATE", "LARGE"]),
  revealsUnseenProductSurface: z.boolean(),
  productIdentityTransformation: z.boolean(),
  evidenceSource: z.literal(AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY.evidenceSource),
  policyId: z.literal(AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY.policyId),
  policyVersion: z.literal(AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY.policyVersion),
  cameraFamily: CameraFamily,
}).strict();

export type AiStoryShotCameraSafety = z.infer<typeof AiStoryShotCameraSafetySchema>;

export class ProductCameraSafetyError extends Error {
  constructor(readonly code: "PRODUCT_CAMERA_SAFETY_POLICY_INSUFFICIENT" | "PRODUCT_CAMERA_SAFETY_CONTRADICTION", message: string) {
    super(`${code}: ${message}`);
    this.name = "ProductCameraSafetyError";
  }
}

function normalizeCameraToken(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function resolveRegisteredCameraFamily(value: string) {
  const normalized = normalizeCameraToken(value);
  return AI_STORY_CAMERA_FAMILIES.find((family) => normalizeCameraToken(family) === normalized) ?? null;
}

function identitySafeFamily(value: string) {
  const family = resolveRegisteredCameraFamily(value);
  if (!family) return null;
  return (AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY.identitySafeFamilies as readonly string[]).includes(family)
    ? family
    : null;
}

/** Returns the policy record only when the movement is an identity-safe family. */
export function resolveProductCameraSafety(cameraMovement: string, cameraType = ""): AiStoryShotCameraSafety | null {
  const movement = identitySafeFamily(cameraMovement);
  const family = movement ?? (normalizeCameraToken(cameraMovement) === "none" ? identitySafeFamily(cameraType) : null);
  if (!family) return null;
  return {
    contractVersion: AI_STORY_SHOT_CAMERA_SAFETY_CONTRACT_VERSION,
    ...AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY.identitySafeFacts,
    evidenceSource: AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY.evidenceSource,
    policyId: AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY.policyId,
    policyVersion: AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY.policyVersion,
    cameraFamily: family,
  };
}

export function provePersistedProductCameraSafety(shot: {
  cameraType: string;
  cameraMovement: string;
  cameraSafety?: AiStoryShotCameraSafety | null;
}) {
  if (!shot.cameraSafety) return null;
  const proven = resolveProductCameraSafety(shot.cameraMovement, shot.cameraType);
  if (!proven) return null;
  const parsed = AiStoryShotCameraSafetySchema.safeParse(shot.cameraSafety);
  if (!parsed.success) return null;
  const same = parsed.data.cameraFamily === proven.cameraFamily
    && parsed.data.perspectiveChange === proven.perspectiveChange
    && parsed.data.revealsUnseenProductSurface === proven.revealsUnseenProductSurface
    && parsed.data.productIdentityTransformation === proven.productIdentityTransformation
    && parsed.data.policyId === proven.policyId
    && parsed.data.policyVersion === proven.policyVersion
    && parsed.data.evidenceSource === proven.evidenceSource;
  return same ? proven : null;
}

type SafetyShot = {
  id: string;
  sceneId: string;
  cameraType: string;
  cameraMovement: string;
  cameraSafety?: AiStoryShotCameraSafety;
};

export function bindProductShotCameraSafety<T extends SafetyShot>(input: {
  scenePlan: readonly { id: string; generationAuthority?: { productVisualIdentityRequirement?: "NONE" | "REQUIRED" } | null }[];
  shotPlan: readonly T[];
}): T[] {
  const productSceneIds = new Set(
    input.scenePlan
      .filter((scene) => scene.generationAuthority?.productVisualIdentityRequirement === "REQUIRED")
      .map((scene) => scene.id),
  );
  return input.shotPlan.map((shot) => {
    const proven = resolveProductCameraSafety(shot.cameraMovement, shot.cameraType);
    const required = productSceneIds.has(shot.sceneId);
    if (shot.cameraSafety && !provePersistedProductCameraSafety(shot)) {
      throw new ProductCameraSafetyError(
        "PRODUCT_CAMERA_SAFETY_CONTRADICTION",
        `Shot ${shot.id} camera safety contradicts the identity-safe camera policy`,
      );
    }
    if (!required) return shot;
    if (!proven) {
      throw new ProductCameraSafetyError(
        "PRODUCT_CAMERA_SAFETY_POLICY_INSUFFICIENT",
        `Shot ${shot.id} camera movement is not an identity-safe product camera`,
      );
    }
    return { ...shot, cameraSafety: proven };
  });
}
