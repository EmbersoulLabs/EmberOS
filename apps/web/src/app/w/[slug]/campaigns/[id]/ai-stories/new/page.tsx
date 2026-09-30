"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { EpisodeCreateForm, type EpisodeCreatePayload } from "@/components/ai-story/EpisodeCreateForm";
import { TapaoJomEpisodeUxFixture } from "@/components/ai-story/TapaoJomEpisodeUxFixture";
import { composeEpisodeOriginalIdea } from "@ceo-agent/shared";
import type { ProductVariantCandidateEvidence } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";

type AssetRow = {
  id: string;
  displayName?: string | null;
  originalFilename?: string | null;
  contentHash?: string | null;
  variantCandidates?: readonly string[];
  variantCandidateEvidence?: readonly ProductVariantCandidateEvidence[];
  variantAnalysisState?: "MISSING" | "READY" | "INSUFFICIENT";
};

type LibraryAssetRow = AssetRow & {
  type?: string;
  status?: string;
};

export default function CreateAiStoryPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const slug = params.slug as string;
  const campaignId = params.id as string;
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAssetRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<AssetRow[]> => {
    const res = await fetch(`/api/campaigns/${campaignId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to load campaign");
      return [];
    }
    const nextAssets = data.assets ?? [];
    setAssets(nextAssets);
    if (typeof data.campaign?.workspaceId === "string") setWorkspaceId(data.campaign.workspaceId);
    else if (typeof data.workspaceId === "string") setWorkspaceId(data.workspaceId);
    return nextAssets;
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void fetch(`/api/workspaces/${workspaceId}/library?sort=newest`)
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (cancelled || !ok) return;
        setLibraryAssets((body.assets ?? []).filter((asset: LibraryAssetRow) => asset.status === "ready"));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [workspaceId]);

  async function attachLibraryAsset(assetId: string): Promise<AssetRow> {
    const response = await fetch(`/api/campaigns/${campaignId}/assets/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds: [assetId], storyIds: [] }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Asset could not be attached to this Campaign");
    const nextAssets = await load();
    const attached = nextAssets.find((asset) => asset.id === assetId);
    if (!attached) throw new Error("Attached Asset was not returned by the Campaign authority readback");
    return attached;
  }

  async function createEpisode(payload: EpisodeCreatePayload, startPlanning: boolean) {
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
          })
            + (payload.episodeIntent.worldRequirement ? `\nWorld setting: ${payload.episodeIntent.worldRequirement}.` : "")
            + (payload.offscreenSpeaker ? `\nOff-screen speaker: ${payload.offscreenSpeaker}. No visual reference.` : ""),
          outlineProfile: payload.outlineProfile,
          assetIds: payload.assetIds,
          productAssetIds: payload.productAssetIds,
          locationAssetIds: payload.locationAssetIds,
          brandAssetIds: payload.brandAssetIds,
          styleAssetIds: payload.styleAssetIds,
          genericAssetIds: payload.genericAssetIds,
          characterPortraitAssetIds: payload.characterPortraitAssetIds,
          productVariantSelections: payload.productVariantSelections,
          mappingConfirmed: payload.mappingConfirmed,
          episodeIntent: {
            episodeType: payload.episodeIntent.episodeType,
            requestedDurationSec: payload.episodeIntent.durationSec === "custom"
              ? payload.episodeIntent.customDurationSec ?? 45
              : payload.episodeIntent.durationSec,
            aspectRatio: payload.episodeIntent.aspectRatio,
            spokenLanguage: payload.episodeIntent.language,
            dialogueStyle: payload.episodeIntent.dialogueStyle,
            nativeCharacterDialogue: payload.episodeIntent.nativeCharacterDialogue,
            pacing: payload.episodeIntent.pacing,
            cta: payload.episodeIntent.cta?.trim() ? payload.episodeIntent.cta.trim() : null,
            visualTextLanguages: ["en", "ms", "zh-Hans"],
            visualTextPolicy: { criticalSurfacePolicy: "PROVIDER_NON_LEGIBLE" },
          },
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error ?? "Create failed");
      const storyId = createData.story?.id as string;
      if (payload.episodeIntent.reusableCharacterId) {
        const bindRes = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/character-bindings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reusableCharacterId: payload.episodeIntent.reusableCharacterId,
            episodeLook: { wardrobe: payload.episodeIntent.episodeLookWardrobe ?? null },
          }),
        });
        const bindData = await bindRes.json();
        if (!bindRes.ok) throw new Error(bindData.error ?? "Character binding failed");
      }
      if (startPlanning) {
        const genRes = await fetch(`/api/campaigns/${campaignId}/ai-stories/${storyId}/generate`, { method: "POST" });
        const genData = await genRes.json();
        if (!genRes.ok) throw new Error(genData.error ?? "Episode planning failed");
      }
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
        <EpisodeCreateForm
          campaignId={campaignId}
          workspaceId={workspaceId}
          assets={assets}
          libraryAssets={libraryAssets}
          loading={loading}
          error={error}
          onAssetsChange={setAssets}
          onAttachLibraryAsset={attachLibraryAsset}
          onSaveDraft={(payload) => void createEpisode(payload, false)}
          onGenerate={(payload) => void createEpisode(payload, true)}
        />
        <TapaoJomEpisodeUxFixture />
      </div>
    </AppShell>
  );
}
