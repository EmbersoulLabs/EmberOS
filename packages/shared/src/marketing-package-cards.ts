/** UI-SPEC-002 Marketing Package card ids (display only — not AI generation). */

export const MARKETING_PACKAGE_CARD_IDS = [
  "strategy",
  "report",
  "hook",
  "caption",
  "cta",
  "hashtags",
  "subtitle",
  "video",
] as const;

export type MarketingPackageCardId = (typeof MARKETING_PACKAGE_CARD_IDS)[number];

export type MarketingPackageUserEdited = Partial<Record<MarketingPackageCardId, string>>;

export function isMarketingPackageCardId(value: unknown): value is MarketingPackageCardId {
  return (
    typeof value === "string" &&
    (MARKETING_PACKAGE_CARD_IDS as readonly string[]).includes(value)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function firstHookText(hooksJson: unknown): string {
  const root = asRecord(hooksJson);
  if (!root) return "";
  const hooks = root.hooks;
  if (Array.isArray(hooks) && hooks.length > 0) {
    const first = hooks[0];
    if (typeof first === "string") return first;
    const row = asRecord(first);
    return textFromUnknown(row?.text ?? row?.hook ?? row?.content ?? first);
  }
  return textFromUnknown(hooksJson);
}

function copyVariantsText(copyVariants: unknown): string {
  if (!Array.isArray(copyVariants) || copyVariants.length === 0) return "";
  const lines: string[] = [];
  for (const item of copyVariants) {
    const row = asRecord(item);
    if (!row) continue;
    const platform = typeof row.platform === "string" ? `[${row.platform}] ` : "";
    const caption = textFromUnknown(row.caption ?? row.text ?? row.body);
    const cta = textFromUnknown(row.cta);
    const hashtags = Array.isArray(row.hashtags)
      ? row.hashtags.filter((h) => typeof h === "string").join(" ")
      : textFromUnknown(row.hashtags);
    if (caption) lines.push(`${platform}${caption}`);
    if (cta) lines.push(`CTA: ${cta}`);
    if (hashtags) lines.push(`# ${hashtags}`);
  }
  return lines.join("\n\n").trim();
}

export interface MarketingPackageContentInput {
  campaign?: {
    name?: string | null;
    campaignBrief?: string | null;
    strategyJson?: Record<string, unknown> | null;
  } | null;
  task?: {
    strategyJson?: Record<string, unknown> | null;
    hooksJson?: Record<string, unknown> | null;
    marketingScoreJson?: Record<string, unknown> | null;
  } | null;
  creative?: {
    copyVariants?: unknown[] | null;
    videoUrl?: string | null;
    videoExportUrl?: string | null;
    editPlan?: Record<string, unknown> | null;
  } | null;
  marketingPackage?: {
    userEdited?: MarketingPackageUserEdited | null;
    strategyRef?: unknown;
    reportRef?: unknown;
    hookRef?: string | null;
    captionRef?: string | null;
    ctaRef?: string | null;
    hashtagsRef?: string[] | null;
    subtitleRef?: string | null;
    videoRef?: string | null;
  } | null;
}

export type MarketingPackageContentSource = "user" | "pipeline" | "empty";

export interface ResolvedMarketingPackageCard {
  id: MarketingPackageCardId;
  text: string;
  source: MarketingPackageContentSource;
}

export function resolveMarketingPackageCardContent(
  cardId: MarketingPackageCardId,
  input: MarketingPackageContentInput
): ResolvedMarketingPackageCard {
  const userEdited = input.marketingPackage?.userEdited ?? {};
  const userText = userEdited[cardId]?.trim();
  if (userText) {
    return { id: cardId, text: userText, source: "user" };
  }

  const pkg = input.marketingPackage;
  const task = input.task;
  const creative = input.creative;
  const campaign = input.campaign;

  let pipelineText = "";
  switch (cardId) {
    case "strategy":
      pipelineText = textFromUnknown(
        pkg?.strategyRef ?? task?.strategyJson ?? campaign?.strategyJson
      );
      break;
    case "report":
      pipelineText = textFromUnknown(pkg?.reportRef ?? task?.marketingScoreJson);
      break;
    case "hook":
      pipelineText = (pkg?.hookRef ?? firstHookText(task?.hooksJson)).trim();
      break;
    case "caption":
      pipelineText = (pkg?.captionRef ?? copyVariantsText(creative?.copyVariants)).trim();
      break;
    case "cta": {
      const fromCopy = copyVariantsText(creative?.copyVariants);
      const ctaLine = fromCopy
        .split("\n")
        .find((l) => l.startsWith("CTA:"));
      pipelineText = (pkg?.ctaRef ?? ctaLine?.replace(/^CTA:\s*/, "") ?? "").trim();
      break;
    }
    case "hashtags": {
      const tags = pkg?.hashtagsRef;
      pipelineText = Array.isArray(tags)
        ? tags.join(" ")
        : copyVariantsText(creative?.copyVariants)
            .split("\n")
            .find((l) => l.startsWith("# "))
            ?.replace(/^# /, "") ?? "";
      break;
    }
    case "subtitle":
      pipelineText = (pkg?.subtitleRef ?? textFromUnknown(creative?.editPlan?.subtitles)).trim();
      break;
    case "video":
      pipelineText = (
        pkg?.videoRef ??
        creative?.videoExportUrl ??
        creative?.videoUrl ??
        ""
      ).trim();
      break;
  }

  if (pipelineText) {
    return { id: cardId, text: pipelineText, source: "pipeline" };
  }

  return { id: cardId, text: "", source: "empty" };
}

export function resolveAllMarketingPackageCards(
  input: MarketingPackageContentInput
): ResolvedMarketingPackageCard[] {
  return MARKETING_PACKAGE_CARD_IDS.map((id) => resolveMarketingPackageCardContent(id, input));
}

export function campaignHasMarketingPackageWorkspace(
  campaign: { firstGeneratedAt?: string | Date | null },
  task?: { status?: string | null } | null,
  marketingPackage?: unknown | null
): boolean {
  return Boolean(
    campaign.firstGeneratedAt || task?.status === "completed" || marketingPackage
  );
}
