"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  const slug = params.slug as string;
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

  const steps = [
    { done: state.hasPreview, label: t("export.stepPreview") },
    { done: state.hasFinal, label: t("export.stepFinal") },
    { done: Boolean(state.exportPackUrl), label: t("export.stepZip") },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <div className="mb-6 border-b border-border/70 pb-4">
          <p className="text-[11px] font-medium uppercase tracking-widest text-ink-secondary">
            {t("marketing.brand")}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-navy">{t("export.title")}</h1>
          <p className="mt-1 text-sm text-ink-secondary">{t("export.subtitle")}</p>
        </div>

        <section className="rounded-xl border border-border/80 bg-surface p-5 shadow-card">
          <p className="text-sm font-medium text-navy">{statusHint(state)}</p>
          <ul className="mt-4 space-y-2">
            {steps.map((step) => (
              <li
                key={step.label}
                className={`flex items-center gap-2 text-sm ${
                  step.done ? "text-brand-teal" : "text-ink-secondary"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    step.done ? "bg-brand-teal/15 text-brand-teal" : "bg-surface-muted text-ink-secondary"
                  }`}
                >
                  {step.done ? "✓" : "○"}
                </span>
                {step.label}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-secondary">{t("export.timingHint")}</p>
        </section>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {state.exportPackUrl ? (
            <a
              href={state.exportPackUrl}
              download
              className="inline-flex h-10 items-center rounded-lg bg-navy px-5 text-sm font-medium text-white shadow-sm hover:bg-navy/90"
            >
              {t("export.download")}
            </a>
          ) : (
            <button
              type="button"
              onClick={triggerExport}
              disabled={loading || state.blockReason === "preview_not_ready"}
              className="inline-flex h-10 items-center rounded-lg bg-navy px-5 text-sm font-medium text-white shadow-sm hover:bg-navy/90 disabled:opacity-50"
            >
              {loading ? t("export.working") : t("export.generate")}
            </button>
          )}
          <Link
            href={`/w/${slug}/creatives/${id}`}
            className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-medium text-ink-secondary hover:text-navy"
          >
            {t("nav.back")}
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
