"use client";



import { useState } from "react";

import type { TranslationKey } from "@ceo-agent/shared/i18n";

import { useI18n } from "@/lib/i18n/provider";

import { normalizeStepStatus, type StepStatus } from "@/lib/pipeline-config";

import { buildStepInsights } from "@/lib/pipeline-insights";



function StatusIcon({ status }: { status: StepStatus }) {

  if (status === "completed") {

    return (

      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-teal/15 text-brand-teal">

        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>

          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />

        </svg>

      </span>

    );

  }

  if (status === "running") {

    return (

      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-blue/15 text-brand-blue">

        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">

          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />

          <path

            className="opacity-75"

            fill="currentColor"

            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"

          />

        </svg>

      </span>

    );

  }

  if (status === "failed") {

    return (

      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">

        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>

          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />

        </svg>

      </span>

    );

  }

  if (status === "skipped") {

    return (

      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">

        <span className="text-xs font-bold">—</span>

      </span>

    );

  }

  return (

    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-border bg-white text-slate-300">

      <span className="h-2 w-2 rounded-full bg-slate-300" />

    </span>

  );

}



function statusLabel(status: StepStatus, t: (key: TranslationKey) => string): string {

  const key = `pipeline.status.${status}` as TranslationKey;

  return t(key);

}



export function PipelineStepCard({

  stepId,

  entry,

}: {

  stepId: string;

  entry?: {

    status: string;

    error?: string;

    output?: unknown;

    percent?: number;

    phase?: string;

  };

}) {

  const { t } = useI18n();

  const [expanded, setExpanded] = useState(false);

  const [showTechnical, setShowTechnical] = useState(false);



  const status = normalizeStepStatus(entry?.status);

  const label = t(`step.${stepId}` as TranslationKey);

  const insights = status === "completed" ? buildStepInsights(stepId, entry?.output) : null;

  const canExpand = Boolean(insights || entry?.error || stepId === "ffmpeg_render");



  return (

    <div

      className={`rounded-xl border transition-all duration-200 ${

        status === "running"

          ? "border-brand-blue/30 bg-brand-blue/5 shadow-sm"

          : status === "failed"

            ? "border-red-200 bg-red-50/40"

            : status === "completed"

              ? "border-border bg-surface"

              : "border-border/60 bg-surface-muted/50"

      }`}

    >

      <button

        type="button"

        disabled={!canExpand && status !== "running"}

        onClick={() => canExpand && setExpanded((v) => !v)}

        className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5"

      >

        <StatusIcon status={status} />

        <div className="min-w-0 flex-1">

          <p className="font-medium text-navy">{label}</p>

          <p

            className={`text-xs ${

              status === "completed"

                ? "text-brand-teal"

                : status === "running"

                  ? "text-brand-blue"

                  : status === "failed"

                    ? "text-red-600"

                    : "text-ink-secondary"

            }`}

          >

            {statusLabel(status, t)}

          </p>

        </div>

        {canExpand && (

          <svg

            className={`h-5 w-5 shrink-0 text-ink-secondary transition-transform ${expanded ? "rotate-180" : ""}`}

            fill="none"

            viewBox="0 0 24 24"

            stroke="currentColor"

          >

            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />

          </svg>

        )}

      </button>



      {status === "running" && stepId === "ffmpeg_render" && typeof entry?.percent === "number" && (

        <div className="border-t border-brand-blue/15 px-4 pb-4 pt-2 sm:px-5">

          <div className="mb-1 flex justify-between text-xs text-ink-secondary">

            <span>{t("pipeline.renderingVideo")}</span>

            <span className="tabular-nums">{entry.percent}%</span>

          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-border">

            <div

              className="h-full rounded-full bg-brand-blue transition-all duration-300"

              style={{ width: `${entry.percent}%` }}

            />

          </div>

        </div>

      )}



      {expanded && (

        <div className="border-t border-border px-4 pb-4 pt-3 sm:px-5">

          {entry?.error && (

            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{entry.error}</p>

          )}

          {insights && (

            <div className="space-y-2">

              <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">

                {insights.label}

              </p>

              <ul className="space-y-1.5">

                {insights.items.map((item) => (

                  <li key={item} className="flex gap-2 text-sm text-ink">

                    <span className="text-brand-blue">•</span>

                    <span className="line-clamp-2">{item}</span>

                  </li>

                ))}

              </ul>

              {insights.metric && (

                <p className="mt-2 text-sm text-ink-secondary">

                  <span className="font-medium">{insights.metric.label}:</span>{" "}

                  <span className="text-navy">{insights.metric.value}</span>

                </p>

              )}

            </div>

          )}

          <button

            type="button"

            onClick={() => setShowTechnical((v) => !v)}

            className="mt-3 text-xs text-ink-secondary hover:text-ink"

          >

            {showTechnical ? t("pipeline.hideTechnical") : t("pipeline.showTechnical")}

          </button>

          {showTechnical && (

            <p className="mt-1 font-mono text-[10px] text-ink-secondary">{stepId}</p>

          )}

        </div>

      )}

    </div>

  );

}


