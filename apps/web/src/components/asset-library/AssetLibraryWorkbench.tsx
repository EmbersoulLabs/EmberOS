"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatFileSize } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import { uploadLibraryFile } from "@/lib/library-upload";
import { AssetThumb } from "@/components/campaign/AssetThumb";

export type LibraryAsset = {
  id: string;
  type: string;
  displayName: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
  status: string;
  metadata?: Record<string, unknown> | null;
};

export type LibraryStory = {
  id: string;
  name: string;
  status: "draft" | "ready" | "archived";
  assets: Array<LibraryAsset & { sortOrder?: number }>;
  updatedAt: string;
};

function assetLabel(asset: LibraryAsset) {
  return asset.displayName || asset.originalFilename || asset.id.slice(0, 8);
}

function assetAnalysisLabel(asset: LibraryAsset): string | null {
  const state = asset.metadata?.assetAnalysis;
  const status =
    state && typeof state === "object"
      ? (state as Record<string, unknown>).status
      : undefined;
  if (status === "pending") return "Analysis pending";
  if (status === "analyzing") return "Analyzing image…";
  if (status === "failed") return "Analysis unavailable — manual rename is available";
  return null;
}

function TypeIcon({ type }: { type: string }) {
  const label = type.slice(0, 1).toUpperCase();
  return (
    <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-navy/5 text-sm font-bold uppercase text-navy">
      {label}
    </span>
  );
}

function AssetPreview({
  workspaceId,
  asset,
}: {
  workspaceId: string;
  asset: LibraryAsset;
}) {
  if (asset.type === "image" || asset.type === "video") {
    return <AssetThumb workspaceId={workspaceId} asset={asset} className="h-12 w-12" />;
  }
  return <TypeIcon type={asset.type} />;
}

export function AssetLibraryWorkbench({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"assets" | "stories">("assets");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [stories, setStories] = useState<LibraryStory[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadPhase, setUploadPhase] = useState<"idle" | "uploading" | "processing">(
    "idle"
  );
  const [dragActive, setDragActive] = useState(false);
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [storyName, setStoryName] = useState("");
  const [storyStatus, setStoryStatus] = useState<"draft" | "ready" | "archived">("draft");
  const [storyAssetIds, setStoryAssetIds] = useState<string[]>([]);
  const [dragAssetId, setDragAssetId] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (type) params.set("type", type);
    if (sort) params.set("sort", sort);
    const res = await fetch(`/api/workspaces/${workspaceId}/library?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load assets");
    setAssets(data.assets ?? []);
  }, [workspaceId, q, type, sort]);

  const loadStories = useCallback(async () => {
    const params = new URLSearchParams({ includeArchived: "1" });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/workspaces/${workspaceId}/stories?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load stories");
    setStories(data.stories ?? []);
  }, [workspaceId, q]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadAssets(), loadStories()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [loadAssets, loadStories]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const analyzing = assets.some((asset) => {
      const state = asset.metadata?.assetAnalysis;
      const status =
        state && typeof state === "object"
          ? (state as Record<string, unknown>).status
          : undefined;
      return status === "pending" || status === "analyzing";
    });
    if (!analyzing) return;
    const timer = window.setInterval(() => void loadAssets(), 3_000);
    return () => window.clearInterval(timer);
  }, [assets, loadAssets]);

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError("");
    try {
      for (const file of list) {
        await uploadLibraryFile(workspaceId, file, (phase) => {
          if (phase === "completed") return;
          setUploadPhase(phase);
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      // QA-001 — always return upload control to idle after completion/failure.
      setUploadPhase("idle");
      await reload();
    }
  };

  const onRename = async (asset: LibraryAsset) => {
    const next = window.prompt(t("assetLibrary.renamePrompt"), assetLabel(asset));
    if (!next?.trim()) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/library/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: next.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Rename failed");
      return;
    }
    await reload();
  };

  const onDelete = async (asset: LibraryAsset) => {
    if (!window.confirm(t("assetLibrary.deleteConfirm"))) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/library/${asset.id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Delete failed");
      return;
    }
    await reload();
  };

  const onDownload = async (asset: LibraryAsset) => {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/library/${asset.id}/download-url`
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Download failed");
      return;
    }
    window.open(data.downloadUrl, "_blank", "noopener,noreferrer");
  };

  const beginCreateStory = () => {
    setEditingStoryId("new");
    setStoryName("");
    setStoryStatus("draft");
    setStoryAssetIds([]);
    setTab("stories");
  };

  const beginEditStory = (story: LibraryStory) => {
    setEditingStoryId(story.id);
    setStoryName(story.name);
    setStoryStatus(story.status);
    setStoryAssetIds(story.assets.map((a) => a.id));
    setTab("stories");
  };

  const saveStory = async () => {
    if (!storyName.trim()) return;
    setError("");
    try {
      if (editingStoryId === "new") {
        const res = await fetch(`/api/workspaces/${workspaceId}/stories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: storyName.trim(),
            status: storyStatus,
            assetIds: storyAssetIds,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Create failed");
      } else if (editingStoryId) {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/stories/${editingStoryId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: storyName.trim(),
              status: storyStatus,
              assetIds: storyAssetIds,
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Save failed");
      }
      setEditingStoryId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const deleteStory = async (storyId: string) => {
    if (!window.confirm(t("assetLibrary.storyDeleteConfirm"))) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/stories/${storyId}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Delete failed");
      return;
    }
    if (editingStoryId === storyId) setEditingStoryId(null);
    await reload();
  };

  const orderedStoryAssets = useMemo(() => {
    const map = new Map(assets.map((a) => [a.id, a]));
    return storyAssetIds.map((id) => map.get(id)).filter(Boolean) as LibraryAsset[];
  }, [assets, storyAssetIds]);

  const onReorderDrop = (targetId: string) => {
    if (!dragAssetId || dragAssetId === targetId) return;
    setStoryAssetIds((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragAssetId);
      const to = next.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragAssetId);
      return next;
    });
    setDragAssetId(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy">{t("assetLibrary.title")}</h1>
          <p className="mt-1 text-sm text-ink-secondary">{t("assetLibrary.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy/90"
          >
            {uploadPhase === "uploading"
              ? t("assetLibrary.uploading")
              : uploadPhase === "processing"
                ? t("assetLibrary.processing")
                : t("assetLibrary.upload")}
          </button>
          <button
            type="button"
            onClick={beginCreateStory}
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-navy hover:bg-surface-muted"
          >
            {t("assetLibrary.createStory")}
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*,.pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border border-dashed px-4 py-6 text-center text-sm transition ${
          dragActive
            ? "border-brand-blue bg-brand-blue/5 text-brand-blue"
            : "border-border bg-white text-ink-secondary"
        }`}
      >
        {t("assetLibrary.upload")} · Image / Video / Audio / PDF
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
            tab === "assets" ? "bg-navy text-white" : "text-navy hover:bg-surface-muted"
          }`}
          onClick={() => setTab("assets")}
        >
          {t("assetLibrary.tabAssets")}
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
            tab === "stories" ? "bg-navy text-white" : "text-navy hover:bg-surface-muted"
          }`}
          onClick={() => setTab("stories")}
        >
          {t("assetLibrary.tabStories")}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("assetLibrary.searchPlaceholder")}
          className="min-w-[14rem] flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm"
        />
        {tab === "assets" && (
          <>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              <option value="">{t("assetLibrary.filterAll")}</option>
              <option value="image">{t("assetLibrary.filterImage")}</option>
              <option value="video">{t("assetLibrary.filterVideo")}</option>
              <option value="audio">{t("assetLibrary.filterAudio")}</option>
              <option value="pdf">{t("assetLibrary.filterPdf")}</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-2 text-sm"
            >
              <option value="newest">{t("assetLibrary.sortNewest")}</option>
              <option value="name">{t("assetLibrary.sortName")}</option>
              <option value="size">{t("assetLibrary.sortSize")}</option>
            </select>
            <button
              type="button"
              onClick={() => setView("grid")}
              className={`rounded-lg px-3 py-2 text-sm ${view === "grid" ? "bg-navy/10 font-semibold text-navy" : "text-ink-secondary"}`}
            >
              {t("assetLibrary.viewGrid")}
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={`rounded-lg px-3 py-2 text-sm ${view === "list" ? "bg-navy/10 font-semibold text-navy" : "text-ink-secondary"}`}
            >
              {t("assetLibrary.viewList")}
            </button>
          </>
        )}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {loading ? <p className="text-sm text-ink-secondary">Loading…</p> : null}

      {tab === "assets" && !loading && assets.length === 0 ? (
        <p className="text-sm text-ink-secondary">{t("assetLibrary.empty")}</p>
      ) : null}

      {tab === "assets" && view === "grid" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {assets.map((asset) => (
            <div key={asset.id} className="rounded-xl border border-border bg-white p-3">
              <AssetPreview workspaceId={workspaceId} asset={asset} />
              <p className="mt-2 truncate text-sm font-semibold text-navy" title={assetLabel(asset)}>
                {assetLabel(asset)}
              </p>
              {asset.originalFilename &&
              asset.displayName &&
              asset.displayName !== asset.originalFilename ? (
                <p className="truncate text-xs text-ink-secondary" title={asset.originalFilename}>
                  {asset.originalFilename}
                </p>
              ) : null}
              <p className="mt-0.5 text-xs text-ink-secondary">
                {asset.type} · {formatFileSize(asset.fileSizeBytes)}
              </p>
              {assetAnalysisLabel(asset) ? (
                <p className="mt-1 text-xs text-ink-secondary" role="status">
                  {assetAnalysisLabel(asset)}
                </p>
              ) : null}
              <p className="text-xs text-ink-secondary">
                {new Date(asset.createdAt).toLocaleDateString()}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className="text-xs text-brand-blue" onClick={() => void onRename(asset)}>
                  {t("assetLibrary.rename")}
                </button>
                <button type="button" className="text-xs text-brand-blue" onClick={() => void onDownload(asset)}>
                  {t("assetLibrary.download")}
                </button>
                <button type="button" className="text-xs text-red-600" onClick={() => void onDelete(asset)}>
                  {t("assetLibrary.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "assets" && view === "list" && (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-ink-secondary">
              <tr>
                <th className="px-3 py-2">{t("assetLibrary.renamePrompt")}</th>
                <th className="px-3 py-2">{t("assetLibrary.type")}</th>
                <th className="px-3 py-2">{t("assetLibrary.size")}</th>
                <th className="px-3 py-2">{t("assetLibrary.uploaded")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-navy">{assetLabel(asset)}</td>
                  <td className="px-3 py-2 capitalize">
                    {asset.type}
                    {assetAnalysisLabel(asset) ? (
                      <span className="mt-0.5 block text-xs normal-case text-ink-secondary" role="status">
                        {assetAnalysisLabel(asset)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{formatFileSize(asset.fileSizeBytes)}</td>
                  <td className="px-3 py-2">{new Date(asset.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="mr-2 text-xs text-brand-blue" onClick={() => void onRename(asset)}>
                      {t("assetLibrary.rename")}
                    </button>
                    <button type="button" className="mr-2 text-xs text-brand-blue" onClick={() => void onDownload(asset)}>
                      {t("assetLibrary.download")}
                    </button>
                    <button type="button" className="text-xs text-red-600" onClick={() => void onDelete(asset)}>
                      {t("assetLibrary.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "stories" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-2">
            {stories.length === 0 ? (
              <p className="text-sm text-ink-secondary">{t("assetLibrary.storyEmpty")}</p>
            ) : (
              stories.map((story) => (
                <button
                  key={story.id}
                  type="button"
                  onClick={() => beginEditStory(story)}
                  className={`block w-full rounded-xl border px-3 py-3 text-left transition ${
                    editingStoryId === story.id
                      ? "border-navy bg-navy/5"
                      : "border-border bg-white hover:bg-surface-muted"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-navy">{story.name}</span>
                    <span className="text-xs uppercase tracking-wide text-ink-secondary">
                      {story.status === "ready"
                        ? t("assetLibrary.storyReady")
                        : story.status === "archived"
                          ? t("assetLibrary.storyArchived")
                          : t("assetLibrary.storyDraft")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-secondary">
                    {story.assets.length} assets
                  </p>
                </button>
              ))
            )}
          </div>

          {editingStoryId ? (
            <div className="rounded-xl border border-border bg-white p-4">
              <label className="block text-sm font-semibold text-navy">
                {t("assetLibrary.storyName")}
                <input
                  value={storyName}
                  onChange={(e) => setStoryName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="mt-3 block text-sm font-semibold text-navy">
                Status
                <select
                  value={storyStatus}
                  onChange={(e) =>
                    setStoryStatus(e.target.value as "draft" | "ready" | "archived")
                  }
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm font-normal"
                >
                  <option value="draft">{t("assetLibrary.storyDraft")}</option>
                  <option value="ready">{t("assetLibrary.storyReady")}</option>
                  <option value="archived">{t("assetLibrary.storyArchived")}</option>
                </select>
              </label>

              <p className="mt-3 text-xs text-ink-secondary">{t("assetLibrary.dragHint")}</p>
              <div className="mt-2 space-y-2">
                {orderedStoryAssets.map((asset) => (
                  <div
                    key={asset.id}
                    draggable
                    onDragStart={() => setDragAssetId(asset.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onReorderDrop(asset.id)}
                    className="flex cursor-grab items-center justify-between rounded-lg border border-border bg-surface-muted px-3 py-2 active:cursor-grabbing"
                  >
                    <span className="truncate text-sm text-navy">{assetLabel(asset)}</span>
                    <button
                      type="button"
                      className="text-xs text-red-600"
                      onClick={() =>
                        setStoryAssetIds((prev) => prev.filter((id) => id !== asset.id))
                      }
                    >
                      {t("assetLibrary.removeAsset")}
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <p className="text-sm font-semibold text-navy">{t("assetLibrary.addAssets")}</p>
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {assets
                    .filter((a) => !storyAssetIds.includes(a.id))
                    .map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted"
                        onClick={() => setStoryAssetIds((prev) => [...prev, asset.id])}
                      >
                        {assetLabel(asset)}
                      </button>
                    ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveStory()}
                  className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white"
                >
                  {t("assetLibrary.saveStory")}
                </button>
                {editingStoryId !== "new" ? (
                  <button
                    type="button"
                    onClick={() => void deleteStory(editingStoryId)}
                    className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600"
                  >
                    {t("assetLibrary.delete")}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setEditingStoryId(null)}
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
