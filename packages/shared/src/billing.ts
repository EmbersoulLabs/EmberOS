export const FREE_EXPORT_RESOLUTION = "720p" as const;
export const PAID_EXPORT_RESOLUTION = "1080p" as const;
export type ExportResolution = typeof FREE_EXPORT_RESOLUTION | typeof PAID_EXPORT_RESOLUTION;
export type TaskExportResolution = ExportResolution | "2k";

/** Org plans that unlock 1080p export when EXPORT_PAYWALL is enabled. */
export const PAID_ORG_PLANS = new Set(["pro", "agency", "enterprise", "paid", "starter"]);

export function isPaidOrgPlan(plan: string | null | undefined): boolean {
  if (!plan) return false;
  return PAID_ORG_PLANS.has(plan.toLowerCase());
}

/**
 * When false (default in local/testing), 1080p export is open to all orgs.
 * Set EXPORT_PAYWALL=true in production to gate 1080p behind paid plans.
 */
export function exportPaywallEnabled(): boolean {
  const raw = process.env.EXPORT_PAYWALL ?? process.env.NEXT_PUBLIC_EXPORT_PAYWALL ?? "false";
  return raw === "true" || raw === "1";
}

/** Whether this org may download at the given resolution (respects EXPORT_PAYWALL). */
export function canDownloadResolution(
  plan: string | null | undefined,
  resolution: import("./render").ClipDownloadResolution
): boolean {
  if (resolution === "720p") return true;
  if (!exportPaywallEnabled()) return true;
  return isPaidOrgPlan(plan);
}

export function canExport1080p(plan: string | null | undefined): boolean {
  return canDownloadResolution(plan, "1080p");
}

export function parseExportResolution(
  value: unknown,
  defaultResolution: ExportResolution = FREE_EXPORT_RESOLUTION
): ExportResolution {
  if (value === PAID_EXPORT_RESOLUTION || value === FREE_EXPORT_RESOLUTION) return value;
  return defaultResolution;
}

export function parseTaskExportResolution(
  value: unknown,
  defaultResolution: TaskExportResolution = FREE_EXPORT_RESOLUTION
): TaskExportResolution {
  if (value === "2k") return "2k";
  if (value === PAID_EXPORT_RESOLUTION || value === FREE_EXPORT_RESOLUTION) return value;
  return defaultResolution;
}
