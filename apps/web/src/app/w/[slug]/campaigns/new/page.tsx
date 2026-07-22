"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import {
  CampaignMediaInput,
  LanguageFields,
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_OBJECTIVE_LABELS,
  defaultCampaignLanguages,
  type CampaignObjective,
  type CampaignLanguageCode,
} from "@/components/campaign/CampaignMediaInput";
import { useI18n } from "@/lib/i18n/provider";

const STEPS = [
  "name",
  "objective",
  "assets",
  "brief",
  "language",
  "generate",
] as const;

type Step = (typeof STEPS)[number];

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
  const [campaignBrief, setCampaignBrief] = useState("");
  const [languages, setLanguages] = useState(() => defaultCampaignLanguages(locale));
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generateSummary, setGenerateSummary] = useState<Record<string, unknown> | null>(
    null
  );

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

  const stepTitle = useMemo(() => {
    const map: Record<Step, string> = {
      name: t("campaign.workspace.stepName"),
      objective: t("campaign.workspace.stepObjective"),
      assets: t("campaign.workspace.stepAssets"),
      brief: t("campaign.workspace.stepBrief"),
      language: t("campaign.workspace.stepLanguage"),
      generate: t("campaign.workspace.stepGenerate"),
    };
    return map[step];
  }, [step, t]);

  async function createOrUpdateDraft(): Promise<string> {
    const wsId = await ensureWorkspace();
    if (!name.trim()) throw new Error(t("campaign.workspace.nameRequired"));
    if (!objective) throw new Error(t("campaign.workspace.objectiveRequired"));
    if (objective === "other" && !objectiveCustom.trim()) {
      throw new Error(t("campaign.workspace.customObjectiveRequired"));
    }

    if (!campaignId) {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: wsId,
          name: name.trim(),
          objective,
          objectiveCustom: objective === "other" ? objectiveCustom.trim() : undefined,
          campaignBrief: campaignBrief.trim() || undefined,
          ...languages,
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
        name: name.trim(),
        objective,
        objectiveCustom: objective === "other" ? objectiveCustom.trim() : null,
        campaignBrief: campaignBrief.trim() || null,
        ...languages,
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
        const id = await createOrUpdateDraft();
        await ensureWorkspace();
        void id;
        setStepIndex(2);
        return;
      }
      if (step === "assets") {
        const id = await createOrUpdateDraft();
        await attachMedia(id);
        if (selectedAssetIds.length === 0 && selectedStoryIds.length === 0) {
          // Allow continue if files already uploaded into campaign via media input
          const campRes = await fetch(`/api/campaigns/${id}`);
          const campData = await campRes.json();
          const assetCount = (campData.assets ?? []).length;
          const storyCount = (campData.stories ?? []).length;
          if (assetCount === 0 && storyCount === 0) {
            throw new Error(t("campaign.workspace.assetsRequired"));
          }
        }
        setStepIndex(3);
        return;
      }
      if (step === "brief") {
        await createOrUpdateDraft();
        setStepIndex(4);
        return;
      }
      if (step === "language") {
        await createOrUpdateDraft();
        setStepIndex(5);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  }

  async function onGenerate() {
    setError("");
    setLoading(true);
    try {
      const id = await createOrUpdateDraft();
      await attachMedia(id);
      const res = await fetch(`/api/campaigns/${id}/generate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generate validation failed");
      setGenerateSummary(data.summary ?? null);
      // Enter Campaign Workspace — do NOT call /run.
      router.push(`/w/${slug}/campaigns/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  }

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
            <div className="space-y-3">
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
            <label className="block text-sm font-semibold text-navy">
              {t("campaign.workspace.briefOptional")}
              <textarea
                value={campaignBrief}
                onChange={(e) => setCampaignBrief(e.target.value)}
                rows={5}
                className="mt-1.5 w-full rounded-xl border border-border px-4 py-2.5 text-sm font-normal"
                placeholder={t("campaign.workspace.briefPlaceholder")}
              />
            </label>
          ) : null}

          {step === "language" ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-secondary">{t("campaign.workspace.languageHint")}</p>
              <LanguageFields values={languages} onChange={setLanguages} disabled={loading} />
            </div>
          ) : null}

          {step === "generate" ? (
            <div className="space-y-3">
              <p className="text-sm text-ink-secondary">{t("campaign.workspace.generateSummaryHint")}</p>
              <dl className="space-y-2 rounded-xl bg-surface-muted p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-secondary">{t("campaign.name")}</dt>
                  <dd className="font-medium text-navy">{name || "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-secondary">{t("campaign.workspace.objective")}</dt>
                  <dd className="font-medium text-navy">
                    {objective === "other"
                      ? objectiveCustom || "—"
                      : objective
                        ? CAMPAIGN_OBJECTIVE_LABELS[objective]
                        : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-secondary">{t("campaign.workspace.outputLanguage")}</dt>
                  <dd className="font-medium text-navy">{languages.outputLanguage}</dd>
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
              {generateSummary ? (
                <pre className="overflow-auto rounded-lg bg-navy/5 p-3 text-xs text-navy">
                  {JSON.stringify(generateSummary, null, 2)}
                </pre>
              ) : null}
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
            {step !== "generate" ? (
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
                disabled={loading}
                onClick={() => void onGenerate()}
                className="ml-auto sticky bottom-4 rounded-xl bg-navy px-5 py-3 text-sm font-semibold text-white shadow-elevated disabled:opacity-50"
              >
                {loading ? t("campaign.creating") : t("campaign.workspace.generate")}
              </button>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
