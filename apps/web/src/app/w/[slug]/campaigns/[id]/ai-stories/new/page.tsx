"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { useI18n } from "@/lib/i18n/provider";

type AssetRow = { id: string; displayName?: string | null; originalFilename?: string | null };

export default function CreateAiStoryPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const slug = params.slug as string;
  const campaignId = params.id as string;

  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load campaign");
      return;
    }
    setAssets(data.assets ?? []);
    setSelectedAssetIds((data.assets ?? []).map((a: AssetRow) => a.id));
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate() {
    setError("");
    setLoading(true);
    try {
      const createRes = await fetch(`/api/campaigns/${campaignId}/ai-stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          originalIdea: idea.trim(),
          assetIds: selectedAssetIds,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error ?? "Create failed");

      const storyId = createData.story?.id as string;
      const genRes = await fetch(
        `/api/campaigns/${campaignId}/ai-stories/${storyId}/generate`,
        { method: "POST" }
      );
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error ?? "AI polish failed");

      router.push(`/w/${slug}/campaigns/${campaignId}/ai-stories/${storyId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Link
            href={`/w/${slug}/campaigns/${campaignId}`}
            className="text-sm text-brand-blue hover:underline"
          >
            ← Back to Campaign
          </Link>
          <h1 className="mt-3 text-2xl font-bold text-navy">Create Story</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Describe your story idea in plain language. EmberOS will polish it into a structured Story Draft.
          </p>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-navy">Title</span>
          <input
            className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Spring launch story"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-navy">Story idea</span>
          <textarea
            className="min-h-[160px] w-full rounded-lg border border-border px-3 py-2 text-sm"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="A customer discovers our product and shares how it changed their routine..."
          />
        </label>

        {assets.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-navy">Campaign assets (optional)</p>
            <ul className="space-y-2">
              {assets.map((asset) => (
                <li key={asset.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedAssetIds.includes(asset.id)}
                    onChange={(e) => {
                      setSelectedAssetIds((prev) =>
                        e.target.checked
                          ? [...prev, asset.id]
                          : prev.filter((id) => id !== asset.id)
                      );
                    }}
                  />
                  <span>{asset.displayName ?? asset.originalFilename ?? asset.id.slice(0, 8)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-amber-700">
            No Campaign assets attached — Story polish will proceed with warnings only.
          </p>
        )}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          disabled={loading || !title.trim() || !idea.trim()}
          onClick={() => void onCreate()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loading ? "Polishing…" : "Create & Polish Story"}
        </button>
      </div>
    </AppShell>
  );
}
