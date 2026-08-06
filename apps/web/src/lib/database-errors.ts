type DatabaseErrorLike = {
  code?: unknown;
  message?: unknown;
};

const SCHEMA_ERROR_CODES = new Set(["42P01", "42703"]);

export function isDatabaseSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as DatabaseErrorLike;
  return typeof candidate.code === "string" && SCHEMA_ERROR_CODES.has(candidate.code);
}
