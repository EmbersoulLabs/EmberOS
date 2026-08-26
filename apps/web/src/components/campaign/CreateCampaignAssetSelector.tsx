"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveAssetDisplayLabel } from "@ceo-agent/shared";
import { uploadLibraryFile, type LibraryUploadPhase } from "@/lib/library-upload";

export type CampaignSelectableAsset = {
  id: string;
  type: string;
  displayName: string | null;
  originalFilename: string | null;
  status: string;
};

export type CampaignSelectableStory = {
  id: string;
  name: string;
  status: string;
  assets: CampaignSelectableAsset[];
};

export function CreateCampaignAssetSelector({
  workspaceId,
  selectedAssetIds,
  selectedStoryIds,
  onAssetsChange,
  onStoriesChange,
  disabled,
}: {
  workspaceId: string;
  selectedAssetIds: string[];
  selectedStoryIds: string[];
  onAssetsChange: (ids: string[]) => void;
  onStoriesChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<CampaignSelectableAsset[]>([]);
  const [stories, setStories] = useState<CampaignSelectableStory[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<LibraryUploadPhase | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const [assetResponse, storyResponse] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/library?sort=newest&q=${encodeURIComponent(query)}`),
      fetch(`/api/workspaces/${workspaceId}/stories?q=${encodeURIComponent(query)}`),
    ]);
    const [assetBody, storyBody] = await Promise.all([
      assetResponse.json(),
      storyResponse.json(),
    ]);
    if (!assetResponse.ok) throw new Error(assetBody.error ?? "Asset Library failed to load");
    if (!storyResponse.ok) throw new Error(storyBody.error ?? "Asset Stories failed to load");
    setAssets((assetBody.assets ?? []).filter((asset: CampaignSelectableAsset) => asset.status === "ready"));
    setStories((storyBody.stories ?? []).filter((story: CampaignSelectableStory) => story.status === "ready"));
  }, [query, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Asset load failed"));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [reload]);

  function toggle(current: string[], id: string, update: (ids: string[]) => void) {
    update(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError("");
    try {
      const uploadedIds: string[] = [];
      for (const file of Array.from(files)) {
        const asset = await uploadLibraryFile(workspaceId, file, setPhase);
        uploadedIds.push(asset.id);
      }
      onAssetsChange([...new Set([...selectedAssetIds, ...uploadedIds])]);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload failed");
    } finally {
      setBusy(false);
      setPhase(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="Search Asset Library"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 rounded-xl border border-border px-4 py-2.5"
          placeholder="Search Workspace Asset Library"
        />
        <button
          type="button"
          disabled={disabled || busy}
          className="rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
        >
          {phase ? `Upload: ${phase}` : "Upload to Asset Library"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,video/*,audio/*,application/pdf"
          onChange={(event) => void upload(event.target.files)}
        />
      </div>
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <fieldset disabled={disabled || busy}>
        <legend className="text-sm font-semibold text-navy">Workspace Assets</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {assets.map((asset) => (
            <label key={asset.id} className="flex items-center gap-3 rounded-xl border border-border bg-white p-3">
              <input
                type="checkbox"
                checked={selectedAssetIds.includes(asset.id)}
                onChange={() => toggle(selectedAssetIds, asset.id, onAssetsChange)}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-navy">{resolveAssetDisplayLabel(asset)}</span>
                <span className="text-xs text-ink-secondary">{asset.type}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={disabled || busy}>
        <legend className="text-sm font-semibold text-navy">Asset Stories</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {stories.map((story) => (
            <label key={story.id} className="flex items-center gap-3 rounded-xl border border-border bg-white p-3">
              <input
                type="checkbox"
                checked={selectedStoryIds.includes(story.id)}
                onChange={() => toggle(selectedStoryIds, story.id, onStoriesChange)}
              />
              <span>
                <span className="block text-sm font-semibold text-navy">{story.name}</span>
                <span className="text-xs text-ink-secondary">{story.assets.length} assets</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
