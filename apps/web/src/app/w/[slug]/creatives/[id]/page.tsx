"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { RunCeoButton } from "@/components/RunCeoButton";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";
import { ClipAudioControls } from "@/components/pipeline/ClipAudioControls";
import { ClipDownloadMenu } from "@/components/pipeline/ClipDownloadMenu";
import { CopyDownloadButtons } from "@/components/pipeline/CopyDownloadButtons";
import { CreativeSubtitleSettings } from "@/components/pipeline/CreativeSubtitleSettings";
import { MusicMatchPanel } from "@/components/pipeline/MusicMatchPanel";
import { formatPlatformLabel, videoUrlWithCacheBust } from "@/lib/clip-utils";
import { latestRejectedReview } from "@ceo-agent/shared";
import { isCreativeExportable } from "@ceo-agent/shared";
import type { EditPlan } from "@ceo-agent/shared";

interface CopyVariant {
  id: string;
  hook: string;
  body: string;
  cta: string;
  title: string;
  tags: string[];
  platform: string;
  locale?: "en" | "zh";
}

function variantLabel(v: CopyVariant, t: (k: TranslationKey) => string): string {
  const lang =
    v.locale === "zh" ? t("creative.variantZh") : v.locale === "en" ? t("creative.variantEn") : "";
  const plat = formatPlatformLabel(v.platform);
  return lang ? `${plat} · ${lang}` : plat;
}

const FIELD_KEYS: Record<"hook" | "body" | "cta" | "title", TranslationKey> = {
  hook: "creative.field.hook",
  body: "creative.field.body",
  cta: "creative.field.cta",
  title: "creative.field.title",
};

export default function CreativePreviewPage() {
  const params = useParams();
  const slug = params.slug as string;
  const id = params.id as string;
  const { t } = useI18n();

  const [creative, setCreative] = useState<Record<string, unknown> | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [siblingClips, setSiblingClips] = useState<Array<{ id: string }>>([]);
  const [clipIndex, setClipIndex] = useState(0);
  const [activeVariant, setActiveVariant] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<CopyVariant>>({});
  const [copySaveHint, setCopySaveHint] = useState("");
  const [reviews, setReviews] = useState<
    Array<{ decision: string; comment?: string | null; decidedAt?: string | null }>
  >([]);
  const [submitHint, setSubmitHint] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  function refreshCreative() {
    fetch(`/api/creatives/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.creative) setCreative(d.creative);
        if (d.reviews) setReviews(d.reviews);
      });
  }

  useEffect(() => {
    fetch(`/api/creatives/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setCreative(d.creative);
        setReviews((d.reviews as typeof reviews) ?? []);
        setCampaignId(d.campaign?.id ?? null);
        setSiblingClips((d.siblingCreatives as Array<{ id: string }>) ?? []);
        setClipIndex(typeof d.clipIndex === "number" && d.clipIndex >= 0 ? d.clipIndex : 0);
        if (d.campaign?.id) {
          fetch(`/api/campaigns/${d.campaign.id}`)
            .then((r) => r.json())
            .then((cd) => setTaskStatus((cd.task?.status as string) ?? null));
        }
      });
  }, [id]);

  useEffect(() => {
    if ((creative?.renderStatus as string | undefined) !== "preview_rendering") return;
    const interval = setInterval(refreshCreative, 3000);
    return () => clearInterval(interval);
  }, [id, creative?.renderStatus]);

  const variants = (creative?.copyVariants ?? []) as CopyVariant[];
  const sortedVariants = [...variants].sort((a, b) => {
    const order = (v: CopyVariant) => {
      if (v.locale === "en" && v.platform === "tiktok") return 0;
      if (v.locale === "en" && v.platform === "instagram") return 1;
      if (v.locale === "zh") return 2;
      return 3;
    };
    return order(a) - order(b);
  });
  const variant = sortedVariants[activeVariant] ?? variants[activeVariant];
  const isRendering = creative?.renderStatus === "preview_rendering";
  const videoUrl = creative?.videoUrl as string | undefined;

  async function saveCopy() {
    if (!variant) return;
    setCopySaveHint("");
    const res = await fetch(`/api/creatives/${id}/copy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variant.id, ...editForm }),
    });
    const data = await res.json();
    if (!res.ok) {
      setCopySaveHint(data.error ?? t("error.generic"));
      return;
    }
    if (data.creative) setCreative(data.creative);
    if (data.rerenderQueued) setCopySaveHint(t("creative.copySavedRerender"));
    setEditMode(false);
  }

  async function submitReview() {
    setSubmitHint("");
    setSubmittingReview(true);
    try {
      const res = await fetch(`/api/creatives/${id}/submit-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "internal" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitHint(data.error ?? t("creative.resubmitFailed"));
        return;
      }
      setSubmitHint(t("creative.resubmitSuccess"));
      refreshCreative();
    } finally {
      setSubmittingReview(false);
    }
  }

  const creativeStatus = creative?.status as string | undefined;
  const wasRejected = creativeStatus === "compliance_failed";
  const lastRejection = latestRejectedReview(reviews);
  const canExport = creativeStatus ? isCreativeExportable(creativeStatus) : false;
  const reviewPending =
    creativeStatus === "pending_internal_review" || creativeStatus === "pending_client_review";

  const btn =
    "inline-flex h-8 items-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-ink-secondary transition hover:border-navy/25 hover:text-navy";

  return (
    <AppShell>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-widest text-ink-secondary">
            {t("marketing.brand")}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-navy">{t("creative.title")}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {creative && <StatusBadge status={creative.status as string} />}
          {campaignId && (
            <RunCeoButton campaignId={campaignId} slug={slug} taskStatus={taskStatus} primary />
          )}
        </div>
      </div>

      {campaignId && (
        <p className="mb-4 text-sm text-ink-secondary">{t("creative.rerunHint")}</p>
      )}

      {wasRejected && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-medium">{t("creative.rejectionBannerTitle")}</p>
          {lastRejection?.comment && (
            <p className="mt-1 text-red-800">
              {t("creative.rejectionComment", { comment: lastRejection.comment })}
            </p>
          )}
          <p className="mt-2 text-red-700">{t("creative.rejectionSteps")}</p>
        </div>
      )}

      {submitHint && (
        <p
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            submitHint === t("creative.resubmitSuccess")
              ? "border-brand-teal/30 bg-brand-teal/5 text-brand-teal"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {submitHint}
        </p>
      )}

      {siblingClips.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {siblingClips.map((clip, i) => (
            <Link
              key={clip.id}
              href={`/w/${slug}/creatives/${clip.id}`}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                i === clipIndex
                  ? "bg-navy text-white shadow-sm"
                  : "border border-border bg-surface text-ink-secondary hover:text-navy"
              }`}
            >
              {t("creative.clipNav", { n: i + 1 })}
            </Link>
          ))}
          <Link
            href={`/w/${slug}/campaigns/${campaignId}/task`}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-brand-blue hover:bg-brand-blue/5"
          >
            {t("creative.allClips")}
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="space-y-4">
          {creative?.videoUrl ? (
            <video
              key={String(creative.updatedAt ?? videoUrl)}
              src={videoUrlWithCacheBust(videoUrl!, creative.updatedAt as string | undefined)}
              controls
              className="w-full rounded-xl border border-border/80 bg-black object-contain shadow-card"
            />
          ) : (
            <div className="flex aspect-[9/16] max-h-[70vh] items-center justify-center rounded-xl border border-dashed border-border bg-surface-muted text-sm text-ink-secondary">
              {t("creative.noPreview")}
            </div>
          )}

          {videoUrl && creative && (
            <>
              <MusicMatchPanel editPlan={creative.editPlan as EditPlan | undefined} compact />
              <ClipAudioControls
                creativeId={id}
                editPlan={creative.editPlan as EditPlan | undefined}
                renderStatus={creative.renderStatus as string | undefined}
                renderProgress={
                  creative.renderProgress as
                    | { percent?: number; phase?: string; error?: string }
                    | undefined
                }
                onRenderComplete={refreshCreative}
              />
              {variant && (
                <CreativeSubtitleSettings
                  creativeId={id}
                  variantId={variant.id}
                  disabled={isRendering}
                  onApplied={refreshCreative}
                />
              )}
              <ClipDownloadMenu creativeId={id} clipLabel={`clip_${clipIndex + 1}`} />
            </>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div
            className="flex gap-1 overflow-x-auto rounded-lg border border-border/80 bg-surface-muted/40 p-1"
            role="tablist"
          >
            {sortedVariants.map((v, i) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={i === activeVariant}
                onClick={() => setActiveVariant(i)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  i === activeVariant
                    ? "bg-surface text-navy shadow-sm ring-1 ring-border/80"
                    : "text-ink-secondary hover:text-navy"
                }`}
              >
                {variantLabel(v, t)}
              </button>
            ))}
          </div>

          {variant && !editMode && (
            <section className="rounded-xl border border-border/80 bg-surface p-4 shadow-card">
              {copySaveHint && (
                <p className="mb-3 text-sm text-brand-blue">{copySaveHint}</p>
              )}
              <div className="space-y-3 text-sm">
                <div className="rounded-lg border border-brand-teal/20 bg-brand-teal/[0.04] px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
                    {t("creative.field.hook")}
                  </p>
                  <p className="mt-1 font-medium text-navy">{variant.hook}</p>
                </div>
                <div className="rounded-lg border border-border/60 bg-surface-muted/30 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
                    {t("creative.field.body")}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-ink">{variant.body}</p>
                </div>
                <div className="rounded-lg border border-border/60 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-secondary">
                    {t("creative.field.cta")}
                  </p>
                  <p className="mt-1 font-medium text-navy">{variant.cta}</p>
                </div>
                {variant.tags?.length > 0 && (
                  <p className="text-xs text-ink-secondary">{variant.tags.join(" ")}</p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/60 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditForm(variant);
                    setEditMode(true);
                  }}
                  className={btn}
                >
                  {t("creative.editCopy")}
                </button>
                <CopyDownloadButtons creativeId={id} compact disabled={variants.length === 0} />
                {!reviewPending && (
                  <button
                    type="button"
                    onClick={submitReview}
                    disabled={submittingReview || isRendering}
                    className={`${btn} border-navy/20 bg-navy text-white hover:bg-navy/90 hover:text-white disabled:opacity-60`}
                  >
                    {wasRejected ? t("creative.resubmitReview") : t("creative.submitReview")}
                  </button>
                )}
                {canExport ? (
                  <Link href={`/w/${slug}/creatives/${id}/export`} className={btn}>
                    {t("creative.export")}
                  </Link>
                ) : (
                  <span className={`${btn} cursor-not-allowed opacity-50`} title={t("creative.exportLocked")}>
                    {t("creative.export")}
                  </span>
                )}
              </div>
            </section>
          )}

          {editMode && (
            <section className="rounded-xl border border-border/80 bg-surface p-4 shadow-card">
              <div className="space-y-3">
                {(["hook", "body", "cta", "title"] as const).map((field) => (
                  <div key={field}>
                    <label className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                      {t(FIELD_KEYS[field])}
                    </label>
                    <textarea
                      value={(editForm[field] as string) ?? ""}
                      onChange={(e) => setEditForm({ ...editForm, [field]: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                      rows={field === "body" ? 4 : 2}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={saveCopy}
                  className="rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white"
                >
                  {t("creative.save")}
                </button>
                <button type="button" onClick={() => setEditMode(false)} className={btn}>
                  {t("workspaces.cancel")}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
