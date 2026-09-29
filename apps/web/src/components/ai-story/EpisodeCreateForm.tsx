"use client";

import { useEffect, useState } from "react";
import {
  AI_STORY_AUDIO_LOCALES,
  AI_STORY_EPISODE_ASPECT_RATIOS,
  AI_STORY_EPISODE_COPY,
  AI_STORY_EPISODE_DURATIONS_SEC,
  AI_STORY_EPISODE_PACING,
  AI_STORY_EPISODE_USER_TYPES,
  AI_STORY_REUSABLE_CHARACTER_COPY,
  compileAiStoryIntakeAuthority,
  formatEpisodeLiveCostEstimateUsd,
  mapEpisodeTypeToOutlineProfile,
  type AiStoryEpisodeUserType,
  type AiStoryReusableCharacterCard,
} from "@ceo-agent/shared";

import { CharacterPortrait } from "@/components/ai-story/CharacterPortrait";
import { uploadLibraryFile } from "@/lib/library-upload";

type AssetRow = {
  id: string;
  displayName?: string | null;
  originalFilename?: string | null;
  metadata?: { variant?: unknown; productVariant?: unknown } | null;
};

function assetLabel(asset: AssetRow): string {
  return asset.displayName ?? asset.originalFilename ?? asset.id.slice(0, 8);
}

function assetVariant(asset: AssetRow): string | null {
  const value = asset.metadata?.variant ?? asset.metadata?.productVariant;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type EpisodeCreatePayload = {
  title: string;
  originalIdea: string;
  outlineProfile: ReturnType<typeof mapEpisodeTypeToOutlineProfile>;
  assetIds: string[];
  productAssetIds: string[];
  locationAssetIds: string[];
  brandAssetIds: string[];
  styleAssetIds: string[];
  genericAssetIds: string[];
  characterPortraitAssetIds: string[];
  mappingConfirmed: true;
  offscreenSpeaker?: string;
  episodeIntent: {
    episodeType: AiStoryEpisodeUserType;
    durationSec: number | "custom";
    customDurationSec?: number;
    aspectRatio: (typeof AI_STORY_EPISODE_ASPECT_RATIOS)[number];
    language: (typeof AI_STORY_AUDIO_LOCALES)[number];
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
  workspaceId?: string;
  assets: AssetRow[];
  onAssetsChange?: (assets: AssetRow[]) => void;
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
  workspaceId,
  assets,
  loading,
  error,
  onGenerate,
  onAssetsChange,
}: Props) {
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [episodeType, setEpisodeType] = useState<AiStoryEpisodeUserType>("FOOD_STORY");
  const [durationSec, setDurationSec] = useState<number | "custom">(45);
  const [customDurationSec, setCustomDurationSec] = useState(45);
  const [aspectRatio, setAspectRatio] =
    useState<(typeof AI_STORY_EPISODE_ASPECT_RATIOS)[number]>("9:16");
  const [language, setLanguage] = useState<(typeof AI_STORY_AUDIO_LOCALES)[number]>("zh-MY");
  const [dialogueStyle, setDialogueStyle] = useState("Malaysian Chinese conversational");
  const [nativeDialogue, setNativeDialogue] = useState(true);
  const [pacing, setPacing] = useState<(typeof AI_STORY_EPISODE_PACING)[number]>("NATURAL");
  const [cta, setCta] = useState("");
  const [characters, setCharacters] = useState<AiStoryReusableCharacterCard[]>([]);
  const [reusableCharacterId, setReusableCharacterId] = useState<string | "new">("new");
  const [episodeLookWardrobe, setEpisodeLookWardrobe] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [productAssetIds, setProductAssetIds] = useState<string[]>([]);
  const [locationAssetIds, setLocationAssetIds] = useState<string[]>([]);
  const [brandAssetIds, setBrandAssetIds] = useState<string[]>([]);
  const [styleAssetIds, setStyleAssetIds] = useState<string[]>([]);
  const [genericAssetIds, setGenericAssetIds] = useState<string[]>([]);
  const [offscreenSpeaker, setOffscreenSpeaker] = useState("");
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [liveCostLabel, setLiveCostLabel] = useState<string | null>(null);
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
  const ready = title.trim().length > 0 && idea.trim().length > 0 && mappingConfirmed;
  const selectedCharacter = characters.find((character) => character.reusableCharacterId === reusableCharacterId) ?? null;
  const portraitAssetId = selectedCharacter?.portraitAssetId ?? null;
  const authority = compileAiStoryIntakeAuthority({
    selection: {
      assetIds: selectedAssetIds,
      productAssetIds,
      locationAssetIds,
      brandAssetIds,
      styleAssetIds,
      genericAssetIds,
      characterPortraitAssetIds: portraitAssetId ? [portraitAssetId] : [],
      mappingConfirmed,
    },
    assets: assets.map((asset) => ({
      assetId: asset.id,
      label: assetLabel(asset),
      variant: assetVariant(asset),
    })),
    character: selectedCharacter
      ? {
          name: selectedCharacter.name,
          characterId: selectedCharacter.reusableCharacterId,
          characterVersionId: null,
          portraitAssetId,
        }
      : null,
    offscreenSpeaker,
  });

  function assignRole(assetId: string, role: "product_source" | "location_reference" | "brand_reference" | "style_reference" | "generic_reference", enabled: boolean) {
    const lists = {
      product_source: setProductAssetIds,
      location_reference: setLocationAssetIds,
      brand_reference: setBrandAssetIds,
      style_reference: setStyleAssetIds,
      generic_reference: setGenericAssetIds,
    };
    for (const update of Object.values(lists)) {
      update((current) => current.filter((id) => id !== assetId));
    }
    setSelectedAssetIds((current) => enabled
      ? current.includes(assetId) ? current : [...current, assetId]
      : current.filter((id) => id !== assetId));
    if (enabled) lists[role]((current) => current.includes(assetId) ? current : [...current, assetId]);
    setMappingConfirmed(false);
  }

  async function uploadInto(role: "product_source" | "location_reference" | "brand_reference" | "style_reference" | "generic_reference", file: File | undefined) {
    if (!file || !workspaceId) return;
    const uploaded = await uploadLibraryFile(workspaceId, file) as AssetRow;
    onAssetsChange?.([...assets.filter((asset) => asset.id !== uploaded.id), uploaded]);
    assignRole(uploaded.id, role, true);
  }

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
          assetIds: authority.bindings.map((binding) => binding.assetId),
          productAssetIds: authority.products.map((item) => item.assetId),
          locationAssetIds: authority.locations.map((item) => item.assetId),
          brandAssetIds: authority.other.filter((item) => item.role === "brand_reference").map((item) => item.assetId),
          styleAssetIds: authority.other.filter((item) => item.role === "style_reference").map((item) => item.assetId),
          genericAssetIds: authority.other.filter((item) => item.role === "generic_reference").map((item) => item.assetId),
          characterPortraitAssetIds: portraitAssetId ? [portraitAssetId] : [],
          mappingConfirmed: true,
          offscreenSpeaker: offscreenSpeaker.trim() || undefined,
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
          <select className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={language} onChange={(event) => setLanguage(event.target.value as (typeof AI_STORY_AUDIO_LOCALES)[number])}>
            {AI_STORY_AUDIO_LOCALES.map((locale) => <option key={locale} value={locale}>{locale}</option>)}
          </select>
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
          <label key={character.reusableCharacterId} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm" data-testid="episode-character-option">
            <input type="radio" name="reusableCharacter" checked={reusableCharacterId === character.reusableCharacterId} onChange={() => setReusableCharacterId(character.reusableCharacterId)} />
            {workspaceId ? <CharacterPortrait workspaceId={workspaceId} assetId={character.portraitAssetId} label={character.name} className="h-14 w-14 rounded-md object-cover" /> : null}
            <span>
              <span className="block font-medium">{character.name}</span>
              <span className="text-xs text-ink-secondary">{AI_STORY_REUSABLE_CHARACTER_COPY.usedInEpisodes(character.episodeCount)}</span>
            </span>
          </label>
        ))}
        {reusableCharacterId !== "new" ? (
          <div className="rounded-lg bg-surface-muted p-3 text-sm" data-testid="episode-identity-locked">
            <p className="font-medium text-navy">{AI_STORY_REUSABLE_CHARACTER_COPY.identityLocked} ✓</p>
            {characters.find((character) => character.reusableCharacterId === reusableCharacterId)?.characterDnaCertified ? (
              <p className="mt-1 text-xs text-ink-secondary">{AI_STORY_REUSABLE_CHARACTER_COPY.characterDnaCertified}</p>
            ) : null}
            <p className="mt-1 text-xs text-ink-secondary">{AI_STORY_REUSABLE_CHARACTER_COPY.consistencySoft}</p>
            <label className="mt-2 block space-y-1">
              <span>Outfit</span>
              <input data-testid="episode-look-outfit" className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={episodeLookWardrobe} onChange={(event) => setEpisodeLookWardrobe(event.target.value)} placeholder="White dress or blue jacket" />
            </label>
          </div>
        ) : null}
      </fieldset>

      <AssetSlot title="Product" role="product_source" assets={assets} selected={productAssetIds} onAssign={assignRole} onUpload={(file) => void uploadInto("product_source", file)} />
      <AssetSlot title="Location" role="location_reference" assets={assets} selected={locationAssetIds} onAssign={assignRole} onUpload={(file) => void uploadInto("location_reference", file)} />
      <AssetSlot title="Brand" role="brand_reference" assets={assets} selected={brandAssetIds} onAssign={assignRole} onUpload={(file) => void uploadInto("brand_reference", file)} />
      <AssetSlot title="Style" role="style_reference" assets={assets} selected={styleAssetIds} onAssign={assignRole} onUpload={(file) => void uploadInto("style_reference", file)} />
      <AssetSlot title="Other references" role="generic_reference" assets={assets} selected={genericAssetIds} onAssign={assignRole} onUpload={(file) => void uploadInto("generic_reference", file)} />

      <label className="block space-y-1">
        <span className="text-sm font-medium text-navy">Off-screen speaker <span className="font-normal text-ink-secondary">(optional, no visual reference)</span></span>
        <input className="w-full rounded-lg border border-border px-3 py-2 text-sm" value={offscreenSpeaker} onChange={(event) => { setOffscreenSpeaker(event.target.value); setMappingConfirmed(false); }} placeholder="Boss" />
      </label>

      <section className="space-y-3 rounded-xl border border-border p-4" data-testid="episode-authority-preview">
        <h2 className="text-sm font-semibold text-navy">EmberOS understood</h2>
        <p className="text-xs text-ink-secondary">This preview is the authority that will be saved. Unresolved items stay unresolved.</p>
        <dl className="space-y-2 text-sm">
          <div><dt className="font-medium text-navy">Main character</dt><dd>{authority.character ? `${authority.character.name} — identity locked` : "None selected"}</dd></div>
          <div><dt className="font-medium text-navy">Product</dt><dd>{authority.products.length ? authority.products.map((item) => `${item.label}${item.variant ? ` — variant ${item.variant}` : " — variant unresolved"}`).join("; ") : "None"}</dd></div>
          <div><dt className="font-medium text-navy">Location</dt><dd>{authority.locations.length ? authority.locations.map((item) => item.label).join("; ") : "None"}</dd></div>
          <div><dt className="font-medium text-navy">Off-screen speaker</dt><dd>{authority.offscreenSpeaker ? `${authority.offscreenSpeaker.name} — no visual reference` : "None declared"}</dd></div>
          <div><dt className="font-medium text-navy">Other references</dt><dd>{authority.other.length ? authority.other.map((item) => `${item.label} (${item.role})`).join("; ") : "None"}</dd></div>
        </dl>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mappingConfirmed} onChange={(event) => setMappingConfirmed(event.target.checked)} />
          Confirm this mapping
        </label>
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

function AssetSlot({
  title,
  role,
  assets,
  selected,
  onAssign,
  onUpload,
}: {
  title: string;
  role: "product_source" | "location_reference" | "brand_reference" | "style_reference" | "generic_reference";
  assets: AssetRow[];
  selected: string[];
  onAssign: (assetId: string, role: "product_source" | "location_reference" | "brand_reference" | "style_reference" | "generic_reference", enabled: boolean) => void;
  onUpload: (file: File | undefined) => void;
}) {
  return (
    <section className="space-y-2 rounded-xl border border-border p-4" data-testid={`episode-slot-${role}`}>
      <h2 className="text-sm font-semibold text-navy">{title}</h2>
      <p className="text-xs text-ink-secondary">Nothing in this slot is selected until you choose it.</p>
      {assets.length ? (
        <ul className="space-y-1">
          {assets.map((asset) => (
            <li key={asset.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.includes(asset.id)} onChange={(event) => onAssign(asset.id, role, event.target.checked)} />
                {assetLabel(asset)}
              </label>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-ink-secondary">No library assets are attached to this Campaign yet.</p>}
      <label className="block text-xs font-medium text-navy">
        Upload into this slot
        <input className="mt-1 block text-sm" type="file" onChange={(event) => onUpload(event.target.files?.[0])} />
      </label>
    </section>
  );
}
