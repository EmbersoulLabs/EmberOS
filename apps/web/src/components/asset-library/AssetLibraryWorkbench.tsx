"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatFileSize, resolveAssetDisplayLabel } from "@ceo-agent/shared";
import { uploadLibraryFile, type LibraryUploadPhase } from "@/lib/library-upload";
import { AssetLibraryPreview } from "./AssetLibraryPreview";

type Asset = { id: string; type: string; displayName: string | null; originalFilename: string | null; mimeType: string | null; fileSizeBytes: number | null; status: string; createdAt: string };
type Story = { id: string; name: string; description: string | null; status: "draft" | "ready" | "archived"; coverAssetId: string | null; version: number; assets: Array<Asset & { sortOrder: number }> };

export function AssetLibraryWorkbench({ workspaceId }: { workspaceId: string }) {
  const uploadInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"assets" | "stories">("assets");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("newest");
  const [busy, setBusy] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<LibraryUploadPhase | null>(null);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<Story | "new" | null>(null);
  const [storyName, setStoryName] = useState("");
  const [storyDescription, setStoryDescription] = useState("");
  const [storyStatus, setStoryStatus] = useState<Story["status"]>("draft");
  const [storyAssetIds, setStoryAssetIds] = useState<string[]>([]);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ sort });
      if (query.trim()) params.set("q", query.trim());
      if (type) params.set("type", type);
      const [assetResponse, storyResponse] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/library?${params}`),
        fetch(`/api/workspaces/${workspaceId}/stories?includeArchived=1&q=${encodeURIComponent(query.trim())}`),
      ]);
      const [assetData, storyData] = await Promise.all([assetResponse.json(), storyResponse.json()]);
      if (!assetResponse.ok) throw new Error(assetData.error ?? "Asset list failed");
      if (!storyResponse.ok) throw new Error(storyData.error ?? "Asset Story list failed");
      setAssets(assetData.assets ?? []); setStories(storyData.stories ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load Asset Library"); }
    finally { setBusy(false); }
  }, [query, sort, type, workspaceId]);
  useEffect(() => { void reload(); }, [reload]);

  const orderedStoryAssets = useMemo(() => storyAssetIds.map((id) => assets.find((asset) => asset.id === id)).filter((asset): asset is Asset => Boolean(asset)), [assets, storyAssetIds]);
  function beginStory(story?: Story) {
    setEditor(story ?? "new"); setTab("stories"); setStoryName(story?.name ?? ""); setStoryDescription(story?.description ?? "");
    setStoryStatus(story?.status ?? "draft"); setStoryAssetIds(story?.assets.map((asset) => asset.id) ?? []); setCoverAssetId(story?.coverAssetId ?? null);
  }
  function toggleStoryAsset(id: string) {
    setStoryAssetIds((current) => current.includes(id) ? current.filter((assetId) => assetId !== id) : [...current, id]);
    if (coverAssetId === id) setCoverAssetId(null);
  }
  function moveAsset(index: number, delta: number) {
    const next = [...storyAssetIds]; const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]]; setStoryAssetIds(next);
  }
  async function saveStory() {
    if (!storyName.trim()) return;
    setBusy(true); setError("");
    try {
      const existing = editor === "new" ? null : editor;
      const response = await fetch(`/api/workspaces/${workspaceId}/stories${existing ? `/${existing.id}` : ""}`, {
        method: existing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: storyName.trim(), description: storyDescription.trim(), status: storyStatus, assetIds: storyAssetIds, coverAssetId, ...(existing ? { expectedVersion: existing.version } : {}) }),
      });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Asset Story save failed");
      setEditor(null); await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Asset Story save failed"); }
    finally { setBusy(false); }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError("");
    try { for (const file of Array.from(files)) await uploadLibraryFile(workspaceId, file, setUploadPhase); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed"); }
    finally { setBusy(false); setUploadPhase(null); if (uploadInput.current) uploadInput.current.value = ""; }
  }
  async function rename(asset: Asset) {
    const displayName = window.prompt("Asset name", resolveAssetDisplayLabel(asset)); if (!displayName?.trim()) return;
    const response = await fetch(`/api/workspaces/${workspaceId}/library/${asset.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName }) });
    if (!response.ok) setError((await response.json()).error ?? "Rename failed"); else await reload();
  }
  async function download(asset: Asset) {
    const response = await fetch(`/api/workspaces/${workspaceId}/library/${asset.id}/download-url`); const body = await response.json();
    if (!response.ok) setError(body.error ?? "Download failed"); else window.open(body.downloadUrl, "_blank", "noopener,noreferrer");
  }

  return <section aria-label="Workspace Asset Library" className="space-y-4">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl font-bold text-navy">Asset Library</h1><p className="text-sm text-ink-secondary">Workspace-owned private media and reusable Asset Stories.</p></div><div className="flex gap-2"><button className="rounded-lg border border-border px-4 py-2 text-sm font-semibold" onClick={() => beginStory()}>New Asset Story</button><button className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white" onClick={() => uploadInput.current?.click()}>Upload</button><input ref={uploadInput} className="hidden" type="file" multiple accept="image/*,video/*,audio/*,application/pdf" onChange={(event) => void upload(event.target.files)} /></div></header>
    {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {uploadPhase ? <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">Upload: {uploadPhase}</p> : null}
    <div className="flex gap-2 border-b border-border"><button className={`px-3 py-2 text-sm font-semibold ${tab === "assets" ? "border-b-2 border-navy" : ""}`} onClick={() => setTab("assets")}>Assets</button><button className={`px-3 py-2 text-sm font-semibold ${tab === "stories" ? "border-b-2 border-navy" : ""}`} onClick={() => setTab("stories")}>Asset Stories</button></div>
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]"><input aria-label="Search assets" className="rounded-lg border border-border px-3 py-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" /><select aria-label="Asset type" className="rounded-lg border border-border px-3 py-2" value={type} onChange={(event) => setType(event.target.value)}><option value="">All types</option><option>image</option><option>video</option><option>audio</option><option>pdf</option></select><select aria-label="Sort assets" className="rounded-lg border border-border px-3 py-2" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest</option><option value="name">Name</option><option value="size">Size</option></select><button className="rounded-lg border border-border px-3 py-2" onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? "List" : "Grid"}</button></div>
    {busy ? <p className="text-sm text-ink-secondary">Loading…</p> : null}
    {tab === "assets" ? <div className={view === "grid" ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" : "space-y-2"}>{assets.map((asset) => <article key={asset.id} className={`overflow-hidden rounded-xl border border-border bg-white ${view === "list" ? "flex items-center gap-3 p-3" : ""}`}><AssetLibraryPreview workspaceId={workspaceId} asset={asset} className={view === "list" ? "h-16 w-20" : "h-36 w-full"} /><div className="min-w-0 flex-1 p-3"><p className="truncate font-semibold text-navy">{resolveAssetDisplayLabel(asset)}</p><p className="text-xs text-ink-secondary">{asset.type} · {formatFileSize(asset.fileSizeBytes)}</p><div className="mt-2 flex gap-2"><button className="text-xs font-semibold text-brand-blue" onClick={() => void rename(asset)}>Rename</button><button className="text-xs font-semibold text-brand-blue" onClick={() => void download(asset)}>Private download</button></div></div></article>)}</div> : null}
    {tab === "stories" ? <div className="grid gap-3 lg:grid-cols-2">{stories.map((story) => <article key={story.id} className="rounded-xl border border-border bg-white p-4"><div className="flex justify-between gap-3"><div><h2 className="font-bold text-navy">{story.name}</h2><p className="text-xs text-ink-secondary">{story.assets.length} assets · {story.status} · v{story.version}</p></div><button className="text-sm font-semibold text-brand-blue" onClick={() => beginStory(story)}>Edit</button></div><p className="mt-2 text-sm text-ink-secondary">{story.description}</p></article>)}</div> : null}
    {editor ? <div className="rounded-xl border border-border bg-white p-4"><h2 className="text-lg font-bold text-navy">{editor === "new" ? "Create Asset Story" : "Edit Asset Story"}</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><input className="rounded-lg border border-border px-3 py-2" placeholder="Title" value={storyName} onChange={(event) => setStoryName(event.target.value)} /><select className="rounded-lg border border-border px-3 py-2" value={storyStatus} onChange={(event) => setStoryStatus(event.target.value as Story["status"])}><option value="draft">Draft</option><option value="ready">Ready</option><option value="archived">Archived</option></select><textarea className="rounded-lg border border-border px-3 py-2 sm:col-span-2" placeholder="Context" value={storyDescription} onChange={(event) => setStoryDescription(event.target.value)} /></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{assets.map((asset) => <label key={asset.id} className="flex items-center gap-2 rounded-lg border border-border p-2"><input type="checkbox" checked={storyAssetIds.includes(asset.id)} onChange={() => toggleStoryAsset(asset.id)} /><span className="truncate text-sm">{resolveAssetDisplayLabel(asset)}</span></label>)}</div><ol className="mt-4 space-y-2">{orderedStoryAssets.map((asset, index) => <li key={asset.id} className="flex items-center gap-2 rounded-lg bg-surface-muted p-2"><input aria-label={`Cover ${resolveAssetDisplayLabel(asset)}`} type="radio" checked={coverAssetId === asset.id} onChange={() => setCoverAssetId(asset.id)} /><span className="min-w-0 flex-1 truncate text-sm">{index + 1}. {resolveAssetDisplayLabel(asset)}</span><button onClick={() => moveAsset(index, -1)} aria-label="Move up">↑</button><button onClick={() => moveAsset(index, 1)} aria-label="Move down">↓</button></li>)}</ol><div className="mt-4 flex gap-2"><button disabled={busy} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white" onClick={() => void saveStory()}>Save</button><button className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setEditor(null)}>Cancel</button></div></div> : null}
  </section>;
}

