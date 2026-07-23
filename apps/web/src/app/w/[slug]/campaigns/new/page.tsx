"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import {
  CampaignMediaInput,
  InferredLanguageReadonly,
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_OBJECTIVE_LABELS,
  type CampaignObjective,
} from "@/components/campaign/CampaignMediaInput";
import { CampaignBriefAssistant } from "@/components/campaign/CampaignBriefAssistant";
import { TargetAudienceAssistant } from "@/components/campaign/TargetAudienceAssistant";
import { ReviewAssetPreview } from "@/components/campaign/ReviewAssetPreview";
import { PublishingPlatformMultiSelect } from "@/components/campaign/PublishingPlatformMultiSelect";
import { useI18n } from "@/lib/i18n/provider";
import {
  formatPublishingPlatforms,
  inferCampaignLanguages,
  sanitizePublishingPlatforms,
  validateCampaignForCreate,
  type PublishingPlatformId,
} from "@ceo-agent/shared";

/** PD-038 — five-step Campaign Wizard (no Language step). */
const STEPS = ["name", "objective", "assets", "brief", "review"] as const;

type Step = (typeof STEPS)[number];

type ReviewAsset = {
  id: string;
  displayName: string | null;
  originalFilename: string | null;
  type: string;
  mimeType?: string | null;
  metadata?: Record<string, unknown> | null;
};

export default function CampaignWizardPage() {
  const params = useParams();
  const slug = params.slug as string;
  const router = useRouter();
  const { t, locale } = useI18n();

  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex]!;

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState<CampaignObjective | "">("");
  const [objectiveCustom, setObjectiveCustom] = useState("");
  const [description, setDescription] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [campaignBrief, setCampaignBrief] = useState("");
  const [platforms, setPlatforms] = useState<PublishingPlatformId[]>([]);
  const [platformsSeeded, setPlatformsSeeded] = useState(false);
  const languages = useMemo(
    () => inferCampaignLanguages(locale, platforms),
    [locale, platforms]
  );
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reviewAssets, setReviewAssets] = useState<ReviewAsset[]>([]);
  const [reviewStories, setReviewStories] = useState<Array<{ id: string; name: string }>>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function ensureWorkspace(): Promise<string> {
    if (workspaceId) return workspaceId;
    const meRes = await fetch("/api/me");
    const me = await meRes.json();
    if (!meRes.ok) throw new Error(me.error ?? t("error.loadAccount"));
    const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug) as
      | { id: string }
      | undefined;
    if (!ws) throw new Error(t("error.workspaceNotFound"));
    setWorkspaceId(ws.id);
    return ws.id;
  }

  useEffect(() => {
    void ensureWorkspace().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // PD-042 — seed Campaign platforms from Business Profile defaults (campaign-only thereafter).
  useEffect(() => {
    if (!workspaceId || platformsSeeded) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/business-profile`);
        const data = await res.json();
        if (!cancelled && res.ok) {
          setPlatforms(
            sanitizePublishingPlatforms(data.profile?.defaultPublishingPlatforms ?? [])
          );
        }
      } catch {
        // Defaults remain empty; user can still select platforms.
      } finally {
        if (!cancelled) setPlatformsSeeded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, platformsSeeded]);

  const stepTitle = useMemo(() => {
    const map: Record<Step, string> = {
      name: t("campaign.workspace.stepName"),
      objective: t("campaign.workspace.stepObjective"),
      assets: t("campaign.workspace.stepAssets"),
      brief: t("campaign.workspace.stepBrief"),
      review: t("campaign.workspace.stepReview"),
    };
    return map[step];
  }, [step, t]);

  const objectiveLabel =
    objective === "other"
      ? objectiveCustom.trim()
      : objective
        ? CAMPAIGN_OBJECTIVE_LABELS[objective]
        : "";

  async function createOrUpdateDraft(): Promise<string> {
    const wsId = await ensureWorkspace();
    if (!name.trim()) throw new Error(t("campaign.workspace.nameRequired"));
    if (!objective) throw new Error(t("campaign.workspace.objectiveRequired"));
    if (objective === "other" && !objectiveCustom.trim()) {
      throw new Error(t("campaign.workspace.customObjectiveRequired"));
    }

    const payload = {
      name: name.trim(),
      objective,
      objectiveCustom: objective === "other" ? objectiveCustom.trim() : undefined,
      description: description.trim() || undefined,
      targetAudienceOverride: targetAudience.trim() || undefined,
      campaignBrief: campaignBrief.trim() || undefined,
      platforms,
      ...languages,
    };

    if (!campaignId) {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: wsId,
          ...payload,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.campaign?.id) {
        throw new Error(data.error ?? t("error.createCampaign"));
      }
      setCampaignId(data.campaign.id);
      return data.campaign.id as string;
    }

    const patchRes = await fetch(`/api/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          objectiveCustom: objective === "other" ? objectiveCustom.trim() : null,
          description: description.trim() || null,
          targetAudienceOverride: targetAudience.trim() || null,
          campaignBrief: campaignBrief.trim() || null,
        }),
    });
    const patchData = await patchRes.json();
    if (!patchRes.ok) throw new Error(patchData.error ?? "Failed to update campaign");
    return campaignId;
  }

  async function attachMedia(id: string) {
    if (selectedAssetIds.length === 0 && selectedStoryIds.length === 0) return;
    const res = await fetch(`/api/campaigns/${id}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetIds: selectedAssetIds,
        storyIds: selectedStoryIds,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to attach media");
  }

  async function loadReviewSnapshot(id: string) {
    const campRes = await fetch(`/api/campaigns/${id}`);
    const campData = await campRes.json();
    if (!campRes.ok) throw new Error(campData.error ?? "Failed to load campaign");
    setReviewAssets(campData.assets ?? []);
    setReviewStories(
      (campData.stories ?? []).map(
        (story: { storyId?: string; id?: string; name: string }) => ({
          id: story.storyId || story.id || "",
          name: story.name,
        })
      ).filter((story: { id: string }) => Boolean(story.id))
    );
    const nextPlatforms = sanitizePublishingPlatforms(campData.campaign?.platforms ?? []);
    setPlatforms(nextPlatforms);
    const nextWarnings: string[] = [];
    if (!(campData.assets ?? []).length && !(campData.stories ?? []).length) {
      nextWarnings.push(t("campaign.workspace.assetsRequired"));
    }
    if (nextPlatforms.length === 0) {
      nextWarnings.push(t("campaign.workspace.platformsEmptyHint"));
    }
    setWarnings(nextWarnings);
  }

  async function goNext() {
    setError("");
    setLoading(true);
    try {
      if (step === "name") {
        if (!name.trim()) throw new Error(t("campaign.workspace.nameRequired"));
        setStepIndex(1);
        return;
      }
      if (step === "objective") {
        await createOrUpdateDraft();
        setStepIndex(2);
        return;
      }
      if (step === "assets") {
        const id = await createOrUpdateDraft();
        await attachMedia(id);
        const campRes = await fetch(`/api/campaigns/${id}`);
        const campData = await campRes.json();
        const assetCount = (campData.assets ?? []).length;
        const storyCount = (campData.stories ?? []).length;
        if (assetCount === 0 && storyCount === 0) {
          throw new Error(t("campaign.workspace.assetsRequired"));
        }
        setStepIndex(3);
        return;
      }
      if (step === "brief") {
        const id = await createOrUpdateDraft();
        await loadReviewSnapshot(id);
        setStepIndex(4);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  }

  async function onCreateCampaign() {
    setError("");
    setLoading(true);
    try {
      const id = await createOrUpdateDraft();
      await attachMedia(id);

      const campRes = await fetch(`/api/campaigns/${id}`);
      const campData = await campRes.json();
      if (!campRes.ok) throw new Error(campData.error ?? t("campaign.workspace.createFailed"));

      const assetCount = (campData.assets ?? []).length;
      const storyCount = (campData.stories ?? []).length;
      const validation = validateCampaignForCreate({
        name,
        objective: objective || null,
        objectiveCustom,
        outputLanguage: languages.outputLanguage,
        subtitleLanguage: languages.subtitleLanguage,
        ctaLanguage: languages.ctaLanguage,
        hashtagLanguage: languages.hashtagLanguage,
        assetCount,
        storyCount,
      });
      if (!validation.ok) {
        throw new Error(validation.errors[0] ?? t("campaign.workspace.createFailed"));
      }

      // Create Campaign finalizes the reviewed draft only.
      // Marketing Package generation remains a separate Campaign Workspace action.
      router.push(`/w/${slug}/campaigns/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  }

  const validationRows = [
    {
      ok: Boolean(name.trim()),
      label: t("campaign.name"),
    },
    {
      ok: Boolean(objective) && (objective !== "other" || Boolean(objectiveCustom.trim())),
      label: t("campaign.workspace.objective"),
    },
    {
      ok: reviewAssets.length > 0 || reviewStories.length > 0 || selectedAssetIds.length > 0,
      label: t("campaign.workspace.media"),
    },
  ];

  const platformsDisplay =
    platforms.length > 0
      ? formatPublishingPlatforms(platforms)
      : t("campaign.workspace.platformsNotSet");

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 border-b border-border pb-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
            {t("campaign.new.title")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy">{stepTitle}</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            {t("campaign.workspace.stepProgress", {
              current: String(stepIndex + 1),
              total: String(STEPS.length),
            })}
          </p>
          <div className="mt-3 flex gap-1">
            {STEPS.map((s, i) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full ${
                  i <= stepIndex ? "bg-navy" : "bg-border"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-5 rounded-2xl border border-border bg-white p-5 sm:p-6">
          {step === "name" ? (
            <label className="block text-sm font-semibold text-navy">
              {t("campaign.name")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-border px-4 py-2.5 text-sm"
                placeholder={t("campaign.namePlaceholder")}
                autoFocus
              />
            </label>
          ) : null}

          {step === "objective" ? (
            <div className="space-y-5">
              <label className="block text-sm font-semibold text-navy">
                {t("campaign.workspace.objective")}
                <select
                  value={objective}
                  onChange={(e) => setObjective(e.target.value as CampaignObjective | "")}
                  className="mt-1.5 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-normal"
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
                    className="mt-1.5 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-normal"
                  />
                </label>
              ) : null}
              <PublishingPlatformMultiSelect
                label={t("campaign.workspace.publishingPlatforms")}
                hint={
                  platformsSeeded
                    ? t("campaign.workspace.publishingPlatformsHint")
                    : t("campaign.workspace.publishingPlatformsLoading")
                }
                values={platforms}
                onChange={setPlatforms}
                disabled={loading || !platformsSeeded}
              />
              <label className="block text-sm font-semibold text-navy">
                {t("campaign.workspace.description")}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  disabled={loading}
                  className="mt-1.5 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-normal disabled:opacity-60"
                  placeholder={t("campaign.workspace.descriptionPlaceholder")}
                />
              </label>
              <TargetAudienceAssistant
                workspaceId={workspaceId}
                value={targetAudience}
                onChange={setTargetAudience}
                objectiveLabel={objectiveLabel}
                platforms={platforms}
                description={description}
                disabled={loading}
              />
            </div>
          ) : null}

          {step === "assets" && workspaceId ? (
            <CampaignMediaInput
              workspaceId={workspaceId}
              campaignId={campaignId}
              selectedAssetIds={selectedAssetIds}
              selectedStoryIds={selectedStoryIds}
              onSelectedAssetsChange={setSelectedAssetIds}
              onSelectedStoriesChange={setSelectedStoryIds}
              files={files}
              onFilesChange={setFiles}
              disabled={loading}
            />
          ) : null}
          {step === "assets" && !workspaceId ? (
            <p className="text-sm text-ink-secondary">{t("campaign.workspace.preparingWorkspace")}</p>
          ) : null}

          {step === "brief" ? (
            <CampaignBriefAssistant
              campaignId={campaignId}
              value={campaignBrief}
              onChange={setCampaignBrief}
              campaignName={name}
              objectiveLabel={objectiveLabel}
              description={description}
              targetAudience={targetAudience}
              disabled={loading}
            />
          ) : null}

          {step === "review" ? (
            <div className="space-y-5">
              <p className="text-sm text-ink-secondary">{t("campaign.workspace.reviewHint")}</p>

              <dl className="space-y-3 rounded-xl bg-surface-muted p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-secondary">{t("campaign.name")}</dt>
                  <dd className="font-medium text-navy">{name || "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-secondary">{t("campaign.workspace.objective")}</dt>
                  <dd className="font-medium text-navy">{objectiveLabel || "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-secondary">{t("campaign.platforms")}</dt>
                  <dd className="mt-1 font-medium text-navy">{platformsDisplay}</dd>
                </div>
                <div>
                  <dt className="text-ink-secondary">{t("campaign.workspace.description")}</dt>
                  <dd className="mt-1 whitespace-pre-wrap font-medium text-navy">
                    {description.trim() || t("campaign.workspace.descriptionEmpty")}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-secondary">{t("campaign.workspace.targetAudience")}</dt>
                  <dd className="mt-1 whitespace-pre-wrap font-medium text-navy">
                    {targetAudience.trim() || t("campaign.workspace.targetAudienceEmpty")}
                  </dd>
                </div>
              </dl>

              <div>
                <h2 className="text-sm font-semibold text-navy">
                  {t("campaign.workspace.uploadedAssets")}
                </h2>
                {reviewAssets.length === 0 && reviewStories.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-secondary">{t("campaign.workspace.noMedia")}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {workspaceId
                      ? reviewAssets.map((asset) => (
                          <ReviewAssetPreview
                            key={asset.id}
                            workspaceId={workspaceId}
                            asset={asset}
                          />
                        ))
                      : null}
                    {reviewStories.map((story) => (
                      <li
                        key={story.id}
                        className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-navy"
                      >
                        Story · {story.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h2 className="text-sm font-semibold text-navy">
                  {t("campaign.workspace.briefOptional")}
                </h2>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">
                  {campaignBrief.trim() || t("campaign.workspace.briefEmpty")}
                </p>
              </div>

              <div>
                <h2 className="text-sm font-semibold text-navy">
                  {t("campaign.workspace.inferredLanguage")}
                </h2>
                <p className="mt-1 text-xs text-ink-secondary">
                  {t("campaign.workspace.inferredLanguageHint")}
                </p>
                <div className="mt-2">
                  <InferredLanguageReadonly values={languages} />
                </div>
              </div>

              <div>
                <h2 className="text-sm font-semibold text-navy">
                  {t("campaign.workspace.aiSettings")}
                </h2>
                <p className="mt-1 text-sm text-ink-secondary">
                  {t("campaign.workspace.aiSettingsHint")}
                </p>
              </div>

              <div>
                <h2 className="text-sm font-semibold text-navy">
                  {t("campaign.workspace.finalValidation")}
                </h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {validationRows.map((row) => (
                    <li key={row.label} className={row.ok ? "text-green-700" : "text-red-600"}>
                      {row.ok ? "✓" : "✗"} {row.label}
                    </li>
                  ))}
                </ul>
                {warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm text-amber-700">
                    {warnings.map((warning) => (
                      <li key={warning}>⚠ {warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            {stepIndex > 0 ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-navy"
              >
                {t("nav.back")}
              </button>
            ) : null}
            {step !== "review" ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => void goNext()}
                className="ml-auto rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {loading ? t("campaign.creating") : t("campaign.workspace.continue")}
              </button>
            ) : (
              <button
                type="button"
                disabled={loading || validationRows.some((row) => !row.ok)}
                onClick={() => void onCreateCampaign()}
                className="ml-auto sticky bottom-4 rounded-xl bg-navy px-5 py-3 text-sm font-semibold text-white shadow-elevated disabled:opacity-50"
              >
                {loading ? t("campaign.creating") : t("campaign.workspace.createCampaign")}
              </button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
