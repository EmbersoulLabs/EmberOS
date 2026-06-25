"use client";



import Link from "next/link";

import { useI18n } from "@/lib/i18n/provider";

import { StatusBadge } from "@/components/AppShell";

import { extractClipMeta, formatClipDuration } from "@/lib/clip-utils";

import { scoreLetterGrade } from "@/lib/score-utils";
import { ClipDownloadMenu } from "@/components/pipeline/ClipDownloadMenu";



export function SingleCreativePreview({

  slug,

  creative,

}: {

  slug: string;

  creative: Record<string, unknown>;

}) {

  const { t } = useI18n();

  const id = creative.id as string | undefined;

  const videoUrl = creative.videoUrl as string | undefined;

  const renderStatus = creative.renderStatus as string | undefined;

  const meta = extractClipMeta(creative);

  const status = videoUrl

    ? "preview_ready"

    : renderStatus === "preview_rendering"

      ? "preview_rendering"

      : "queued";



  return (

    <section className="mt-8">

      <div className="mb-5">

        <h2 className="text-lg font-semibold tracking-tight text-navy">{t("pipeline.clipsResultsTitle")}</h2>

        <p className="mt-1 text-sm text-ink-secondary">{t("pipeline.previewTitle")}</p>

      </div>

      <div className="brand-card mx-auto max-w-md overflow-hidden">

        {videoUrl ? (

          <video

            src={videoUrl}

            controls

            className="aspect-[9/16] w-full bg-navy object-contain"

          />

        ) : (

          <div className="flex aspect-[9/16] flex-col items-center justify-center gap-2 bg-surface-muted text-ink-secondary">

            {renderStatus === "preview_rendering" ? (

              <>

                <svg className="h-8 w-8 animate-spin text-brand-blue" viewBox="0 0 24 24" fill="none">

                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />

                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />

                </svg>

                <span className="text-xs">{t("pipeline.status.running")}</span>

              </>

            ) : (

              <span className="text-xs">{t("pipeline.clipWaiting")}</span>

            )}

          </div>

        )}



        <div className="space-y-3 p-4">

          <div className="flex items-center justify-between gap-2">

            <p className="text-sm font-semibold text-navy">{t("pipeline.previewTitle")}</p>

            <StatusBadge status={status} />

          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">

            <div>

              <dt className="text-ink-secondary">{t("pipeline.clip.duration")}</dt>

              <dd className="mt-0.5 font-medium tabular-nums text-ink">

                {formatClipDuration(meta.durationSec)}

              </dd>

            </div>

            <div>

              <dt className="text-ink-secondary">{t("pipeline.clip.score")}</dt>

              <dd className="mt-0.5 font-medium text-brand-amber">

                {meta.score != null ? (

                  <>

                    {scoreLetterGrade(meta.score)}{" "}

                    <span className="text-ink-secondary">({meta.score})</span>

                  </>

                ) : (

                  "—"

                )}

              </dd>

            </div>

          </dl>

          {videoUrl && id && (
            <>
              <ClipDownloadMenu creativeId={id} clipLabel="clip_1" />
              <Link

              href={`/w/${slug}/creatives/${id}`}

              className="block text-center text-xs font-medium text-brand-blue transition hover:text-brand-blue/80"

            >

              {t("pipeline.viewClipDetails")}

            </Link>
            </>
          )}

        </div>

      </div>

    </section>

  );

}


