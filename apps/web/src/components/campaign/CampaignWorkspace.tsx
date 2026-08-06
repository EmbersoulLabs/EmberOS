"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_OBJECTIVE_LABELS,
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
import { CampaignMarketingPackageView } from "@/components/campaign/CampaignMarketingPackageView";
import { useI18n } from "@/lib/i18n/provider";

type Tab = "overview" | "package" | "activity";

type CampaignRecord = {
  id: string;
  name: string;
  status: string;
  objective?: string | null;
  objectiveCustom?: string | null;
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
type AiStoryRow = { id: string; title: string; status: string; updatedAt?: string };
type TaskRow = { id: string; status: string; currentStep?: string | null; stepProgress?: Record<string, { status?: string; percent?: number }>; createdAt?: string; updatedAt?: string };
type CreativeRow = { id: string; status?: string; title?: string | null; coverUrl?: string | null; createdAt?: string; updatedAt?: string };

export function CampaignWorkspace({
  slug,
  workspaceId,
  campaignId,
  workspaceName,
  workspaceRole,
}: {
  slug: string;
  workspaceId: string;
  campaignId: string;
  workspaceName: string;
  workspaceRole: string | null;
}) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<Tab>("overview");
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [stories, setStories] = useState<StoryRow[]>([]);
  const [aiStories, setAiStories] = useState<AiStoryRow[]>([]);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [creatives, setCreatives] = useState<CreativeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storiesError, setStoriesError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedStoryIds, setSelectedStoryIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  const [name, setName] = useState("");
  const [objective, setObjective] = useState<CampaignObjective | "">("");
  const [objectiveCustom, setObjectiveCustom] = useState("");
  const [audienceOverride, setAudienceOverride] = useState("");
  const [brief, setBrief] = useState("");
  const [languages, setLanguages] = useState(() => defaultCampaignLanguages(locale));

  const load = useCallback(async () => {
    setError("");
    const res = await fetch(`/api/campaigns/${campaignId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load campaign");
      setLoading(false);
      return;
    }
    const c = data.campaign as CampaignRecord;
    setCampaign(c);
    setAssets(data.assets ?? []);
    setStories(data.stories ?? []);
    setTask(data.task ?? null);
    setCreatives(data.creatives ?? []);
    setName(c.name ?? "");
    setObjective((c.objective as CampaignObjective) || "");
    setObjectiveCustom(c.objectiveCustom ?? "");
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
    setStoriesLoading(true);
    setStoriesError("");
    try {
      const aiStoriesRes = await fetch(`/api/campaigns/${campaignId}/ai-stories`);
      const aiStoriesData = await aiStoriesRes.json();
      if (!aiStoriesRes.ok) throw new Error(aiStoriesData.error ?? "Failed to load AI Stories");
      setAiStories(aiStoriesData.stories ?? []);
    } catch (storyError) {
      setStoriesError(storyError instanceof Error ? storyError.message : "Failed to load AI Stories");
    } finally {
      setStoriesLoading(false);
      setLoading(false);
    }
  }, [campaignId, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!task || !["queued", "running", "retrying"].includes(task.status)) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [task, load]);

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
      if (!res.ok) throw new Error(data.error ?? "Generate failed");
      await load();
      setTab("overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setGenerateBusy(false);
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: t("campaign.workspace.tabOverview") },
    { id: "package", label: t("campaign.workspace.tabMarketingPackage") },
    { id: "activity", label: t("campaign.workspace.tabActivity") },
  ];
  const canCreate = ["admin", "operator"].includes(workspaceRole ?? "");
  const activeTask = task && ["queued", "running", "retrying", "failed"].includes(task.status);
  const reviewRequired = campaign?.status === "pending_internal_review" || campaign?.status === "pending_client_review";
  const taskProgress = task?.stepProgress ?? {};
  const completedSteps = Object.values(taskProgress).filter((step) => step.status === "completed").length;
  const totalSteps = Math.max(1, Object.keys(taskProgress).length);
  const taskPercent = task?.status === "completed" ? 100 : Math.round((completedSteps / totalSteps) * 100);
  const currentStage = (task?.currentStep ?? "Preparing campaign").replace(/_/g, " ");

  if (loading) {
    return <AppShell workspaceName={workspaceName}><div className="mx-auto max-w-6xl space-y-4" aria-label="Loading campaign"><div className="h-28 animate-pulse rounded-2xl bg-white" /><div className="h-24 animate-pulse rounded-2xl bg-white" /><div className="h-48 animate-pulse rounded-2xl bg-white" /></div></AppShell>;
  }
  if (!campaign) {
    return <AppShell workspaceName={workspaceName}><div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700" role="alert"><p>{error || "Campaign could not be loaded."}</p><button type="button" onClick={() => void load()} className="mt-3 min-h-11 rounded-lg border border-red-300 px-4 font-semibold">Try again</button></div></AppShell>;
  }

  return (
    <AppShell workspaceName={workspaceName}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
            {t("campaign.workspace.module")}
          </p>
          <h1 className="mt-1 max-w-full break-words text-2xl font-bold tracking-tight text-navy">
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
          {campaign ? (
            <dl className="mt-3 grid min-w-0 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <div className="min-w-0"><dt className="text-xs text-ink-secondary">Objective</dt><dd className="truncate font-medium text-navy">{resolveCampaignObjectiveLabel({ objective: campaign.objective, objectiveCustom: campaign.objectiveCustom, goal: campaign.goal }) || "Not set"}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-ink-secondary">Platforms</dt><dd className="truncate font-medium text-navy">{campaign.platforms?.length ? formatPublishingPlatforms(campaign.platforms) : "Not set"}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-ink-secondary">Audience</dt><dd className="truncate font-medium text-navy">{campaign.targetAudienceOverride || "Business Profile default"}</dd></div>
            </dl>
          ) : null}
        </div>
        <Link
          href={`/w/${slug}/campaigns`}
          className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-navy"
        >
          {t("campaign.workspace.backToList")}
        </Link>
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border pb-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`min-h-11 shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition ${
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
          {(activeTask || reviewRequired || generateBusy) ? (
            <section className={`rounded-2xl border p-4 sm:p-5 ${task?.status === "failed" ? "border-red-200 bg-red-50" : reviewRequired ? "border-amber-200 bg-amber-50" : "border-brand-blue/20 bg-brand-blue/5"}`} aria-live="polite">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold capitalize text-navy">{generateBusy ? "Starting video generation" : reviewRequired ? "Review required" : currentStage}</h2>{task ? <StatusBadge status={task.status} /> : null}</div><p className="mt-1 text-sm text-ink-secondary">{task?.status === "failed" ? "Generation stopped and needs attention." : reviewRequired ? "Campaign output is waiting for review." : generateBusy ? "Creating the task. This should only take a moment." : `${taskPercent}% complete`}</p>{activeTask && task?.status !== "failed" ? <div className="mt-3 h-2 overflow-hidden rounded-full bg-white"><div className="h-full bg-brand-blue" style={{ width: `${taskPercent}%` }} /></div> : null}</div><div className="flex flex-col gap-2 sm:flex-row">{reviewRequired ? <Link href={`/w/${slug}/reviews`} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-navy px-4 text-sm font-semibold text-white">Open review</Link> : null}{task ? <Link href={`/w/${slug}/campaigns/${campaignId}/task?taskId=${task.id}`} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-4 text-sm font-semibold text-navy">View full progress</Link> : null}</div></div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-border bg-white p-4 sm:p-5"><h2 className="text-base font-bold text-navy">Marketing Analysis</h2><p className="mt-1 text-sm text-ink-secondary">{campaign.generateStatus === "completed" ? "Marketing analysis and package are ready." : campaign.generateStatus === "processing" ? "Marketing analysis is in progress." : "Marketing analysis has not been generated yet."}</p><p className="mt-3 text-sm"><span className="text-ink-secondary">Targets: </span><span className="font-medium text-navy">{campaign.platforms?.length ? formatPublishingPlatforms(campaign.platforms) : "No platforms selected"}</span></p><button type="button" onClick={() => setTab("package")} className="mt-3 min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-navy">View Marketing Package</button></section>

          <section id="create-content" className="rounded-2xl border border-border bg-white p-4 sm:p-5"><h2 className="text-base font-bold text-navy">Create Content</h2><p className="mt-1 text-xs text-ink-secondary">Video Studio and AI Story are peer workflows inside this Campaign.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="flex min-h-44 flex-col rounded-xl border border-border p-4"><h3 className="font-bold text-navy">Create Video</h3><p className="mt-2 flex-1 text-sm text-ink-secondary">Use Campaign assets and the existing generation pipeline.</p>{!canCreate ? <p className="mb-3 text-xs text-amber-700">Operator permission is required.</p> : assets.length === 0 ? <p className="mb-3 text-xs text-amber-700">Add at least one Campaign asset first.</p> : null}<button type="button" disabled={!canCreate || assets.length === 0 || generateBusy || Boolean(activeTask)} onClick={() => void onGenerate()} className="min-h-11 rounded-lg bg-navy px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{generateBusy ? "Starting…" : "Create Video"}</button></div><div className="flex min-h-44 flex-col rounded-xl border border-border p-4"><h3 className="font-bold text-navy">Create AI Story</h3><p className="mt-2 flex-1 text-sm text-ink-secondary">Draft a Campaign-owned story. Assets are optional.</p>{!canCreate ? <p className="mb-3 text-xs text-amber-700">Operator permission is required.</p> : null}{canCreate ? <Link href={`/w/${slug}/campaigns/${campaignId}/ai-stories/new`} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-navy px-4 text-sm font-semibold text-white">Create AI Story</Link> : <span aria-disabled className="inline-flex min-h-11 items-center justify-center rounded-lg bg-slate-200 text-sm font-semibold text-slate-500">Create AI Story</span>}</div></div></section>

          <section className="rounded-2xl border border-border bg-white p-4 sm:p-5"><h2 className="text-base font-bold text-navy">Media Assets</h2><p className="mt-1 text-xs text-ink-secondary">{assets.length} Campaign asset{assets.length === 1 ? "" : "s"}</p>{assets.length ? <ul className="mt-3 divide-y divide-border">{assets.slice(0, 4).map((asset) => <li key={asset.id} className="flex min-w-0 items-center gap-3 py-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-xs font-semibold">{asset.type === "video" ? "Video" : "Image"}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-navy">{asset.displayName || asset.originalFilename || "Asset"}</p>{asset.displayName && asset.originalFilename && asset.displayName !== asset.originalFilename ? <p className="truncate text-xs text-ink-secondary">Original: {asset.originalFilename}</p> : null}</div></li>)}</ul> : <p className="mt-3 text-sm text-ink-secondary">No Campaign assets yet.</p>}<Link href={`/w/${slug}/assets`} className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-navy">Manage Assets</Link></section>

          <section className="rounded-2xl border border-border bg-white p-4 sm:p-5"><h2 className="text-base font-bold text-navy">Recent Content</h2><div className="mt-4 grid gap-5 lg:grid-cols-2"><div><h3 className="text-sm font-bold text-navy">Recent Videos</h3>{creatives.length ? <ul className="mt-2 space-y-2">{creatives.slice(-3).reverse().map((creative, index) => <li key={creative.id}><Link href={`/w/${slug}/creatives/${creative.id}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border p-3"><span className="truncate text-sm font-semibold text-navy">{creative.title || `Campaign video ${index + 1}`}</span><StatusBadge status={creative.status || "processing"} /></Link></li>)}</ul> : <p className="mt-2 rounded-xl border border-dashed border-border p-3 text-sm text-ink-secondary">No videos yet. <a href="#create-content" className="font-semibold underline">Create a video</a>.</p>}</div><div><h3 className="text-sm font-bold text-navy">Recent AI Stories</h3>{storiesLoading ? <div className="mt-2 h-20 animate-pulse rounded-xl bg-surface-muted" /> : storiesError ? <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{storiesError}<button type="button" onClick={() => void load()} className="mt-2 block min-h-11 rounded-lg border border-red-300 px-3 font-semibold">Try again</button></div> : aiStories.length ? <ul className="mt-2 space-y-2">{aiStories.slice(0, 3).map((story) => <li key={story.id}><Link href={`/w/${slug}/campaigns/${campaignId}/ai-stories/${story.id}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border p-3"><span className="truncate text-sm font-semibold text-navy">{story.title}</span><StatusBadge status={story.status} /></Link></li>)}</ul> : <p className="mt-2 rounded-xl border border-dashed border-border p-3 text-sm text-ink-secondary">No AI Stories yet. <a href="#create-content" className="font-semibold underline">Create an AI Story</a>.</p>}</div></div></section>

          <section className="rounded-2xl border border-border bg-white p-4 sm:p-5"><h2 className="text-base font-bold text-navy">Recent Tasks</h2><p className="mt-1 text-xs text-ink-secondary">The Campaign API currently exposes only the latest task.</p>{task ? <div className="mt-3 flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-navy">Video generation</span><StatusBadge status={task.status} /></div><Link href={`/w/${slug}/campaigns/${campaignId}/task?taskId=${task.id}`} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold text-navy">View details</Link></div> : <p className="mt-3 text-sm text-ink-secondary">No task data is available.</p>}</section>

          <section className="rounded-2xl border border-border bg-white p-4 sm:p-5"><h2 className="text-base font-bold text-navy">Activity</h2><p className="mt-2 text-sm text-ink-secondary">Compact status summary, not a complete audit trail: <strong className="text-navy">{campaign.status.replace(/_/g, " ")}</strong>.</p><button type="button" onClick={() => setTab("activity")} className="mt-3 min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-navy">View Activity</button></section>

          <details className="group rounded-2xl border border-border bg-white"><summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 font-bold text-navy sm:px-5">Campaign Settings<span aria-hidden>⌄</span></summary><div className="space-y-4 border-t border-border p-4 sm:p-5">{!canCreate ? <p className="rounded-lg bg-surface-muted p-3 text-sm text-ink-secondary">You have view-only access.</p> : null}<fieldset disabled={!canCreate || saving} className="space-y-4 disabled:opacity-60"><label className="block text-sm font-semibold text-navy">{t("campaign.name")}<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-border px-3 font-normal" /></label><label className="block text-sm font-semibold text-navy">{t("campaign.workspace.objective")}<select value={objective} onChange={(e) => setObjective(e.target.value as CampaignObjective | "")} className="mt-1 min-h-11 w-full rounded-lg border border-border px-3 font-normal"><option value="">{t("campaign.workspace.objectivePlaceholder")}</option>{CAMPAIGN_OBJECTIVES.map((value) => <option key={value} value={value}>{CAMPAIGN_OBJECTIVE_LABELS[value]}</option>)}</select></label>{objective === "other" ? <input value={objectiveCustom} onChange={(e) => setObjectiveCustom(e.target.value)} className="min-h-11 w-full rounded-lg border border-border px-3" /> : null}<label className="block text-sm font-semibold text-navy">{t("campaign.workspace.audienceOverride")}<textarea value={audienceOverride} onChange={(e) => setAudienceOverride(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-border p-3 font-normal" /></label><CampaignBriefAssistant campaignId={campaign.id} value={brief} onChange={setBrief} campaignName={name} objectiveLabel={resolveCampaignObjectiveLabel({ objective, objectiveCustom, goal: campaign.goal })} platforms={campaign.platforms ?? []} targetAudience={audienceOverride} disabled={!canCreate || saving} /><InferredLanguageReadonly values={languages} /><button type="button" onClick={() => void saveOverview()} className="min-h-11 rounded-lg bg-navy px-5 text-sm font-semibold text-white">{saving ? "Saving…" : t("campaign.workspace.save")}</button></fieldset></div></details>
        </div>
      ) : null}

      {tab === "package" ? (
        <CampaignMarketingPackageView campaignId={campaignId} slug={slug} />
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
