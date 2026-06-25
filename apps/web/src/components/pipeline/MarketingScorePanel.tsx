"use client";



import { useI18n } from "@/lib/i18n/provider";

import { scoreLetterGrade, deriveStrengths } from "@/lib/score-utils";



export function MarketingScorePanel({ score }: { score: Record<string, unknown> }) {

  const { t } = useI18n();

  const overall = score.overallScore as number | undefined;

  const improvements = (score.improvements as string[] | undefined) ?? [];

  const strengths = deriveStrengths(score);



  if (overall === undefined) return null;



  const grade = scoreLetterGrade(overall);



  return (

    <section className="mt-8 brand-card overflow-hidden p-6 sm:p-8">

      <div className="flex flex-wrap items-start justify-between gap-6">

        <div>

          <p className="text-xs font-semibold uppercase tracking-widest text-brand-amber">

            {t("pipeline.score.potential")}

          </p>

          <div className="mt-2 flex items-baseline gap-3">

            <span className="text-4xl font-bold tracking-tight text-brand-amber">{grade}</span>

            <span className="text-lg font-medium tabular-nums text-ink-secondary">

              {overall} {t("pipeline.scoreOutOf")}

            </span>

          </div>

        </div>

      </div>



      <div className="mt-8 grid gap-8 sm:grid-cols-2">

        <div>

          <h3 className="text-sm font-semibold text-navy">{t("pipeline.score.strengths")}</h3>

          <ul className="mt-3 space-y-2">

            {strengths.map((item) => (

              <li key={item} className="flex gap-2 text-sm text-ink">

                <span className="text-brand-teal">✓</span>

                <span>{item}</span>

              </li>

            ))}

          </ul>

        </div>

        {improvements.length > 0 && (

          <div>

            <h3 className="text-sm font-semibold text-navy">{t("pipeline.score.improvements")}</h3>

            <ul className="mt-3 space-y-2">

              {improvements.map((item) => (

                <li key={item} className="flex gap-2 text-sm text-ink-secondary">

                  <span className="text-brand-amber">•</span>

                  <span>{item}</span>

                </li>

              ))}

            </ul>

          </div>

        )}

      </div>

    </section>

  );

}


