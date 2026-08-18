export const PHOTO_SCENE_PRODUCTION_SUPABASE_REF = "egkgybrjmzukzmkcrpag";
export const PHOTO_SCENE_PREVIEW_SUPABASE_REF = "voofxbuzpocyjzoxrpfi";
export const PHOTO_SCENE_OFFICIAL_BUCKET = "photo-scene-official";
export const PHOTO_SCENE_PROD_MIGRATION_ACK = "PHOTO_SCENE_V1";

export const PHOTO_SCENE_V1_MIGRATION_FILES = [
  "photo-scene-campaign-asset-refs-v1.sql",
  "photo-scene-generations-v1.sql",
  "photo-scene-official-scenes-v1.sql",
] as const;

export type PhotoSceneV1MigrationFile = (typeof PHOTO_SCENE_V1_MIGRATION_FILES)[number];

export const PHOTO_SCENE_V1_TABLES = [
  "campaign_asset_refs",
  "photo_scene_generations",
  "photo_scene_official_scenes",
  "photo_scene_official_scene_versions",
  "photo_scene_scene_selections",
] as const;

export type PhotoSceneSchemaObjectStatus = "ABSENT" | "COMPATIBLE" | "CONFLICT";

export type PhotoSceneSchemaPreflightResult = {
  databaseRef: string | null;
  overall: PhotoSceneSchemaObjectStatus;
  tables: Record<(typeof PHOTO_SCENE_V1_TABLES)[number], PhotoSceneSchemaObjectStatus>;
};

export function parseSupabaseProjectRef(databaseUrl: string): string | null {
  return (
    databaseUrl.match(/postgres\.([a-z0-9]+)/i)?.[1] ??
    databaseUrl.match(/([a-z0-9]+)\.supabase\.co/i)?.[1] ??
    null
  );
}

export function redactDatabaseTarget(databaseUrl: string): string {
  const ref = parseSupabaseProjectRef(databaseUrl);
  return ref ? `supabase:${ref}` : "database:unrecognized";
}

export function isPhotoSceneV1MigrationFile(name: string): name is PhotoSceneV1MigrationFile {
  return (PHOTO_SCENE_V1_MIGRATION_FILES as readonly string[]).includes(name);
}

export class PhotoSceneProductionGuardError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PhotoSceneProductionGuardError";
    this.code = code;
  }
}

function flagEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function assertProductionTarget(input: {
  databaseUrl: string;
  expectedRef?: string;
  allow: boolean;
  ack?: string;
  operation: "migration" | "seed" | "bucket";
}): { databaseRef: string } {
  const databaseRef = parseSupabaseProjectRef(input.databaseUrl);
  const expected = input.expectedRef?.trim() || PHOTO_SCENE_PRODUCTION_SUPABASE_REF;
  if (!input.allow) {
    throw new PhotoSceneProductionGuardError(
      "PRODUCTION_ALLOW_REQUIRED",
      `${input.operation} requires an explicit production allow flag`
    );
  }
  if (input.ack !== PHOTO_SCENE_PROD_MIGRATION_ACK) {
    throw new PhotoSceneProductionGuardError(
      "PRODUCTION_ACK_REQUIRED",
      `${input.operation} requires PHOTO_SCENE_PROD_MIGRATION_ACK=${PHOTO_SCENE_PROD_MIGRATION_ACK}`
    );
  }
  if (!databaseRef) {
    throw new PhotoSceneProductionGuardError("DATABASE_IDENTITY_UNKNOWN", "Database project identity is unknown");
  }
  if (databaseRef === PHOTO_SCENE_PREVIEW_SUPABASE_REF) {
    throw new PhotoSceneProductionGuardError(
      "WRONG_DATABASE",
      "Preview database is not a production Photo Scene target"
    );
  }
  if (databaseRef !== expected) {
    throw new PhotoSceneProductionGuardError(
      "WRONG_DATABASE",
      "Database project identity does not match the expected production Photo Scene target"
    );
  }
  return { databaseRef };
}

export function classifyPhotoSceneSchemaPreflight(input: {
  databaseRef: string | null;
  present: Partial<Record<(typeof PHOTO_SCENE_V1_TABLES)[number], boolean>>;
  compatible: Partial<Record<(typeof PHOTO_SCENE_V1_TABLES)[number], boolean>>;
}): PhotoSceneSchemaPreflightResult {
  const tables = {} as PhotoSceneSchemaPreflightResult["tables"];
  for (const table of PHOTO_SCENE_V1_TABLES) {
    const exists = input.present[table] === true;
    const ok = input.compatible[table] === true;
    tables[table] = !exists ? "ABSENT" : ok ? "COMPATIBLE" : "CONFLICT";
  }
  const statuses = Object.values(tables);
  const overall = statuses.every((status) => status === "ABSENT")
    ? "ABSENT"
    : statuses.every((status) => status === "COMPATIBLE")
      ? "COMPATIBLE"
      : "CONFLICT";
  return { databaseRef: input.databaseRef, overall, tables };
}

export type StoragePolicyRow = {
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  withCheck: string | null;
};

function policyTouchesAnonymous(policy: StoragePolicyRow): boolean {
  const roles = policy.roles.map((role) => role.toLowerCase());
  return roles.includes("anon") || roles.includes("public") || roles.length === 0;
}

function policyAllowsWrite(policy: StoragePolicyRow): boolean {
  const cmd = policy.cmd.toUpperCase();
  return cmd === "ALL" || cmd === "INSERT" || cmd === "UPDATE" || cmd === "DELETE";
}

function policyScopedToOfficialBucket(policy: StoragePolicyRow): boolean {
  const text = `${policy.qual ?? ""} ${policy.withCheck ?? ""}`;
  return text.includes(PHOTO_SCENE_OFFICIAL_BUCKET);
}

export function officialBucketAnonymousWriteDenied(policies: StoragePolicyRow[]): boolean {
  return !policies.some(
    (policy) =>
      policyTouchesAnonymous(policy) &&
      policyAllowsWrite(policy) &&
      (policyScopedToOfficialBucket(policy) || !policy.qual)
  );
}

export type PhotoroomProductionEnvCheck = {
  name: string;
  present: boolean;
  ok: boolean;
  expected: string;
};

export type PhotoroomProductionEnvResult = {
  status: "READY" | "MISSING";
  checks: PhotoroomProductionEnvCheck[];
};

export function evaluatePhotoroomProductionEnv(
  env: NodeJS.ProcessEnv = process.env
): PhotoroomProductionEnvResult {
  const provider = (env.PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER ?? "").trim();
  const apiKey = (env.PHOTOROOM_API_KEY ?? "").trim();
  const cost = (env.PHOTO_SCENE_PHOTOROOM_COST_USD ?? "").trim();
  const timeout = (env.PHOTO_SCENE_PROVIDER_TIMEOUT_MS ?? "").trim();
  const deterministic = (env.PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER ?? "").trim();
  const checks: PhotoroomProductionEnvCheck[] = [
    {
      name: "PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER",
      present: Boolean(provider),
      ok: provider.toLowerCase() === "photoroom",
      expected: "photoroom",
    },
    {
      name: "PHOTOROOM_API_KEY",
      present: Boolean(apiKey),
      ok: apiKey.length > 0,
      expected: "PRESENT",
    },
    {
      name: "PHOTO_SCENE_PHOTOROOM_COST_USD",
      present: Boolean(cost),
      ok: !cost || Number.isFinite(Number(cost)),
      expected: "numeric",
    },
    {
      name: "PHOTO_SCENE_PROVIDER_TIMEOUT_MS",
      present: Boolean(timeout),
      ok: !timeout || Number.isFinite(Number(timeout)),
      expected: "numeric",
    },
    {
      name: "PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER",
      present: deterministic.length > 0,
      ok: deterministic === "false",
      expected: "false",
    },
  ];
  return {
    status: checks.every((check) => check.ok) ? "READY" : "MISSING",
    checks,
  };
}

export const PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    slug: "floral-table",
    name: "Floral table",
    category: "lifestyle",
    tags: ["flowers", "table"],
    version: 1,
    presets: ["story_9x16", "portrait_4x5"],
    status: "published",
    kind: "floral",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
    slug: "studio-white",
    name: "Studio white",
    category: "studio",
    tags: ["seamless"],
    version: 1,
    presets: ["feed_1x1"],
    status: "published",
    kind: "studio",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
    slug: "marble-counter",
    name: "Marble counter",
    category: "kitchen",
    tags: ["marble"],
    version: 1,
    presets: ["story_9x16", "feed_1x1", "portrait_4x5"],
    status: "published",
    kind: "marble",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000004",
    slug: "draft-hidden",
    name: "Draft hidden",
    category: "internal",
    tags: ["draft"],
    version: 1,
    presets: ["feed_1x1"],
    status: "draft",
    kind: "draft",
  },
] as const;
