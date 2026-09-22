"use client";

import { useEffect, useState } from "react";
import {
  AI_STORY_EPISODE_ASPECT_RATIOS,
  AI_STORY_EPISODE_COPY,
  AI_STORY_EPISODE_DURATIONS_SEC,
  AI_STORY_EPISODE_PACING,
  AI_STORY_EPISODE_USER_TYPES,
  AI_STORY_REUSABLE_CHARACTER_COPY,
  formatEpisodeLiveCostEstimateUsd,
  mapEpisodeTypeToOutlineProfile,
  type AiStoryEpisodeUserType,
  type AiStoryReusableCharacterCard,
} from "@ceo-agent/shared";

type AssetRow = { id: string; displayName?: string | null; originalFilename?: string | null };

export type EpisodeCreatePayload = {
  title: string;
  originalIdea: string;
  outlineProfile: ReturnType<typeof mapEpisodeTypeToOutlineProfile>;
  assetIds: string[];
  productAssetIds: string[];
  episodeIntent: {
    episodeType: AiStoryEpisodeUserType;
    durationSec: number | "custom";
    customDurationSec?: number;
    aspectRatio: (typeof AI_STORY_EPISODE_ASPECT_RATIOS)[number];
    language: string;
    dialogueStyle: string;
    nativeCharacterDialogue: boolean;
    pacing: (typeof AI_STORY_EPISODE_PACING)[number];
    cta?: string;
    reusableCharacterId?: string | null;
    episodeLookWardrobe?: string;
  };
};

type Props = {
  campaignId: string;
  assets: AssetRow[];
  loading: boolean;
  error: string;
  onGenerate: (payload: EpisodeCreatePayload) => void;
};

const TYPE_LABELS: Record<AiStoryEpisodeUserType, string> = {
  COMMERCIAL_STORY: "Commercial Story",
  PRODUCT_STORY: "Product Story",
  BRAND_STORY: "Brand Story",
  SERVICE_STORY: "Service Story",
  FOOD_STORY: "Food Story",
  EMOTIONAL_STORY: "Emotional Story",
  ENTERTAINMENT_STORY: "Entertainment Story",
};

export function EpisodeCreateForm({
  campaignId,
  assets,
  loading,
  error,
  onGenerate,
}: Props) {
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [episodeType, setEpisodeType] = useState<AiStoryEpisodeUserType>("FOOD_STORY");
  const [durationSec, setDurationSec] = useState<number | "custom">(45);
  const [customDurationSec, setCustomDurationSec] = useState(45);
  const [aspectRatio, setAspectRatio] =
    useState<(typeof AI_STORY_EPISODE_ASPECT_RATIOS)[number]>("9:16");
  const [language, setLanguage] = useState("zh-MY");
  const [dialogueStyle, setDialogueStyle] = useState("Malaysian Chinese conversational");
  const [nativeDialogue, setNativeDialogue] = useState(true);
  const [pacing, setPacing] = useState<(typeof AI_STORY_EPISODE_PACING)[number]>("NATURAL");
  const [cta, setCta] = useState("");
  const [characters, setCharacters] = useState<AiStoryReusableCharacterCard[]>([]);
  const [reusableCharacterId, setReusableCharacterId] = useState<string | "new">("new");
  const [episodeLookWardrobe, setEpisodeLookWardrobe] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(() =>
    assets.map((asset) => asset.id)
  );
  const [productAssetIds, setProductAssetIds] = useState<string[]>([]);
  const [locationAssetIds, setLocationAssetIds] = useState<string[]>([]);
  const [liveCostLabel, setLiveCostLabel] = useState<string | null>(null);
  useEffect(() => {
    setSelectedAssetIds(assets.map((asset) => asset.id));
  }, [assets]);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/campaigns/${campaignId}/reusable-characters`)
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (cancelled || !ok) return;
        setCharacters(body.characters ?? []);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [campaignId]);
  useEffect(() => {
    const seconds = durationSec === "custom" ? customDurationSec : durationSec;
    const unitCount = 6;
    const durationSeconds = Math.max(4, Math.round(seconds / unitCount));
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/campaigns/${campaignId}/episode-cost-estimates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitCount,
          durationSeconds,
          aspectRatio,
          resolution: "480p",
          nativeAudio: nativeDialogue,
        }),
      });
      const data = await res.json() as {
        estimate?: { currency: string; estimatedExpected: string; estimatedMin: string; estimatedMax: string };
      };
      if (cancelled || !res.ok || !data.estimate) return;
      setLiveCostLabel(formatEpisodeLiveCostEstimateUsd(data.estimate));
    })();
    return () => {
      cancelled = true;
    };
  }, [aspectRatio, campaignId, customDurationSec, durationSec, nativeDialogue]);
  const ready = title.trim().length > 0 && idea.trim().length > 0;

  return (
    <form
      className="space-y-6"
      data-testid="episode-create-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || loading) return;
        onGenerate({
          title: title.trim(),
          originalIdea: idea.trim(),
          outlineProfile: mapEpisodeTypeToOutlineProfile(episodeType),
          assetIds: selectedAssetIds,
          productAssetIds,
          episodeIntent: {
            episodeType,
            durationSec: durationSec === "custom" ? "custom" : durationSec,
            customDurationSec: durationSec === "custom" ? customDurationSec : undefined,
            aspectRatio,
            language,
            dialogueStyle,
            nativeCharacterDialogue: nativeDialogue,
            pacing,
            cta: cta.trim() || undefined,
            reusableCharacterId: reusableCharacterId === "new" ? null : reusableCharacterId,
            episodeLookWardrobe: reusableCharacterId === "new" ? undefined : episodeLookWardrobe.trim() || undefined,
          },
        });
      }}
    >
      <input type="hidden" name="outlineProfile" value={mapEpisodeTypeToOutlineProfile(episodeType).profileId} />
      <label className="block space-y-1">
        <span className="text-sm font-medium text-navy">Title</span>
        <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tapao Jom by AWH Food Enterprise" />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-navy">Story / Idea</span>
        <textarea className="min-h-[140px] w-full rounded-lg border border-border px-3 py-2 text-sm" value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="A casual host notices a local takeaway shop and shows what you can tapao." />
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-navy">Episode Type</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {AI_STORY_EPISODE_USER_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
              <input type="radio" name="episodeType" checked={episodeType === type} onChange={() => setEpisodeType(type)} />
              {TYPE_LABELS[type]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-navy">Duration</legend>
          <div className="flex flex-wrap gap-2">
            {AI_STORY_EPISODE_DURATIONS_SEC.map((value) => (
              <label key={value} className="rounded-full border border-border px-3 py-1.5 text-sm">
                <input className="mr-2" type="radio" name="duration" checked={durationSec === value} onChange={() => setDurationSec(value)} />
                {value}s
              </label>
            ))}
            <label className="rounded-full border border-border px-3 py-1.5 text-sm">
              <input className="mr-2" type="radio" name="duration" checked={durationSec === "custom"} onChange={() => setDurationSec("custom")} />
              Custom
            </label>
          </div>
          {durationSec === "custom" ? (
            <input type="number" min={8} max={90} className="w-32 rounded-lg border border-border px-3 py-2 text-sm" value={customDurationSec} onChange={(event) => setCustomDurationSec(Number(event.target.value))} />
          ) : null}
        </fieldset>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-navy">Aspect Ratio</span>
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as (typeof AI_STORY_EPISODE_ASPECT_RATIOS)[number])}>
            {AI_STORY_EPISODE_ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>{ratio}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-navy">Language / Locale</span>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={language} onChange={(event) => setLanguage(event.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-navy">Dialogue Style</span>
          <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={dialogueStyle} onChange={(event) => setDialogueStyle(event.target.value)} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={nativeDialogue} onChange={(event) => setNativeDialogue(event.target.checked)} />
        Native Character Dialogue
      </label>

      <fieldset className="space-y-2" data-testid="episode-character-selector">
        <legend className="text-sm font-medium text-navy">{AI_STORY_REUSABLE_CHARACTER_COPY.characters}</legend>
        <label className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
          <input type="radio" name="reusableCharacter" checked={reusableCharacterId === "new"} onChange={() => setReusableCharacterId("new")} />
          {AI_STORY_REUSABLE_CHARACTER_COPY.createNewCharacter}
        </label>
        {characters.map((character) => (
          <label key={character.reusableCharacterId} className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
            <input type="radio" name="reusableCharacter" checked={reusableCharacterId === character.reusableCharacterId} onChange={() => setReusableCharacterId(character.reusableCharacterId)} />
            {character.name}
            <span className="text-xs text-ink-secondary">{AI_STORY_REUSABLE_CHARACTER_COPY.usedInEpisodes(character.episodeCount)}</span>
          </label>
        ))}
        {reusableCharacterId !== "new" ? (
          <div className="rounded-lg bg-surface-muted p-3 text-sm">
            <p className="font-medium text-navy">{AI_STORY_REUSABLE_CHARACTER_COPY.identityLocked} ✓</p>
            <label className="mt-2 block space-y-1">
              <span>Outfit</span>
              <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={episodeLookWardrobe} onChange={(event) => setEpisodeLookWardrobe(event.target.value)} placeholder="White dress or blue jacket" />
            </label>
          </div>
        ) : null}
      </fieldset>

      <section className="space-y-3 rounded-xl border border-border p-4" data-testid="episode-references">
        <h2 className="text-sm font-semibold text-navy">References</h2>
        <p className="text-xs text-ink-secondary">Add characters, products, store / location, brand / logo, and visual references. EmberOS decides how they appear across the Episode.</p>
        {assets.length ? (
          <ul className="space-y-2">
            {assets.map((asset) => {
              const included = selectedAssetIds.includes(asset.id);
              return (
                <li key={asset.id} className="space-y-1 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={included} onChange={(event) => {
                      setSelectedAssetIds((prev) => {
                        const next = event.target.checked ? [...prev, asset.id] : prev.filter((id) => id !== asset.id);
                        if (next.length === 0) setProductAssetIds([]);
                        return next;
                      });
                      if (!event.target.checked) {
                        setProductAssetIds((prev) => prev.filter((id) => id !== asset.id));
                        setLocationAssetIds((prev) => prev.filter((id) => id !== asset.id));
                      }
                    }} />
                    {asset.displayName ?? asset.originalFilename ?? asset.id.slice(0, 8)}
                  </label>
                  <div className="ml-6 flex flex-wrap gap-3 text-xs text-ink-secondary">
                    <label className="flex items-center gap-1"><input type="checkbox" disabled={!included} checked={included && productAssetIds.includes(asset.id)} onChange={(event) => setProductAssetIds((prev) => event.target.checked ? [...prev, asset.id] : prev.filter((id) => id !== asset.id))} /> This is a Product</label>
                    <label className="flex items-center gap-1"><input type="checkbox" disabled={!included} checked={included && locationAssetIds.includes(asset.id)} onChange={(event) => setLocationAssetIds((prev) => event.target.checked ? [...prev, asset.id] : prev.filter((id) => id !== asset.id))} /> Store / location</label>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-amber-700">No references attached yet. You can still describe the Episode.</p>
        )}
      </section>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-navy">Optional CTA</span>
        <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={cta} onChange={(event) => setCta(event.target.value)} placeholder="Come in and have a look" />
      </label>

      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer text-sm font-semibold text-navy">Advanced options</summary>
        <div className="mt-3 space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-navy">Pacing</legend>
            {AI_STORY_EPISODE_PACING.map((value) => (
              <label key={value} className="mr-4 text-sm">
                <input className="mr-1" type="radio" name="pacing" checked={pacing === value} onChange={() => setPacing(value)} />
                {value === "RELAXED" ? "Relaxed" : value === "FAST" ? "Fast" : "Natural"}
              </label>
            ))}
          </fieldset>
        </div>
      </details>

      <div className="rounded-xl border border-border bg-surface-muted/50 p-4 text-sm" data-testid="episode-cost-estimate">
        <p className="font-medium text-navy">{AI_STORY_EPISODE_COPY.estimatedCost}</p>
        <p className="mt-1 text-ink-secondary">
          {liveCostLabel ?? "Calculating live Episode cost from the certified Provider rate…"}
        </p>
        <p className="mt-1 text-xs text-ink-secondary">{AI_STORY_EPISODE_COPY.costConfirmationRequired}</p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button type="submit" disabled={loading || !ready} className="min-h-11 w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60 sm:w-auto">
        {loading ? "Planning your episode…" : AI_STORY_EPISODE_COPY.generateEpisode}
      </button>
    </form>
  );
}
