import { z } from "zod";

export const VISUAL_STYLE_AUTHORITY_VERSION = "visual-style-authority/v1" as const;
export const COVER_COMPOSITION_AUTHORITY_VERSION =
  "cover-composition-authority/v1" as const;

const NonEmptyTextSchema = z.string().trim().min(1);
const FingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const VisualSourceLineageSchema = z
  .object({
    sourceKind: z.enum(["asset", "photo_scene", "brand_reference"]),
    assetId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    storagePath: NonEmptyTextSchema,
    contentFingerprint: NonEmptyTextSchema,
    readiness: z.enum(["ready", "pending", "rejected"]),
  })
  .strict();

export type VisualSourceLineage = z.infer<typeof VisualSourceLineageSchema>;

export const VisualStylePreferencesSchema = z
  .object({
    artDirection: NonEmptyTextSchema,
    paletteBehavior: z.enum(["brand_led", "source_led", "restrained", "vibrant"]),
    lighting: z.enum(["natural", "studio", "cinematic", "high_key", "low_key"]),
    texture: z.enum(["clean", "film_grain", "tactile", "glossy"]),
    contrast: z.enum(["soft", "balanced", "bold"]),
    compositionRhythm: z.enum(["calm", "balanced", "dynamic"]),
    negativeSpace: z.enum(["minimal", "balanced", "generous"]),
  })
  .strict();

export type VisualStylePreferences = z.infer<typeof VisualStylePreferencesSchema>;

export const VisualStyleAuthoritySchema = z
  .object({
    contractVersion: z.literal(VISUAL_STYLE_AUTHORITY_VERSION),
    authorityId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    presetId: NonEmptyTextSchema,
    presetVersion: z.number().int().positive(),
    preferences: VisualStylePreferencesSchema,
    sourceLineage: z.array(VisualSourceLineageSchema),
    semanticFingerprint: FingerprintSchema,
  })
  .strict();

export type VisualStyleAuthority = z.infer<typeof VisualStyleAuthoritySchema>;

export const CoverCompositionPreferencesSchema = z
  .object({
    aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]),
    focalPlacement: z.enum(["center", "left_third", "right_third"]),
    textZone: z.enum(["top", "bottom", "left", "right", "none"]),
    headlineLinesMax: z.number().int().min(1).max(4),
    safeAreaPercent: z.number().int().min(4).max(20),
    hierarchy: z.tuple([
      z.enum(["identity", "subject", "headline"]),
      z.enum(["identity", "subject", "headline"]),
      z.enum(["identity", "subject", "headline"]),
    ]),
    legibility: z.enum(["overlay", "solid_field", "source_contrast"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.hierarchy).size !== value.hierarchy.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hierarchy"],
        message: "Cover hierarchy entries must be unique",
      });
    }
  });

export type CoverCompositionPreferences = z.infer<
  typeof CoverCompositionPreferencesSchema
>;

export const CoverCompositionAuthoritySchema = z
  .object({
    contractVersion: z.literal(COVER_COMPOSITION_AUTHORITY_VERSION),
    authorityId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    visualStyleFingerprint: FingerprintSchema,
    preferences: CoverCompositionPreferencesSchema,
    sourceLineage: z.array(VisualSourceLineageSchema),
    semanticFingerprint: FingerprintSchema,
  })
  .strict();

export type CoverCompositionAuthority = z.infer<
  typeof CoverCompositionAuthoritySchema
>;

export const VisualAuthorityStoryBindingSchema = z
  .object({
    workspaceId: z.string().uuid(),
    campaignId: z.string().uuid(),
    storyId: z.string().uuid(),
    storyVersionId: z.string().uuid(),
    storyVersionNumber: z.number().int().positive(),
    visualStyleAuthorityId: z.string().uuid(),
    visualStyleFingerprint: FingerprintSchema,
    coverCompositionAuthorityId: z.string().uuid(),
    coverCompositionFingerprint: FingerprintSchema,
  })
  .strict();

export type VisualAuthorityStoryBinding = z.infer<
  typeof VisualAuthorityStoryBindingSchema
>;

export type VisualStylePreset = Readonly<{
  id: string;
  version: 1;
  label: string;
  description: string;
  style: VisualStylePreferences;
  cover: CoverCompositionPreferences;
}>;

export const VISUAL_STYLE_PRESETS = deepFreeze([
  {
    id: "brand-minimal",
    version: 1,
    label: "Brand Minimal",
    description: "Restrained brand-led visuals with generous breathing room.",
    style: {
      artDirection: "Clean editorial restraint with clear brand recognition",
      paletteBehavior: "brand_led",
      lighting: "studio",
      texture: "clean",
      contrast: "balanced",
      compositionRhythm: "calm",
      negativeSpace: "generous",
    },
    cover: {
      aspectRatio: "4:5",
      focalPlacement: "right_third",
      textZone: "left",
      headlineLinesMax: 3,
      safeAreaPercent: 8,
      hierarchy: ["identity", "subject", "headline"],
      legibility: "source_contrast",
    },
  },
  {
    id: "cinematic-story",
    version: 1,
    label: "Cinematic Story",
    description: "Narrative depth, controlled contrast, and cinematic pacing.",
    style: {
      artDirection: "Cinematic narrative frames with emotional depth",
      paletteBehavior: "source_led",
      lighting: "cinematic",
      texture: "film_grain",
      contrast: "bold",
      compositionRhythm: "balanced",
      negativeSpace: "balanced",
    },
    cover: {
      aspectRatio: "16:9",
      focalPlacement: "center",
      textZone: "bottom",
      headlineLinesMax: 2,
      safeAreaPercent: 8,
      hierarchy: ["subject", "headline", "identity"],
      legibility: "overlay",
    },
  },
  {
    id: "product-hero",
    version: 1,
    label: "Product Hero",
    description: "Crisp product-led composition with conversion-focused clarity.",
    style: {
      artDirection: "Polished commercial product presentation",
      paletteBehavior: "brand_led",
      lighting: "high_key",
      texture: "glossy",
      contrast: "bold",
      compositionRhythm: "dynamic",
      negativeSpace: "balanced",
    },
    cover: {
      aspectRatio: "1:1",
      focalPlacement: "right_third",
      textZone: "left",
      headlineLinesMax: 3,
      safeAreaPercent: 10,
      hierarchy: ["subject", "identity", "headline"],
      legibility: "solid_field",
    },
  },
  {
    id: "social-impact",
    version: 1,
    label: "Social Impact",
    description: "Fast-scanning social composition with a bold opening read.",
    style: {
      artDirection: "Immediate, energetic social-first visual communication",
      paletteBehavior: "vibrant",
      lighting: "natural",
      texture: "clean",
      contrast: "bold",
      compositionRhythm: "dynamic",
      negativeSpace: "minimal",
    },
    cover: {
      aspectRatio: "9:16",
      focalPlacement: "center",
      textZone: "top",
      headlineLinesMax: 2,
      safeAreaPercent: 12,
      hierarchy: ["subject", "headline", "identity"],
      legibility: "overlay",
    },
  },
] satisfies VisualStylePreset[]);

export function getVisualStylePreset(id: string): VisualStylePreset | null {
  return VISUAL_STYLE_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function createVisualStyleAuthority(input: {
  authorityId: string;
  workspaceId: string;
  presetId: string;
  sourceLineage?: readonly VisualSourceLineage[];
}): Readonly<VisualStyleAuthority> {
  const preset = getVisualStylePreset(input.presetId);
  if (!preset) throw new Error(`Unknown visual style preset: ${input.presetId}`);
  const semantic = {
    contractVersion: VISUAL_STYLE_AUTHORITY_VERSION,
    workspaceId: input.workspaceId,
    presetId: preset.id,
    presetVersion: preset.version,
    preferences: preset.style,
    sourceLineage: input.sourceLineage ?? [],
  };
  return deepFreeze(
    VisualStyleAuthoritySchema.parse({
      authorityId: input.authorityId,
      ...semantic,
      semanticFingerprint: fingerprintSemanticValue(semantic),
    })
  );
}

export function createCoverCompositionAuthority(input: {
  authorityId: string;
  workspaceId: string;
  visualStyle: VisualStyleAuthority;
  sourceLineage?: readonly VisualSourceLineage[];
}): Readonly<CoverCompositionAuthority> {
  const preset = getVisualStylePreset(input.visualStyle.presetId);
  if (!preset || preset.version !== input.visualStyle.presetVersion) {
    throw new Error("Visual style preset version is not registered");
  }
  if (input.workspaceId !== input.visualStyle.workspaceId) {
    throw new Error("Cover and visual style authorities must share a workspace");
  }
  const semantic = {
    contractVersion: COVER_COMPOSITION_AUTHORITY_VERSION,
    workspaceId: input.workspaceId,
    visualStyleFingerprint: input.visualStyle.semanticFingerprint,
    preferences: preset.cover,
    sourceLineage: input.sourceLineage ?? input.visualStyle.sourceLineage,
  };
  return deepFreeze(
    CoverCompositionAuthoritySchema.parse({
      authorityId: input.authorityId,
      ...semantic,
      semanticFingerprint: fingerprintSemanticValue(semantic),
    })
  );
}

export type IdentityAuthorityInput = Readonly<{
  character?: readonly string[];
  product?: readonly string[];
  brand?: readonly string[];
}>;

export type ResolvedVisualDirection = Readonly<{
  identityConstraints: readonly Readonly<{
    authority: "character" | "product" | "brand";
    instruction: string;
  }>[];
  stylePreferences: VisualStylePreferences;
  precedence: readonly ["character", "product", "brand", "visual_style"];
}>;

/**
 * Identity is preserved as a separate constraint channel. Style is always last
 * and cannot replace Character, Product, or Brand authority.
 */
export function resolveVisualDirection(
  identity: IdentityAuthorityInput,
  visualStyle: VisualStyleAuthority
): ResolvedVisualDirection {
  const identityConstraints = (
    [
      ["character", identity.character ?? []],
      ["product", identity.product ?? []],
      ["brand", identity.brand ?? []],
    ] as const
  ).flatMap(([authority, values]) =>
    values.map((instruction) => deepFreeze({ authority, instruction }))
  );
  return deepFreeze({
    identityConstraints,
    stylePreferences: visualStyle.preferences,
    precedence: ["character", "product", "brand", "visual_style"] as const,
  });
}

export type VisualAuthorityReadinessIssue = Readonly<{
  code:
    | "workspace_mismatch"
    | "storage_path_not_workspace_scoped"
    | "source_not_ready"
    | "source_asset_missing"
    | "visual_style_fingerprint_mismatch"
    | "cover_fingerprint_mismatch"
    | "cover_style_binding_mismatch"
    | "story_binding_mismatch";
  message: string;
}>;

export function validateVisualAuthorityReadiness(input: {
  workspaceId: string;
  storyId: string;
  storyVersionId: string;
  availableAssetIds: ReadonlySet<string>;
  visualStyle: VisualStyleAuthority;
  cover: CoverCompositionAuthority;
  binding: VisualAuthorityStoryBinding;
}): Readonly<{ ready: boolean; issues: readonly VisualAuthorityReadinessIssue[] }> {
  const issues: VisualAuthorityReadinessIssue[] = [];
  if (
    input.visualStyle.workspaceId !== input.workspaceId ||
    input.cover.workspaceId !== input.workspaceId ||
    input.binding.workspaceId !== input.workspaceId
  ) {
    issues.push({
      code: "workspace_mismatch",
      message: "All visual authorities and binding must belong to the active workspace",
    });
  }
  const lineage = [...input.visualStyle.sourceLineage, ...input.cover.sourceLineage];
  for (const source of lineage) {
    if (source.workspaceId !== input.workspaceId) {
      issues.push({
        code: "workspace_mismatch",
        message: `Source ${source.assetId} belongs to a different workspace`,
      });
    }
    if (!source.storagePath.startsWith(`${input.workspaceId}/`)) {
      issues.push({
        code: "storage_path_not_workspace_scoped",
        message: `Source ${source.assetId} does not use the workspace storage prefix`,
      });
    }
    if (source.readiness !== "ready") {
      issues.push({
        code: "source_not_ready",
        message: `Source ${source.assetId} is ${source.readiness}`,
      });
    }
    if (!input.availableAssetIds.has(source.assetId)) {
      issues.push({
        code: "source_asset_missing",
        message: `Source ${source.assetId} is not an available workspace Asset`,
      });
    }
  }
  const visualSemantic = {
    contractVersion: input.visualStyle.contractVersion,
    workspaceId: input.visualStyle.workspaceId,
    presetId: input.visualStyle.presetId,
    presetVersion: input.visualStyle.presetVersion,
    preferences: input.visualStyle.preferences,
    sourceLineage: input.visualStyle.sourceLineage,
  };
  if (
    fingerprintSemanticValue(visualSemantic) !== input.visualStyle.semanticFingerprint
  ) {
    issues.push({
      code: "visual_style_fingerprint_mismatch",
      message: "Visual Style Authority semantic fingerprint is invalid",
    });
  }
  const coverSemantic = {
    contractVersion: input.cover.contractVersion,
    workspaceId: input.cover.workspaceId,
    visualStyleFingerprint: input.cover.visualStyleFingerprint,
    preferences: input.cover.preferences,
    sourceLineage: input.cover.sourceLineage,
  };
  if (fingerprintSemanticValue(coverSemantic) !== input.cover.semanticFingerprint) {
    issues.push({
      code: "cover_fingerprint_mismatch",
      message: "Cover Composition Authority semantic fingerprint is invalid",
    });
  }
  if (
    input.cover.visualStyleFingerprint !== input.visualStyle.semanticFingerprint ||
    input.binding.visualStyleFingerprint !== input.visualStyle.semanticFingerprint ||
    input.binding.coverCompositionFingerprint !== input.cover.semanticFingerprint
  ) {
    issues.push({
      code: "cover_style_binding_mismatch",
      message: "Cover, style, and story binding fingerprints do not agree",
    });
  }
  if (
    input.binding.storyId !== input.storyId ||
    input.binding.storyVersionId !== input.storyVersionId ||
    input.binding.visualStyleAuthorityId !== input.visualStyle.authorityId ||
    input.binding.coverCompositionAuthorityId !== input.cover.authorityId
  ) {
    issues.push({
      code: "story_binding_mismatch",
      message: "Authorities are not bound to the active Story Version",
    });
  }
  return deepFreeze({ ready: issues.length === 0, issues });
}

export function fingerprintSemanticValue(value: unknown): string {
  return `sha256:${sha256(canonicalJson(value))}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

// Small synchronous SHA-256 implementation keeps contracts usable in browser and server code.
function sha256(message: string): string {
  const rightRotate = (value: number, amount: number) =>
    (value >>> amount) | (value << (32 - amount));
  const maxWord = 2 ** 32;
  const words: number[] = [];
  const messageBytes = new TextEncoder().encode(message);
  const bitLength = messageBytes.length * 8;
  const padded = new Uint8Array(
    Math.ceil((messageBytes.length + 9) / 64) * 64
  );
  padded.set(messageBytes);
  padded[messageBytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLength >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLength / maxWord));
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f,
    0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  for (let offset = 0; offset < padded.length; offset += 64) {
    const schedule = new Array<number>(64);
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const a = schedule[index - 15]!;
      const b = schedule[index - 2]!;
      const s0 = rightRotate(a, 7) ^ rightRotate(a, 18) ^ (a >>> 3);
      const s1 = rightRotate(b, 17) ^ rightRotate(b, 19) ^ (b >>> 10);
      schedule[index] =
        (schedule[index - 16]! + s0 + schedule[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 =
        rightRotate(e!, 6) ^ rightRotate(e!, 11) ^ rightRotate(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temp1 = (h! + sum1 + choice + constants[index]! + schedule[index]!) >>> 0;
      const sum0 =
        rightRotate(a!, 2) ^ rightRotate(a!, 13) ^ rightRotate(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0]! + a!) >>> 0;
    hash[1] = (hash[1]! + b!) >>> 0;
    hash[2] = (hash[2]! + c!) >>> 0;
    hash[3] = (hash[3]! + d!) >>> 0;
    hash[4] = (hash[4]! + e!) >>> 0;
    hash[5] = (hash[5]! + f!) >>> 0;
    hash[6] = (hash[6]! + g!) >>> 0;
    hash[7] = (hash[7]! + h!) >>> 0;
  }
  return hash.map((part) => part.toString(16).padStart(8, "0")).join("");
}
