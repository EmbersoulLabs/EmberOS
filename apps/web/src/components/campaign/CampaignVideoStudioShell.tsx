"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";

const BGM_CATEGORIES = [
  "happy",
  "luxury",
  "romantic",
  "elegant",
  "emotional",
  "fast",
  "slow",
  "trending",
] as const;

const AI_STYLES = [
  "elegant",
  "luxury",
  "minimal",
  "modern",
  "warm",
  "professional",
  "cinematic",
  "fastPaced",
] as const;

const PLATFORMS = [
  "tiktok",
  "instagramReels",
  "facebookReels",
  "youtubeShorts",
  "xiaohongshu",
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  slug: string;
}

export function CampaignVideoStudioShell({ open, onClose, campaignId, slug }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-navy/40 backdrop-blur-sm lg:block hidden"
        onClick={onClose}
        aria-hidden
      />
      <aside className="fixed inset-y-0 right-0 z-50 hidden w-full max-w-lg flex-col border-l border-border bg-surface shadow-2xl lg:flex">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-navy">{t("campaign.workspace.videoStudio.title")}</h2>
          <button type="button" onClick={onClose} className="text-ink-secondary hover:text-navy">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <StudioSection title={t("campaign.workspace.videoStudio.cover")}>
            <div className="flex flex-wrap gap-2">
              {["autoSelect", "chooseFrame", "uploadCover"].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  disabled
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary"
                >
                  {t(`campaign.workspace.videoStudio.cover.${opt}` as TranslationKey)}
                </button>
              ))}
            </div>
          </StudioSection>
          <StudioSection title={t("campaign.workspace.videoStudio.caption")}>
            <p className="text-xs text-ink-secondary">{t("campaign.workspace.package.placeholderNotice")}</p>
          </StudioSection>
          <StudioSection title={t("campaign.workspace.videoStudio.subtitle")}>
            <p className="text-xs text-ink-secondary">{t("campaign.workspace.package.placeholderNotice")}</p>
          </StudioSection>
          <StudioSection title={t("campaign.workspace.videoStudio.voice")}>
            <p className="text-xs text-ink-secondary">{t("campaign.workspace.videoStudio.ttsPlaceholder")}</p>
          </StudioSection>
          <StudioSection title={t("campaign.workspace.videoStudio.bgm")}>
            <div className="flex flex-wrap gap-1.5">
              {BGM_CATEGORIES.map((c) => (
                <span key={c} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-ink-secondary">
                  {t(`campaign.workspace.videoStudio.bgm.${c}` as TranslationKey)}
                </span>
              ))}
            </div>
          </StudioSection>
          <StudioSection title={t("campaign.workspace.videoStudio.style")}>
            <div className="flex flex-wrap gap-1.5">
              {AI_STYLES.map((s) => (
                <span key={s} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-ink-secondary">
                  {t(`campaign.workspace.videoStudio.aiStyle.${s}` as TranslationKey)}
                </span>
              ))}
            </div>
          </StudioSection>
          <StudioSection title={t("campaign.workspace.videoStudio.platform")}>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <span key={p} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-ink-secondary">
                  {t(`campaign.workspace.videoStudio.platforms.${p}` as TranslationKey)}
                </span>
              ))}
            </div>
          </StudioSection>
        </div>
      </aside>

      <div className="fixed inset-0 z-50 flex flex-col bg-surface lg:hidden">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <Link
            href={`/w/${slug}/campaigns/${campaignId}`}
            onClick={onClose}
            className="text-sm text-ink-secondary"
          >
            ← {t("common.back")}
          </Link>
          <h2 className="text-base font-semibold text-navy">{t("campaign.workspace.videoStudio.title")}</h2>
          <span className="w-12" />
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <p className="text-sm text-ink-secondary">{t("campaign.workspace.videoStudio.mobileHint")}</p>
        </div>
      </div>
    </>
  );
}

function StudioSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-navy">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}
