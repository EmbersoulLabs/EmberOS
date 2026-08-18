"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardSection } from "@/components/marketing-dashboard/primitives";
import {
  PHOTO_SCENE_OUTPUT_PRESETS,
  PHOTO_SCENE_OUTPUT_PRESET_PIXELS,
  computeProductPlacementNormalized,
  type PhotoSceneOutputPresetId,
  type PhotoScenePlacementV1,
} from "@ceo-agent/shared";

type SceneDto = {
  sceneId: string;
  slug: string;
  name: string;
  category: string;
  version: number;
  supportedPresets: PhotoSceneOutputPresetId[];
  previewUrl: string | null;
  sceneContentHash: string;
  safeArea: { x: number; y: number; width: number; height: number };
  productAnchor: string;
  scaleRange: { min: number; max: number; defaultScale: number };
  defaultOffsetX: number;
  defaultOffsetY: number;
  defaultShadowPreset: string;
};

type ExtractionDto = {
  id: string;
  status: string;
  outputAssetId: string | null;
  previewUrl?: string;
};

type SelectionDto = {
  frozen?: {
    sceneId: string;
    sceneVersion: number;
    sceneContentHash: string;
    presetId: PhotoSceneOutputPresetId;
    placement: {
      offsetX: number;
      offsetY: number;
      scale: number;
      shadowPreset: string;
    };
  };
  scene?: SceneDto;
};

export function PhotoSceneOfficialLibraryPanel({ campaignId }: { campaignId: string }) {
  const [presetId, setPresetId] = useState<PhotoSceneOutputPresetId>("story_9x16");
  const [category, setCategory] = useState("");
  const [scenes, setScenes] = useState<SceneDto[]>([]);
  const [selected, setSelected] = useState<SceneDto | null>(null);
  const [extraction, setExtraction] = useState<ExtractionDto | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [scale, setScale] = useState(1);
  const [shadowPreset, setShadowPreset] = useState("soft");
  const [productSize, setProductSize] = useState({ width: 1, height: 1 });
  const [saved, setSaved] = useState<SelectionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [catalogRes, extractionRes, selectionRes] = await Promise.all([
      fetch(
        `/api/photo-scene/official-scenes?preset=${presetId}${category ? `&category=${encodeURIComponent(category)}` : ""}`
      ),
      fetch(`/api/campaigns/${campaignId}/photo-scene/extractions`),
      fetch(`/api/campaigns/${campaignId}/photo-scene/scene-selection`),
    ]);
    if (catalogRes.ok) {
      const body = (await catalogRes.json()) as { scenes: SceneDto[] };
      setScenes(body.scenes ?? []);
    }
    if (extractionRes.ok) {
      const body = (await extractionRes.json()) as { generation?: ExtractionDto | null };
      setExtraction(body.generation ?? null);
    }
    if (selectionRes.ok) {
      const body = (await selectionRes.json()) as { selection?: SelectionDto | null };
      if (body.selection?.frozen) {
        setSaved(body.selection);
        if (body.selection.scene) {
          setSelected(body.selection.scene);
          setOffsetX(body.selection.frozen.placement.offsetX);
          setOffsetY(body.selection.frozen.placement.offsetY);
          setScale(body.selection.frozen.placement.scale);
          setShadowPreset(body.selection.frozen.placement.shadowPreset);
          setPresetId(body.selection.frozen.presetId);
        }
      }
    }
  }, [campaignId, presetId, category]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(
    () => Array.from(new Set(scenes.map((scene) => scene.category))),
    [scenes]
  );

  function chooseScene(scene: SceneDto) {
    setSelected(scene);
    setOffsetX(scene.defaultOffsetX);
    setOffsetY(scene.defaultOffsetY);
    setScale(scene.scaleRange.defaultScale);
    setShadowPreset(scene.defaultShadowPreset);
    setError("");
  }

  async function saveSelection() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/photo-scene/scene-selection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: selected.sceneId,
          sceneVersion: selected.version,
          presetId,
          extractedAssetId: extraction?.outputAssetId,
          placement: {
            anchor: selected.productAnchor,
            offsetX,
            offsetY,
            scale,
            rotation: 0,
            zIndex: 1,
            shadowPreset,
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not save this scene placement.");
        return;
      }
      setSaved(body.selection as SelectionDto);
    } finally {
      setBusy(false);
    }
  }

  const pixels = PHOTO_SCENE_OUTPUT_PRESET_PIXELS[presetId];
  const previewHeight = 280;
  const previewWidth = Math.round((pixels.width / pixels.height) * previewHeight);
  const placement: PhotoScenePlacementV1 | null = selected
    ? {
        anchor: selected.productAnchor as PhotoScenePlacementV1["anchor"],
        offsetX,
        offsetY,
        scale,
        rotation: 0,
        zIndex: 1,
        shadowPreset: shadowPreset as PhotoScenePlacementV1["shadowPreset"],
      }
    : null;
  const productBox =
    selected && placement
      ? computeProductPlacementNormalized({
          safeArea: selected.safeArea,
          placement,
          productWidth: productSize.width,
          productHeight: productSize.height,
        })
      : null;

  return (
    <DashboardSection
      title="Photo Scene — Official scene library"
      subtitle="Choose a published official scene and freeze placement. This is not a generated marketing image."
    >
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-ink-secondary">
          Placement preview only. No marketing image is created in this step.
        </p>

        {extraction?.status === "ready" && extraction.previewUrl ? (
          <p className="text-sm text-ink-secondary">Extracted product is ready to place.</p>
        ) : (
          <p className="text-sm text-ink-secondary">Extract a product first, then choose an official scene.</p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-navy">
            Output preset
            <select
              className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
              value={presetId}
              onChange={(event) => setPresetId(event.target.value as PhotoSceneOutputPresetId)}
            >
              {PHOTO_SCENE_OUTPUT_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset} ({PHOTO_SCENE_OUTPUT_PRESET_PIXELS[preset].ratio})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-navy">
            Category
            <select
              className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">All published scenes</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {scenes.map((scene) => (
            <button
              key={`${scene.sceneId}-${scene.version}`}
              type="button"
              onClick={() => chooseScene(scene)}
              className={`overflow-hidden rounded-lg border text-left ${
                selected?.sceneId === scene.sceneId ? "border-navy ring-1 ring-navy" : "border-border"
              }`}
            >
              {scene.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={scene.previewUrl} alt="" className="h-24 w-full object-cover" />
              ) : (
                <div className="flex h-24 items-center justify-center bg-surface-muted text-xs text-ink-secondary">
                  {scene.category}
                </div>
              )}
              <div className="px-2 py-2">
                <p className="text-sm font-medium text-navy">{scene.name}</p>
                <p className="text-xs text-ink-secondary">
                  v{scene.version} · {scene.category}
                </p>
              </div>
            </button>
          ))}
          {scenes.length === 0 ? (
            <p className="col-span-full text-sm text-ink-secondary">
              No published official scenes match this preset.
            </p>
          ) : null}
        </div>

        {selected && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-navy">Placement preview</p>
              <div
                className="relative overflow-hidden rounded-lg border border-border bg-black"
                style={{ width: previewWidth, height: previewHeight }}
              >
                {selected.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 bg-slate-700" />
                )}
                <div
                  className="absolute border border-dashed border-white/70"
                  style={{
                    left: `${selected.safeArea.x * 100}%`,
                    top: `${selected.safeArea.y * 100}%`,
                    width: `${selected.safeArea.width * 100}%`,
                    height: `${selected.safeArea.height * 100}%`,
                  }}
                />
                {extraction?.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={extraction.previewUrl}
                    alt="Extracted product placement"
                    className="absolute"
                    onLoad={(event) => {
                      const img = event.currentTarget;
                      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                        setProductSize({ width: img.naturalWidth, height: img.naturalHeight });
                      }
                    }}
                    style={{
                      left: `${(productBox?.x ?? 0.5) * 100}%`,
                      top: `${(productBox?.y ?? 0.5) * 100}%`,
                      width: `${(productBox?.width ?? 0.3) * 100}%`,
                      height: `${(productBox?.height ?? 0.3) * 100}%`,
                      objectFit: "contain",
                    }}
                  />
                ) : null}
              </div>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-navy">
                Offset X ({offsetX.toFixed(2)})
                <input
                  type="range"
                  min={-0.2}
                  max={0.2}
                  step={0.01}
                  value={offsetX}
                  onChange={(event) => setOffsetX(Number(event.target.value))}
                  className="mt-1 w-full"
                />
              </label>
              <label className="block text-sm font-medium text-navy">
                Offset Y ({offsetY.toFixed(2)})
                <input
                  type="range"
                  min={-0.2}
                  max={0.2}
                  step={0.01}
                  value={offsetY}
                  onChange={(event) => setOffsetY(Number(event.target.value))}
                  className="mt-1 w-full"
                />
              </label>
              <label className="block text-sm font-medium text-navy">
                Scale ({scale.toFixed(2)})
                <input
                  type="range"
                  min={selected.scaleRange.min}
                  max={selected.scaleRange.max}
                  step={0.01}
                  value={scale}
                  onChange={(event) => setScale(Number(event.target.value))}
                  className="mt-1 w-full"
                />
              </label>
              <label className="block text-sm font-medium text-navy">
                Shadow
                <select
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
                  value={shadowPreset}
                  onChange={(event) => setShadowPreset(event.target.value)}
                >
                  <option value="none">none</option>
                  <option value="soft">soft</option>
                  <option value="grounded">grounded</option>
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !selected}
                onClick={() => void saveSelection()}
                className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Save scene and placement
              </button>
            </div>
          </div>
        )}

        {saved?.frozen && (
          <p className="text-sm text-ink-secondary">
            Frozen {saved.scene?.name ?? "scene"} v{saved.frozen.sceneVersion} (
            {saved.frozen.sceneContentHash.slice(0, 18)}…). Marketing image not generated.
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </DashboardSection>
  );
}
