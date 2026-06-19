"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useI18n } from "@/lib/i18n/provider";

interface ExportState {
  status: string;
  exportPackUrl: string | null;
  exportError?: string | null;
  creativeStatus?: string;
  renderStatus?: string;
  hasPreview?: boolean;
  hasFinal?: boolean;
  canExportPack?: boolean;
  blockReason?: string | null;
}

const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

export default function ExportPage() {
  const params = useParams();
  const id = params.id as string;
  const { t } = useI18n();
  const [state, setState] = useState<ExportState>({ status: "none", exportPackUrl: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "final_render" | "pack">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadExportState = useCallback(async (): Promise<ExportState> => {
    const res = await fetch(`/api/creatives/${id}/export`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? t("error.generic"));
    const next: ExportState = {
      status: data.status ?? "none",
      exportPackUrl: data.exportPackUrl ?? null,
      exportError: data.exportError ?? null,
      creativeStatus: data.creativeStatus,
      renderStatus: data.renderStatus,
      hasPreview: data.hasPreview,
      hasFinal: data.hasFinal,
      canExportPack: data.canExportPack,
      blockReason: data.blockReason,
    };
    setState(next);
    return next;
  }, [id, t]);

  useEffect(() => {
    loadExportState().catch((err) => setError(err instanceof Error ? err.message : t("error.generic")));
    return () => clearPoll();
  }, [loadExportState, clearPoll, t]);

  function statusHint(s: ExportState): string {
    if (s.exportPackUrl) return t("export.ready");
    if (phase === "pack" || s.status === "export_pending") return t("export.packing");
    if (phase === "final_render" || s.renderStatus === "final_rendering" || s.status === "final_rendering") {
      return t("export.finalRendering");
    }
    if (s.blockReason === "preview_not_ready") return t("export.waitPreview");
    if (s.blockReason === "final_not_ready") return t("export.needFinal");
    if (s.blockReason === "not_approved") return t("export.needApproval");
    return t("export.idle");
  }

  async function pollUntilDone() {
    clearPoll();
    startedAtRef.current = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        if (Date.now() - startedAtRef.current > POLL_TIMEOUT_MS) {
          clearPoll();
          setLoading(false);
          setPhase("idle");
          setError(t("export.timeout"));
          return;
        }

        const next = await loadExportState();

        if (next.exportError || next.status === "export_failed") {
          clearPoll();
          setLoading(false);
          setPhase("idle");
          setError(next.exportError ?? t("export.failed"));
          return;
        }

        if (next.exportPackUrl) {
          clearPoll();
          setLoading(false);
          setPhase("idle");
          return;
        }

        if (phase === "final_render" && next.hasFinal && next.renderStatus === "final_ready") {
          setPhase("pack");
          const postRes = await fetch(`/api/creatives/${id}/export`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const postData = await postRes.json();
          if (!postRes.ok) {
            throw new Error(postData.error ?? t("error.generic"));
          }
          if (postData.status === "final_rendering") return;
        }
      } catch (err) {
        clearPoll();
        setLoading(false);
        setPhase("idle");
        setError(err instanceof Error ? err.message : t("error.generic"));
      }
    }, POLL_MS);
  }

  async function triggerExport() {
    setLoading(true);
    setError("");
    clearPoll();

    try {
      const res = await fetch(`/api/creatives/${id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? t("error.generic"));
      }

      if (data.status === "final_rendering") {
        setPhase("final_render");
        await pollUntilDone();
        return;
      }

      if (data.status === "export_pending") {
        setPhase("pack");
        await pollUntilDone();
        return;
      }

      await loadExportState();
      setLoading(false);
    } catch (err) {
      setLoading(false);
      setPhase("idle");
      setError(err instanceof Error ? err.message : t("error.generic"));
    }
  }

  return (
    <AppShell>
      <h1 className="mb-2 text-2xl font-bold">{t("export.title")}</h1>
      <p className="mb-6 text-sm text-slate-500">{t("export.subtitle")}</p>

      <div className="mb-6 rounded-lg border bg-white p-4 text-sm">
        <p className="font-medium text-slate-800">{statusHint(state)}</p>
        <ul className="mt-3 space-y-1 text-slate-600">
          <li>
            {state.hasPreview ? "✓" : "○"} {t("export.stepPreview")}
          </li>
          <li>
            {state.hasFinal ? "✓" : "○"} {t("export.stepFinal")}
          </li>
          <li>
            {state.exportPackUrl ? "✓" : "○"} {t("export.stepZip")}
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-400">{t("export.timingHint")}</p>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {state.exportPackUrl ? (
        <a
          href={state.exportPackUrl}
          download
          className="inline-block rounded-lg bg-primary px-4 py-2 text-sm text-white"
        >
          {t("export.download")}
        </a>
      ) : (
        <button
          onClick={triggerExport}
          disabled={loading || state.blockReason === "preview_not_ready"}
          className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? t("export.working") : t("export.generate")}
        </button>
      )}
    </AppShell>
  );
}
