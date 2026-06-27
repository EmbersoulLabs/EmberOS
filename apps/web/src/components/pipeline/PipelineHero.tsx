"use client";



import type { TranslationKey } from "@ceo-agent/shared/i18n";

import { useI18n } from "@/lib/i18n/provider";

import { estimateTimeRemaining } from "@/lib/pipeline-config";



function stepLabel(step: string | null, t: (key: TranslationKey) => string): string {

  if (!step) return t("pipeline.starting");

  return t(`step.${step}` as TranslationKey);

}



export function PipelineHero({

  percent,

  currentStep,

  currentStepIndex,

  totalSteps,

  taskStatus,

}: {

  percent: number;

  currentStep: string | null;

  currentStepIndex: number;

  totalSteps: number;

  taskStatus?: string;

}) {

  const { t } = useI18n();



  const isComplete = taskStatus === "completed";

  const isFailed = taskStatus === "failed";

  const eta = taskStatus === "running" ? estimateTimeRemaining(percent) : "";



  return (

    <div className="brand-card relative overflow-hidden p-5 sm:p-6">

      <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-brand-blue/5 blur-3xl" />

      <div className="relative">

        <p className="text-[11px] font-medium uppercase tracking-widest text-brand-blue">
          {isComplete ? t("marketing.brand") : t("pipeline.title")}
        </p>



        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-4xl font-semibold tabular-nums tracking-tight ${
                isComplete ? "text-brand-teal" : "text-navy"
              }`}
            >

              {percent}

            </span>

            <span className="text-xl font-medium text-ink-secondary">%</span>

          </div>

          {taskStatus === "running" && (

            <div className="text-right">

              <p className="text-sm font-medium text-ink">

                {t("pipeline.stepOf", {

                  current: String(Math.min(currentStepIndex, totalSteps)),

                  total: String(totalSteps),

                })}

              </p>

              {eta && (

                <p className="mt-1 text-xs text-ink-secondary">

                  {t("pipeline.eta", { time: eta })}

                </p>

              )}

            </div>

          )}

        </div>



        <div className="mt-5 h-3 overflow-hidden rounded-full bg-border">

          <div

            className={`h-full rounded-full transition-all duration-700 ease-out ${

              isFailed

                ? "bg-red-500"

                : isComplete

                  ? "bg-brand-teal"

                  : "bg-brand-blue"

            }`}

            style={{ width: `${percent}%` }}

          />

        </div>



        {taskStatus === "running" && (

          <p className="mt-4 text-sm text-ink-secondary">{stepLabel(currentStep, t)}</p>

        )}

        {isComplete && (

          <p className="mt-4 text-sm text-brand-teal">{t("pipeline.complete")}</p>

        )}

        {isFailed && (

          <p className="mt-4 text-sm text-red-600">{t("pipeline.failed")}</p>

        )}



        {taskStatus === "running" && (

          <p className="mt-2 text-xs text-ink-secondary">{t("pipeline.renderHint")}</p>

        )}

      </div>

    </div>

  );

}


