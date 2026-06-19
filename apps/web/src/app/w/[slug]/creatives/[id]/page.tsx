"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { RunCeoButton } from "@/components/RunCeoButton";
import { useI18n } from "@/lib/i18n/provider";
import type { TranslationKey } from "@ceo-agent/shared/i18n";

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

function variantLabel(v: CopyVariant): string {
  const lang = v.locale === "zh" ? "中文" : v.locale === "en" ? "EN" : "";
  return lang ? `${v.platform} · ${lang}` : v.platform;
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
  const [activeVariant, setActiveVariant] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<CopyVariant>>({});

  useEffect(() => {
    fetch(`/api/creatives/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setCreative(d.creative);
        setCampaignId(d.campaign?.id ?? null);
        if (d.campaign?.id) {
          fetch(`/api/campaigns/${d.campaign.id}`)
            .then((r) => r.json())
            .then((cd) => setTaskStatus((cd.task?.status as string) ?? null));
        }
      });
  }, [id]);

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

  async function saveCopy() {
    if (!variant) return;
    const res = await fetch(`/api/creatives/${id}/copy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variant.id, ...editForm }),
    });
    const data = await res.json();
    if (data.creative) setCreative(data.creative);
    setEditMode(false);
  }

  async function submitReview() {
    await fetch(`/api/creatives/${id}/submit-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "internal" }),
    });
    alert(t("creative.submitted"));
  }

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("creative.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {creative && <StatusBadge status={creative.status as string} />}
          {campaignId && (
            <RunCeoButton campaignId={campaignId} slug={slug} taskStatus={taskStatus} primary />
          )}
        </div>
      </div>

      {campaignId && (
        <p className="mb-4 text-sm text-slate-500">{t("creative.rerunHint")}</p>
      )}

      {creative?.videoUrl ? (
        <video
          src={creative.videoUrl as string}
          controls
          className="mb-6 max-h-96 w-full rounded-lg bg-black"
        />
      ) : (
        <div className="mb-6 flex h-48 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
          {t("creative.rendering")}
        </div>
      )}

      <div className="mb-4 flex gap-2">
        {sortedVariants.map((v, i) => (
          <button
            key={v.id}
            onClick={() => setActiveVariant(i)}
            className={`rounded px-3 py-1 text-sm ${
              i === activeVariant ? "bg-primary text-white" : "border"
            }`}
          >
            {variantLabel(v)}
          </button>
        ))}
      </div>

      {variant && !editMode && (
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm font-medium text-primary">{variant.hook}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{variant.body}</p>
          <p className="mt-2 text-sm font-medium">{variant.cta}</p>
          <p className="mt-2 text-xs text-slate-500">{variant.tags?.join(" ")}</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                setEditForm(variant);
                setEditMode(true);
              }}
              className="rounded border px-3 py-1 text-sm"
            >
              {t("creative.editCopy")}
            </button>
            <button onClick={submitReview} className="rounded bg-primary px-3 py-1 text-sm text-white">
              {t("creative.submitReview")}
            </button>
            <Link
              href={`/w/${slug}/creatives/${id}/export`}
              className="rounded border px-3 py-1 text-sm"
            >
              {t("creative.export")}
            </Link>
          </div>
        </div>
      )}

      {editMode && (
        <div className="space-y-3 rounded-lg border bg-white p-4">
          {(["hook", "body", "cta", "title"] as const).map((field) => (
            <div key={field}>
              <label className="text-sm font-medium">{t(FIELD_KEYS[field])}</label>
              <textarea
                value={(editForm[field] as string) ?? ""}
                onChange={(e) => setEditForm({ ...editForm, [field]: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                rows={field === "body" ? 4 : 2}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={saveCopy} className="rounded bg-primary px-3 py-1 text-sm text-white">
              {t("creative.save")}
            </button>
            <button onClick={() => setEditMode(false)} className="rounded border px-3 py-1 text-sm">
              {t("workspaces.cancel")}
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
