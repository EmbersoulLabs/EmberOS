"use client";



import Link from "next/link";

import { useI18n } from "@/lib/i18n/provider";



export function PipelineLoadingState() {

  const { t } = useI18n();

  return (

    <div className="animate-pulse space-y-6">

      <div className="h-36 rounded-xl bg-border/60" />

      <div className="space-y-3">

        {[1, 2, 3].map((i) => (

          <div key={i} className="h-16 rounded-xl bg-border/60" />

        ))}

      </div>

      <p className="text-center text-sm text-ink-secondary">{t("pipeline.loading")}</p>

    </div>

  );

}



export function PipelineEmptyState({ onBackHref }: { onBackHref: string }) {

  const { t } = useI18n();

  return (

    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface-muted/50 px-6 py-16 text-center">

      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-surface shadow-card">

        <svg className="h-7 w-7 text-border" fill="none" viewBox="0 0 24 24" stroke="currentColor">

          <path

            strokeLinecap="round"

            strokeLinejoin="round"

            strokeWidth={1.5}

            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"

          />

        </svg>

      </div>

      <h3 className="text-lg font-semibold text-navy">{t("pipeline.emptyTitle")}</h3>

      <p className="mt-2 max-w-sm text-sm text-ink-secondary">{t("pipeline.emptyBody")}</p>

      <Link href={onBackHref} className="brand-btn-primary mt-6">

        {t("pipeline.emptyCta")}

      </Link>

    </div>

  );

}



export function PipelineErrorBanner({

  message,

  onDismiss,

}: {

  message: string;

  onDismiss?: () => void;

}) {

  const { t } = useI18n();

  return (

    <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">

      <div className="flex gap-3">

        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">

          !

        </span>

        <div className="min-w-0 flex-1">

          <p className="font-medium text-red-900">{t("pipeline.errorTitle")}</p>

          <p className="mt-1 text-sm text-red-700">{message}</p>

        </div>

        {onDismiss && (

          <button type="button" onClick={onDismiss} className="text-red-400 hover:text-red-600">

            ×

          </button>

        )}

      </div>

    </div>

  );

}


