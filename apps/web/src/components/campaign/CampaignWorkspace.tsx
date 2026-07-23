"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_OBJECTIVE_LABELS,
  MARKETING_PACKAGE_PLACEHOLDER_ITEMS,
  formatPublishingPlatforms,
  resolveCampaignObjectiveLabel,
  type CampaignObjective,
  type CampaignLanguageCode,
} from "@ceo-agent/shared";
import { AppShell, StatusBadge } from "@/components/AppShell";
import {
  CampaignMediaInput,
  InferredLanguageReadonly,
  defaultCampaignLanguages,
} from "@/components/campaign/CampaignMediaInput";
import { CampaignBriefAssistant } from "@/components/campaign/CampaignBriefAssistant";
import { useI18n } from "@/lib/i18n/provider";

type Tab = "overview" | "video" | "package" | "activity";

type CampaignRecord = {
  id: string;
  name: string;
  status: string;
  objective?: string | null;
  objectiveCustom?: string | null;
  description?: string | null;
  targetAudienceOverride?: string | null;
  campaignBrief?: string | null;
  outputLanguage?: string | null;
  subtitleLanguage?: string | null;
  ctaLanguage?: string | null;
  hashtagLanguage?: string | null;
  generateStatus?: string | null;
  generateSummary?: Record<string, unknown> | null;
  platforms?: string[];
  goal?: string | null;
};

type AssetRow = {
  id: string;
  type: string;
  displayName?: string | null;
  originalFilename?: string | null;
  fileSizeBytes?: number | null;
  createdAt?: string;
};

type StoryRow = { storyId: string; name: string; status: string };

const PACKAGE_LABELS: Record<(typeof MARKETING_PACKAGE_PLACEHOLDER_ITEMS)[number], string> = {
  strategy: "Strategy",
  report: "Report",
  hook: "Hook",
  caption: "Caption",
  cta: "CTA",
  hashtags: "Hashtags",
  subtitle: "Subtitle",
  video_reference: "Video Reference",
  marketing_score: "Marketing Score",
};

export function CampaignWorkspace({
  slug,
  workspaceId,
  campaignId,
  workspaceName,
}: {
  slug: string;
  workspaceId: string;
  campaignId: string;
  workspaceName: string;
}) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("overview");
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  const [name, setName] = useState("");
  const [objective, setObjective] = useState<CampaignObjective | "">("");
  const [objectiveCustom, setObjectiveCustom] = useState("");
  const [description, setDescription] = useState("");
  const [audienceOverride, setAudienceOverride] = useState("");
  const [brief, setBrief] = useState("");
  const [languages, setLanguages] = useState(() => defaultCampaignLanguages(locale));

  const load = useCallback(async () => {
    setError("");
    const res = await fetch(`/api/campaigns/${campaignId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load campaign");
      return;
    }
    const c = data.campaign as CampaignRecord;
    setCampaign(c);
    setAssets(data.assets ?? []);
    setStories(data.stories ?? []);
    setName(c.name ?? "");
    setObjective((c.objective as CampaignObjective) || "");
    setObjectiveCustom(c.objectiveCustom ?? "");
    setDescription(c.description ?? "");
    setAudienceOverride(c.targetAudienceOverride ?? "");
    setBrief(c.campaignBrief ?? "");
    setLanguages({
      outputLanguage: (c.outputLanguage as CampaignLanguageCode) || locale,
      subtitleLanguage: (c.subtitleLanguage as CampaignLanguageCode) || locale,
      ctaLanguage: (c.ctaLanguage as CampaignLanguageCode) || locale,
      hashtagLanguage: (c.hashtagLanguage as CampaignLanguageCode) || locale,
    });
    setSelectedAssetIds((data.assets ?? []).map((a: AssetRow) => a.id));
    setSelectedStoryIds((data.stories ?? []).map((s: StoryRow) => s.storyId));
  }, [campaignId, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveOverview() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          objective: objective || undefined,
          objectiveCustom: objective === "other" ? objectiveCustom.trim() : null,
          description: description.trim() || null,
          targetAudienceOverride: audienceOverride.trim() || null,
          campaignBrief: brief.trim() || null,
          ...languages,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");

      const mediaRes = await fetch(`/api/campaigns/${campaignId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetIds: selectedAssetIds,
          storyIds: selectedStoryIds,
        }),
      });
      const mediaData = await mediaRes.json();
      if (!mediaRes.ok) throw new Error(mediaData.error ?? "Failed to attach media");

      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setError(message);
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function onGenerate() {
    setGenerateBusy(true);
    setError("");
    try {
      await saveOverview();
      const res = await fetch(`/api/campaigns/${campaignId}/generate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generate validation failed");
      await load();
      setTab("package");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setGenerateBusy(false);
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: t("campaign.workspace.tabOverview") },
    { id: "video", label: t("campaign.workspace.tabVideoStudio") },
    { id: "package", label: t("campaign.workspace.tabMarketingPackage") },
    { id: "activity", label: t("campaign.workspace.tabActivity") },
  ];

  return (
    <AppShell workspaceName={workspaceName}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
            {t("campaign.workspace.module")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy">
            {campaign?.name ?? t("campaign.workspace.loading")}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {campaign ? <StatusBadge status={campaign.status} /> : null}
            {campaign?.generateStatus && campaign.generateStatus !== "idle" ? (
              <span className="rounded-full bg-brand-blue/10 px-2.5 py-0.5 text-xs font-medium text-brand-blue">
                {t("campaign.workspace.generateStatus")}: {campaign.generateStatus}
              </span>
            ) : null}
          </div>
        </div>
        <Link
          href={`/w/${slug}/campaigns`}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-navy"
        >
          {t("campaign.workspace.backToList")}
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap gap-1 border-b border-border pb-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === item.id ? "bg-navy text-white" : "text-navy hover:bg-surface-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {tab === "overview" && campaign ? (
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-white p-5">
            <h2 className="text-base font-bold text-navy">
              {t("campaign.workspace.campaignInformation")}
            </h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-semibold text-navy">
                {t("campaign.name")}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="block text-sm font-semibold text-navy">
                {t("campaign.workspace.objective")}
                <select
                  value={objective}
                  onChange={(e) => setObjective(e.target.value as CampaignObjective | "")}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal"
                >
                  <option value="">{t("campaign.workspace.objectivePlaceholder")}</option>
                  {CAMPAIGN_OBJECTIVES.map((value) => (
                    <option key={value} value={value}>
                      {CAMPAIGN_OBJECTIVE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              {objective === "other" ? (
                <label className="block text-sm font-semibold text-navy">
                  {t("campaign.workspace.customObjective")}
                  <input
                    value={objectiveCustom}
                    onChange={(e) => setObjectiveCustom(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal"
                  />
                </label>
              ) : null}
              <div>
                <p className="text-sm font-semibold text-navy">
                  {t("campaign.workspace.targetPlatforms")}
                </p>
                <p className="mt-1 text-sm text-ink-secondary">
                  {(campaign.platforms?.length ?? 0) > 0
                    ? formatPublishingPlatforms(campaign.platforms ?? [])
                    : t("campaign.workspace.platformsNotSet")}
                </p>
                <p className="mt-1 text-xs text-ink-secondary">
                  {t("campaign.workspace.targetPlatformsReadonlyHint")}
                </p>
              </div>
              <label className="block text-sm font-semibold text-navy">
                {t("campaign.workspace.description")}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="block text-sm font-semibold text-navy">
                {t("campaign.workspace.audienceOverride")}
                <textarea
                  value={audienceOverride}
                  onChange={(e) => setAudienceOverride(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal"
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-white p-5">
            <h2 className="text-base font-bold text-navy">{t("campaign.workspace.media")}</h2>
            <p className="mt-1 text-xs text-ink-secondary">
              {t("campaign.workspace.mediaHint")}
            </p>
            <div className="mt-4">
              <CampaignMediaInput
                workspaceId={workspaceId}
                campaignId={campaignId}
                selectedAssetIds={selectedAssetIds}
                selectedStoryIds={selectedStoryIds}
                onSelectedAssetsChange={setSelectedAssetIds}
                onSelectedStoriesChange={setSelectedStoryIds}
                files={files}
                onFilesChange={setFiles}
                disabled={saving || generateBusy}
              />
            </div>
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {t("campaign.workspace.currentReferences")}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-navy">
                {assets.map((a) => (
                  <li key={a.id}>
                    Asset · {a.displayName || a.originalFilename || a.id.slice(0, 8)} ({a.type})
                  </li>
                ))}
                {stories.map((s) => (
                  <li key={s.storyId}>
                    Story · {s.name} ({s.status})
                  </li>
                ))}
                {assets.length === 0 && stories.length === 0 ? (
                  <li className="text-ink-secondary">{t("campaign.workspace.noMedia")}</li>
                ) : null}
              </ul>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-white p-5">
            <CampaignBriefAssistant
              campaignId={campaign.id}
              value={brief}
              onChange={setBrief}
              campaignName={name}
              objectiveLabel={resolveCampaignObjectiveLabel({
                objective,
                objectiveCustom,
                goal: campaign.goal,
              })}
              disabled={saving}
            />
          </section>

          <section className="rounded-2xl border border-border bg-white p-5">
            <h2 className="text-base font-bold text-navy">
              {t("campaign.workspace.inferredLanguage")}
            </h2>
            <p className="mt-1 text-xs text-ink-secondary">
              {t("campaign.workspace.inferredLanguageHint")}
            </p>
            <div className="mt-3">
              <InferredLanguageReadonly values={languages} />
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-white p-5">
            <h2 className="text-base font-bold text-navy">
              {t("campaign.workspace.generateSummary")}
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-secondary">{t("campaign.name")}</dt>
                <dd className="font-medium text-navy">{name || "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-secondary">{t("campaign.workspace.objective")}</dt>
                <dd className="font-medium text-navy">
                  {resolveCampaignObjectiveLabel({
                    objective,
                    objectiveCustom,
                    goal: campaign.goal,
                  })}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-secondary">{t("assetLibrary.tabAssets")}</dt>
                <dd className="font-medium text-navy">{selectedAssetIds.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-secondary">{t("assetLibrary.tabStories")}</dt>
                <dd className="font-medium text-navy">{selectedStoryIds.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-secondary">AI</dt>
                <dd className="font-medium text-navy">{t("campaign.workspace.noAiThisSprint")}</dd>
              </div>
            </dl>
            {campaign.generateSummary ? (
              <pre className="mt-3 overflow-auto rounded-lg bg-surface-muted p-3 text-xs">
                {JSON.stringify(campaign.generateSummary, null, 2)}
              </pre>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || generateBusy}
                onClick={() => void saveOverview()}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-navy"
              >
                {saving ? t("campaign.creating") : t("campaign.workspace.save")}
              </button>
              <button
                type="button"
                disabled={saving || generateBusy}
                onClick={() => void onGenerate()}
                className="sticky bottom-4 rounded-xl bg-navy px-5 py-2.5 text-sm font-semibold text-white shadow-elevated disabled:opacity-50"
              >
                {generateBusy ? t("campaign.creating") : t("campaign.workspace.generate")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "video" ? (
        <section className="rounded-2xl border border-border bg-white p-8 text-center">
          <h2 className="text-lg font-bold text-navy">{t("campaign.workspace.tabVideoStudio")}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-secondary">
            {t("campaign.workspace.videoStudioEmpty")}
          </p>
        </section>
      ) : null}

      {tab === "package" ? (
        <section className="space-y-3">
          <p className="text-sm text-ink-secondary">{t("campaign.workspace.packageEmpty")}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MARKETING_PACKAGE_PLACEHOLDER_ITEMS.map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-dashed border-border bg-white p-4"
              >
                <p className="text-sm font-semibold text-navy">{PACKAGE_LABELS[item]}</p>
                <p className="mt-2 text-xs text-ink-secondary">
                  {t("campaign.workspace.placeholderOnly")}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "activity" ? (
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-white p-5">
            <h2 className="text-base font-bold text-navy">{t("campaign.workspace.activity")}</h2>
            <p className="mt-2 text-sm text-ink-secondary">{t("campaign.workspace.activityEmpty")}</p>
            {campaign?.generateStatus && campaign.generateStatus !== "idle" ? (
              <p className="mt-3 text-sm text-navy">
                {t("campaign.workspace.generateStatus")}:{" "}
                <strong>{campaign.generateStatus}</strong>
              </p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-border bg-white p-5">
            <h2 className="text-base font-bold text-navy">
              {t("campaign.workspace.versionHistory")}
            </h2>
            <p className="mt-2 text-sm text-ink-secondary">
              {t("campaign.workspace.versionHistoryEmpty")}
            </p>
          </div>
        </section>
      ) : null}
    </AppShell>
  );
}
