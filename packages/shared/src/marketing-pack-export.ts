import { displayPerformanceEstimate, resolvePlatformAssets } from "./marketing-dashboard";
import type { MarketingContentPackage } from "./types/marketing-os";

function block(title: string, body: string): string {
  const text = body.trim();
  if (!text) return "";
  return `## ${title}\n${text}\n`;
}

function lines(items: string[] | undefined): string {
  return (items ?? []).map((item) => item.trim()).filter(Boolean).join("\n");
}

function scriptBlock(label: string, scripts: { "15s"?: string; "30s"?: string; "60s"?: string } | undefined): string {
  if (!scripts) return "";
  const parts = [
    scripts["15s"]?.trim() ? `15s\n${scripts["15s"].trim()}` : "",
    scripts["30s"]?.trim() ? `30s\n${scripts["30s"].trim()}` : "",
    scripts["60s"]?.trim() ? `60s\n${scripts["60s"].trim()}` : "",
  ].filter(Boolean);
  return parts.length ? block(label, parts.join("\n\n")) : "";
}

/** Plain-text marketing deliverable. Uses stored package fields only. */
export function buildMarketingPackText(pkg: MarketingContentPackage, campaignName?: string): string {
  const assets = resolvePlatformAssets(pkg);
  const platformText = Object.entries(assets)
    .map(([id, asset]) => {
      if (!asset) return "";
      const tags = (asset.hashtags ?? []).filter(Boolean).join(" ");
      const body = [asset.title, asset.hook, asset.caption, asset.description, asset.cta, tags]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join("\n");
      return body ? `### ${id}\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  const enCaptions = pkg.captionsEn
    ? Object.entries(pkg.captionsEn)
        .filter(([, text]) => text?.trim())
        .map(([id, text]) => `### ${id}\n${text.trim()}`)
        .join("\n\n")
    : "";
  const msCaptions = pkg.captionsMs
    ? Object.entries(pkg.captionsMs)
        .filter(([, text]) => text?.trim())
        .map(([id, text]) => `### ${id}\n${text.trim()}`)
        .join("\n\n")
    : "";

  const brief = pkg.strategyBrief;
  const briefText = brief
    ? [
        brief.primaryGoal && `Goal: ${brief.primaryGoal}`,
        brief.targetAudience && `Audience: ${brief.targetAudience}`,
        brief.contentAngle && `Angle: ${brief.contentAngle}`,
        brief.painPoint && `Pain: ${brief.painPoint}`,
        brief.desiredEmotion && `Emotion: ${brief.desiredEmotion}`,
        brief.ctaStrategy && `CTA strategy: ${brief.ctaStrategy}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const timeline = (pkg.subtitleTimeline ?? [])
    .map((segment) => `${segment.startSec}s–${segment.endSec}s ${segment.role ? `(${segment.role}) ` : ""}${segment.text}`)
    .join("\n");

  const posting = pkg.postingRecommendation;
  const engagement = displayPerformanceEstimate(posting?.estimatedEngagement);
  const postingText = [
    posting?.bestPostingTime && `Time: ${posting.bestPostingTime}`,
    posting?.bestPlatform && `Platform: ${posting.bestPlatform}`,
    posting?.idealAudience && `Audience: ${posting.idealAudience}`,
    engagement && `Engagement note: ${engagement}`,
  ]
    .filter(Boolean)
    .join("\n");

  const hashtags = pkg.hashtagPack
    ? [
        lines(pkg.hashtagPack.highVolume) && `High volume: ${pkg.hashtagPack.highVolume.join(" ")}`,
        lines(pkg.hashtagPack.mediumVolume) && `Medium: ${pkg.hashtagPack.mediumVolume.join(" ")}`,
        lines(pkg.hashtagPack.local) && `Local: ${pkg.hashtagPack.local.join(" ")}`,
        lines(pkg.hashtagPack.brand) && `Brand: ${pkg.hashtagPack.brand.join(" ")}`,
        lines(pkg.hashtagPack.industry) && `Industry: ${pkg.hashtagPack.industry.join(" ")}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const sections = [
    `# Marketing package${campaignName ? `: ${campaignName}` : ""}`,
    pkg.contentOrigin === "template_fallback"
      ? "Origin: template fallback. This text was not produced by the model."
      : pkg.contentOrigin === "model"
        ? "Origin: model draft. Performance numbers are estimates only when present."
        : "",
    block("Strategy", briefText),
    scriptBlock("Primary scripts", pkg.voiceScripts),
    scriptBlock("Chinese scripts", pkg.voiceScriptsZh),
    scriptBlock("English scripts", pkg.voiceScriptsEn),
    block("Subtitle timeline", timeline),
    block(
      "Hooks",
      pkg.hooks.map((hook) => `- ${hook.type}: ${hook.text}`).join("\n")
    ),
    block("Calls to action", pkg.cta.map((item) => `- ${item.style ?? "cta"}: ${item.text}`).join("\n")),
    block("Platform captions", platformText),
    block("English captions", enCaptions),
    block("Malay captions", msCaptions),
    block("Hashtags", hashtags),
    block("B-roll", lines(pkg.broll)),
    block("Music mood", pkg.musicMood ?? ""),
    block("Effects", lines(pkg.effects)),
    block("Posting", postingText),
  ];

  return sections.filter(Boolean).join("\n").trim() + "\n";
}
