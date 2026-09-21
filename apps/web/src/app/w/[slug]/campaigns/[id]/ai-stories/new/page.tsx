"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EpisodeCreateForm, type EpisodeCreatePayload } from "@/components/ai-story/EpisodeCreateForm";
import { TapaoJomEpisodeUxFixture } from "@/components/ai-story/TapaoJomEpisodeUxFixture";
import { composeEpisodeOriginalIdea } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";

type AssetRow = { id: string; displayName?: string | null; originalFilename?: string | null };

export default function CreateAiStoryPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const slug = params.slug as string;
  const campaignId = params.id as string;
  const [assets, setAssets] = useState<AssetRow[]>([]);
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
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onGenerate(payload: EpisodeCreatePayload) {
    setError("");
    setLoading(true);
    try {
      const createRes = await fetch(`/api/campaigns/${campaignId}/ai-stories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: payload.title,
          originalIdea: composeEpisodeOriginalIdea({
            originalIdea: payload.originalIdea,
            episodeType: payload.episodeIntent.episodeType,
            durationSec: payload.episodeIntent.durationSec,
            customDurationSec: payload.episodeIntent.customDurationSec,
            aspectRatio: payload.episodeIntent.aspectRatio,
            language: payload.episodeIntent.language,
            dialogueStyle: payload.episodeIntent.dialogueStyle,
            nativeCharacterDialogue: payload.episodeIntent.nativeCharacterDialogue,
            pacing: payload.episodeIntent.pacing,
            cta: payload.episodeIntent.cta,
          }),
          outlineProfile: payload.outlineProfile,
          assetIds: payload.assetIds,
          productAssetIds: payload.productAssetIds,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error ?? "Create failed");
      const storyId = createData.story?.id as string;
      const genRes = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/generate`, { method: "POST" });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error ?? "Episode planning failed");
      router.push(`/w/${slug}/campaigns/${campaignId}/ai-stories/episodes/${storyId}`);
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
          <Link href={`/w/${slug}/campaigns/${campaignId}`} className="text-sm text-brand-blue hover:underline">← Back to Campaign</Link>
          <h1 className="mt-3 text-2xl font-bold text-navy">Create Episode</h1>
          <p className="mt-1 text-sm text-ink-secondary">Describe one Episode. EmberOS handles Scenes and shots internally.</p>
        </div>
        <EpisodeCreateForm campaignId={campaignId} assets={assets} loading={loading} error={error} onGenerate={(payload) => void onGenerate(payload)} />
        <TapaoJomEpisodeUxFixture />
      </div>
    </AppShell>
  );
}
