"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";

async function saveBlobDownload(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const filename = decodeURIComponent(match?.[1] ?? match?.[2] ?? fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function CopyDownloadButtons({
  creativeId,
  taskId,
  compact = false,
  disabled = false,
}: {
  creativeId?: string;
  taskId?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [working, setWorking] = useState<"txt" | "doc" | null>(null);
  const [error, setError] = useState("");

  async function download(format: "txt" | "doc") {
    if (!creativeId && !taskId) return;
    setError("");
    setWorking(format);
    try {
      const url = taskId
        ? `/api/tasks/${taskId}/copy/download?format=${format}`
        : `/api/creatives/${creativeId}/copy/download?format=${format}`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data.error as string) ?? t("creative.copyDownload.failed"));
        return;
      }
      await saveBlobDownload(res, `copy.${format === "doc" ? "doc" : "txt"}`);
    } catch {
      setError(t("creative.copyDownload.failed"));
    } finally {
      setWorking(null);
    }
  }

  const btnClass = compact
    ? "rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-navy transition hover:border-brand-blue/40 disabled:opacity-50"
    : "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-navy transition hover:border-brand-blue/40 disabled:opacity-50";

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {!compact && (
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink-secondary">
          {taskId ? t("creative.copyDownload.taskTitle") : t("creative.copyDownload.title")}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled || working !== null}
          onClick={() => void download("txt")}
          className={btnClass}
        >
          {working === "txt" ? "…" : t("creative.copyDownload.txt")}
        </button>
        <button
          type="button"
          disabled={disabled || working !== null}
          onClick={() => void download("doc")}
          className={btnClass}
        >
          {working === "doc" ? "…" : t("creative.copyDownload.word")}
        </button>
      </div>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
