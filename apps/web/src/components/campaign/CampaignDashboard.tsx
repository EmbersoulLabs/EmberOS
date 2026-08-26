"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CAMPAIGN_OBJECTIVE_LABELS,
  normalizeStrategyPlan,
  type MarketingContentPackage,
} from "@ceo-agent/shared";
import { AppShell, StatusBadge } from "@/components/AppShell";
import { MarketingPackagePanel } from "@/components/pipeline/MarketingPackagePanel";
import { PhotoSceneExtractionPanel } from "@/components/photo-scene/PhotoSceneExtractionPanel";
import { PhotoSceneOfficialLibraryPanel } from "@/components/photo-scene/PhotoSceneOfficialLibraryPanel";
import { PhotoSceneMarketingImagePanel } from "@/components/photo-scene/PhotoSceneMarketingImagePanel";
import {
  friendlyWorkspaceFailure,
  mapTaskDisplayState,
  resolveContinueCampaign,
  type WorkspaceDisplayState,
} from "@/lib/campaign-workspace";
import { formatPlatformLabel } from "@/lib/clip-utils";

export interface CampaignDashboardData {
  campaign: Record<string, unknown>;
  assets: Array<Record<string, unknown>>;
  assetStories: Array<Record<string, unknown>>;
  task: Record<string, unknown> | null;
  creative: Record<string, unknown> | null;
  creatives: Array<Record<string, unknown>>;
  hasVideoAsset: boolean;
  clipCount: number;
  canDelete: boolean;
}

const STATE_LABEL: Record<WorkspaceDisplayState, string> = {
  NOT_STARTED: "Not started",
  AVAILABLE: "Available",
  QUEUED: "Queued",
  IN_PROGRESS: "In progress",
  PENDING_REVIEW: "Pending review",
  RECOVERY_AVAILABLE: "Needs attention",
  COMPLETED: "Completed",
};

function dateLabel(value: unknown): string {
  if (!value) return "Not available";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function objectiveLabel(campaign: Record<string, unknown>): string {
  if (campaign.objective === "other" && campaign.objectiveCustom) {
    return String(campaign.objectiveCustom);
  }
  const objective = campaign.objective as keyof typeof CAMPAIGN_OBJECTIVE_LABELS | undefined;
  return (objective && CAMPAIGN_OBJECTIVE_LABELS[objective]) || String(campaign.goal || "Not set");
}

function audienceLabel(campaign: Record<string, unknown>): string {
  const audience = campaign.targetAudience as { summary?: string } | string | null | undefined;
  if (typeof audience === "string") return audience || "Not set";
  return audience?.summary || "Not set";
}

function WorkspaceCard({
  title,
  purpose,
  state,
  action,
  children,
}: {
  title: string;
  purpose: string;
  state: WorkspaceDisplayState;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const headingId = `module-${title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section className="rounded-2xl border border-border bg-white p-4 shadow-card sm:p-5" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="font-bold text-navy">{title}</h3>
          <p className="mt-1 text-sm text-ink-secondary">{purpose}</p>
        </div>
        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-navy">{STATE_LABEL[state]}</span>
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}

function AiStoryModule({ slug, campaignId }: { slug: string; campaignId: string }) {
  const [loadState, setLoadState] = useState<"loading" | "denied" | "ready">("loading");
  const [stories, setStories] = useState<Array<{ id: string; title: string; status: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/campaigns/${campaignId}/ai-stories`)
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) return setLoadState("denied");
        setStories(body.stories ?? []);
        setLoadState("ready");
      })
      .catch(() => { if (!cancelled) setLoadState("denied"); });
    return () => { cancelled = true; };
  }, [campaignId]);

  if (loadState === "denied") return null;
  const state: WorkspaceDisplayState = loadState === "loading"
    ? "AVAILABLE"
    : stories.some((story) => story.status === "pending_review")
      ? "PENDING_REVIEW"
      : stories.length ? "AVAILABLE" : "NOT_STARTED";

  return (
    <WorkspaceCard
      title="AI Story"
      purpose="Plan and review Campaign-owned stories using the current AI Story runtime."
      state={state}
      action={<Link href={`/w/${slug}/campaigns/${campaignId}/ai-stories/new`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-navy hover:bg-surface-muted">Create AI Story</Link>}
    >
      {loadState === "loading" ? <p className="text-sm text-ink-secondary">Loading durable story state…</p> : null}
      {stories.length ? (
        <ul className="space-y-2">
          {stories.slice(0, 3).map((story) => (
            <li key={story.id}>
              <Link href={`/w/${slug}/campaigns/${campaignId}/ai-stories/${story.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 hover:bg-surface-muted">
                <span className="truncate text-sm font-semibold text-navy">{story.title}</span>
                <StatusBadge status={story.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : loadState === "ready" ? <p className="text-sm text-ink-secondary">No AI Stories yet.</p> : null}
    </WorkspaceCard>
  );
}

export function CampaignDashboard({
  slug,
  campaignId,
  data,
  deleting,
  deleteError,
  onDelete,
}: {
  slug: string;
  campaignId: string;
  data: CampaignDashboardData;
  deleting: boolean;
  deleteError: string;
  onDelete: () => void;
}) {
  const { campaign, assets, assetStories = [], task, creatives, canDelete } = data;
  const campaignStatus = String(campaign.status || "draft");
  const taskId = task?.id ? String(task.id) : undefined;
  const taskStatus = task?.status ? String(task.status) : undefined;
  const taskState = mapTaskDisplayState(taskStatus);
  const continueTarget = resolveContinueCampaign({ slug, campaignId, campaignStatus, taskId, taskStatus });
  const taskHref = taskId ? `/w/${slug}/campaigns/${campaignId}/task?taskId=${taskId}` : null;
  const progress = (task?.stepProgress ?? {}) as Record<string, { status?: string; output?: unknown }>;
  const contentPackage = progress.content_generate?.status === "completed"
    ? progress.content_generate.output as MarketingContentPackage | undefined
    : undefined;
  const strategy = progress.strategy_plan?.status === "completed"
    ? normalizeStrategyPlan(progress.strategy_plan.output)
    : undefined;
  const platforms = Array.isArray(campaign.platforms) ? campaign.platforms as string[] : [];
  const failure = friendlyWorkspaceFailure(taskStatus);

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border border-border bg-white p-4 shadow-card sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">Campaign Workspace</p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <h1 className="break-words text-2xl font-bold tracking-tight text-navy">{String(campaign.name || "Campaign")}</h1>
                <StatusBadge status={campaignStatus} />
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="text-xs text-ink-secondary">Objective</dt><dd className="mt-0.5 font-semibold text-navy">{objectiveLabel(campaign)}</dd></div>
                <div><dt className="text-xs text-ink-secondary">Publishing Platforms</dt><dd className="mt-0.5 font-semibold text-navy">{platforms.length ? platforms.map(formatPlatformLabel).join(" · ") : "Not set"}</dd></div>
                <div><dt className="text-xs text-ink-secondary">Status</dt><dd className="mt-0.5 font-semibold capitalize text-navy">{campaignStatus.replace(/_/g, " ")}</dd></div>
              </dl>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/w/${slug}/campaigns`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-navy hover:bg-surface-muted">All Campaigns</Link>
              {canDelete ? <button type="button" disabled={deleting} onClick={onDelete} className="min-h-11 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">{deleting ? "Deleting…" : "Delete"}</button> : null}
            </div>
          </div>
        </header>

        {deleteError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{deleteError}</p> : null}

        {continueTarget ? (
          <section className="rounded-2xl border border-brand-blue/20 bg-brand-blue/5 p-4 sm:p-5" aria-labelledby="continue-campaign-title">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="continue-campaign-title" className="font-bold text-navy">Continue Campaign</h2>
                <p className="mt-1 text-sm text-ink-secondary">This action is derived from the latest durable Campaign and task state.</p>
              </div>
              <Link href={continueTarget.href} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-navy px-5 text-sm font-semibold text-white">{continueTarget.label}</Link>
            </div>
          </section>
        ) : null}

        {failure ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{failure}</p> : null}

        <section aria-labelledby="campaign-overview-title" className="rounded-2xl border border-border bg-white p-4 shadow-card sm:p-6">
          <h2 id="campaign-overview-title" className="text-lg font-bold text-navy">Overview</h2>
          <p className="mt-1 text-sm text-ink-secondary">Read-only Campaign facts confirmed during creation.</p>
          <dl className="mt-5 grid gap-5 sm:grid-cols-2">
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Campaign Name</dt><dd className="mt-1 text-sm text-navy">{String(campaign.name || "Not set")}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Objective</dt><dd className="mt-1 text-sm text-navy">{objectiveLabel(campaign)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Publishing Platforms</dt><dd className="mt-1 text-sm text-navy">{platforms.length ? platforms.map(formatPlatformLabel).join(" · ") : "Not set"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Target Audience</dt><dd className="mt-1 whitespace-pre-wrap text-sm text-navy">{audienceLabel(campaign)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Campaign Brief</dt><dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-navy">{String(campaign.campaignBrief || "Not provided")}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Created</dt><dd className="mt-1 text-sm text-navy">{dateLabel(campaign.createdAt)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Last Updated</dt><dd className="mt-1 text-sm text-navy">{dateLabel(campaign.updatedAt)}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Assets</dt><dd className="mt-1 text-sm text-navy">{assets.length} attached</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Asset Stories</dt><dd className="mt-1 text-sm text-navy">{assetStories.length ? assetStories.map((story) => String(story.name)).join(", ") : "None"}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="content-modules-title">
          <div className="mb-4">
            <h2 id="content-modules-title" className="text-lg font-bold text-navy">Content</h2>
            <p className="mt-1 text-sm text-ink-secondary">Each module keeps its current main execution engine.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <WorkspaceCard title="Photo Scene" purpose="Create and manage product-scene imagery with the current Photo Scene engine." state={assets.length ? "AVAILABLE" : "NOT_STARTED"}>
              <p className="text-sm text-ink-secondary">{assets.length ? `${assets.length} authorized Campaign asset${assets.length === 1 ? "" : "s"} available.` : "Attach a Workspace Asset before starting Photo Scene."}</p>
            </WorkspaceCard>
            <WorkspaceCard
              title="Video Studio"
              purpose="Track the current Campaign task, results, recovery, and export readiness."
              state={taskState}
              action={taskHref ? <Link href={taskHref} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-navy hover:bg-surface-muted">Open Video Studio workflow</Link> : undefined}
            >
              <p className="text-sm text-ink-secondary">{taskStatus ? `Latest task: ${taskStatus.replace(/_/g, " ")}.` : "No Video Studio task exists for this Campaign."}</p>
            </WorkspaceCard>
            <AiStoryModule slug={slug} campaignId={campaignId} />
          </div>
          <div className="mt-4 space-y-4" data-testid="photo-scene-main-engine">
            <PhotoSceneExtractionPanel campaignId={campaignId} assets={assets} />
            <PhotoSceneOfficialLibraryPanel campaignId={campaignId} />
            <PhotoSceneMarketingImagePanel campaignId={campaignId} />
          </div>
        </section>

        <section aria-labelledby="marketing-package-title" className="rounded-2xl border border-border bg-white p-4 shadow-card sm:p-6">
          <h2 id="marketing-package-title" className="text-lg font-bold text-navy">Marketing Package</h2>
          {contentPackage ? (
            <MarketingPackagePanel contentPackage={contentPackage} taskId={taskId} strategy={strategy} />
          ) : (
            <div className="mt-3">
              <p className="text-sm text-ink-secondary">{taskState === "IN_PROGRESS" || taskState === "QUEUED" ? "The Marketing Package is still being prepared." : taskState === "RECOVERY_AVAILABLE" ? "The workflow needs attention before a Marketing Package can be completed." : "No durable Marketing Package is available yet."}</p>
              {taskHref ? <Link href={taskHref} className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-semibold text-navy hover:bg-surface-muted">Open workflow details</Link> : null}
            </div>
          )}
        </section>

        <section aria-labelledby="activity-title" className="rounded-2xl border border-border bg-white p-4 shadow-card sm:p-6">
          <h2 id="activity-title" className="text-lg font-bold text-navy">Activity</h2>
          <p className="mt-1 text-sm text-ink-secondary">Latest durable facts; this is not a synthetic event timeline.</p>
          <ul className="mt-4 divide-y divide-border text-sm">
            <li className="flex flex-wrap items-center justify-between gap-2 py-3"><span className="text-ink-secondary">Campaign updated</span><strong className="text-navy">{dateLabel(campaign.updatedAt)}</strong></li>
            {task ? <li className="flex flex-wrap items-center justify-between gap-2 py-3"><span className="text-ink-secondary">Latest workflow</span><span className="flex items-center gap-2"><StatusBadge status={taskStatus || "pending"} /><strong className="text-navy">{dateLabel(task.updatedAt || task.createdAt)}</strong></span></li> : null}
            <li className="flex flex-wrap items-center justify-between gap-2 py-3"><span className="text-ink-secondary">Generated results</span><strong className="text-navy">{creatives.length}</strong></li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
