"use client";



import type { TranslationKey } from "@ceo-agent/shared/i18n";

import { useI18n } from "@/lib/i18n/provider";

import type { PipelinePhase } from "@/lib/pipeline-config";

import { PipelineStepCard } from "./PipelineStepCard";



const PHASE_NUMBERS = ["1", "2", "3", "4", "5"] as const;



export function PipelinePhases({

  phases,

  progress,

}: {

  phases: PipelinePhase[];

  progress: Record<

    string,

    { status: string; error?: string; output?: unknown; percent?: number; phase?: string }

  >;

}) {

  const { t } = useI18n();



  return (

    <div className="space-y-10">

      <div>

        <h2 className="text-lg font-semibold tracking-tight text-navy">{t("pipeline.pipelineTitle")}</h2>

        <p className="mt-1 text-sm text-ink-secondary">{t("pipeline.pipelineSubtitle")}</p>

      </div>

      {phases.map((phase, index) => (

        <section key={phase.id}>

          <div className="mb-4 flex items-baseline gap-2">

            <span className="text-xs font-bold uppercase tracking-widest text-brand-blue">

              {t("pipeline.phaseLabel", { n: PHASE_NUMBERS[index] ?? String(index + 1) })}

            </span>

            <h3 className="text-sm font-semibold text-navy">

              {t(phase.titleKey as TranslationKey)}

            </h3>

          </div>

          <div className="space-y-2">

            {phase.steps.map((stepId) => (

              <PipelineStepCard key={stepId} stepId={stepId} entry={progress[stepId]} />

            ))}

          </div>

        </section>

      ))}

    </div>

  );

}


