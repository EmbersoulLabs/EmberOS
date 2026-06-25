/** Turn raw step output JSON into user-facing insight bullets. */

export interface StepInsight {
  label: string;
  items: string[];
  metric?: { label: string; value: string };
}

export function buildStepInsights(stepId: string, output: unknown): StepInsight | null {
  if (output == null) return null;
  const data = output as Record<string, unknown>;

  if (stepId === "content_generate" && data.voiceScripts) {
    const scripts = data.voiceScripts as Record<string, string>;
    const hooks = (data.hooks as Array<{ text?: string }> | undefined) ?? [];
    return {
      label: "Marketing package",
      items: [
        scripts["15s"] ? `15s: ${scripts["15s"].slice(0, 80)}…` : "",
        ...hooks.slice(0, 3).map((h) => h.text ?? "").filter(Boolean),
      ].filter(Boolean),
      metric:
        typeof data.consistencyScore === "number"
          ? { label: "Consistency", value: `${data.consistencyScore}/100` }
          : undefined,
    };
  }

  if (stepId === "hook_generate" && Array.isArray((data as { hooks?: unknown }).hooks)) {
    const hooks = (data as { hooks: Array<{ text?: string; type?: string }> }).hooks;
    return {
      label: "Generated hooks",
      items: hooks.slice(0, 5).map((h) => h.text ?? "").filter(Boolean),
    };
  }

  if (stepId === "copy_generate") {
    if (Array.isArray(output)) {
      const variants = output as Array<{ hook?: string; platform?: string; locale?: string }>;
      return {
        label: "Script variants",
        items: variants.slice(0, 4).map((v) => v.hook ?? "").filter(Boolean),
      };
    }
    if (Array.isArray(data)) {
      return {
        label: "Script variants",
        items: (data as Array<{ hook?: string }>).slice(0, 4).map((v) => v.hook ?? "").filter(Boolean),
      };
    }
  }

  if (stepId === "highlight_index" && Array.isArray(output)) {
    const segments = output as Array<{ reason?: string; attentionScore?: number; deadAir?: boolean }>;
    return {
      label: "Top moments scored",
      items: segments
        .filter((s) => !s.deadAir)
        .slice(0, 4)
        .map((s) => s.reason ?? "")
        .filter(Boolean),
    };
  }

  if (stepId === "clip_segment" && Array.isArray(output)) {
    const segments = output as Array<{ reason?: string; startSec?: number; endSec?: number }>;
    return {
      label: "Clip moments",
      items: segments.map(
        (s, i) => s.reason ?? `Highlight ${i + 1} (${Math.round(s.startSec ?? 0)}s–${Math.round(s.endSec ?? 0)}s)`
      ),
    };
  }

  if (stepId === "marketing_score" && typeof data.overallScore === "number") {
    const improvements = (data.improvements as string[] | undefined) ?? [];
    return {
      label: "Score breakdown",
      items: improvements.slice(0, 4),
      metric: { label: "Marketing confidence", value: `${data.overallScore}/100` },
    };
  }

  if (stepId === "vision_analyze" && Array.isArray(data.hooks)) {
    return {
      label: "Content insights",
      items: (data.hooks as string[]).slice(0, 4),
      metric:
        typeof data.confidence === "number"
          ? { label: "Confidence", value: `${Math.round((data.confidence as number) * 100)}%` }
          : undefined,
    };
  }

  if (stepId === "content_classify" && data.presetLabel) {
    return {
      label: "Format detected",
      items: [String(data.presetLabel), String(data.contentType ?? "")].filter(Boolean),
    };
  }

  if (stepId === "strategy_plan" && data.marketingAngle) {
    return {
      label: "Strategy",
      items: [
        String(data.marketingGoal ?? data.marketingAngle),
        String(data.marketingAngle),
        String(data.tone ?? ""),
      ].filter(Boolean),
      metric:
        typeof data.confidence === "number"
          ? { label: "Confidence", value: `${Math.round((data.confidence as number) * 100)}%` }
          : undefined,
    };
  }

  if (stepId === "compliance_check" && typeof data.passed === "boolean") {
    return {
      label: "Review",
      items: data.passed ? ["All checks passed"] : ["Issues flagged — see review queue"],
    };
  }

  return null;
}
