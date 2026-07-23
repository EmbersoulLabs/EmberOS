"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  CAMPAIGN_OBJECTIVES,
  CAMPAIGN_OBJECTIVE_LABELS,
  CAMPAIGN_LANGUAGE_CODES,
  defaultCampaignLanguages,
  appendUniqueId,
  directAssetsForStoryMode,
  resolveAssetDisplayLabel,
  type CampaignObjective,
  type CampaignLanguageCode,
  MAX_SOURCE_VIDEOS,
  MAX_CAMPAIGN_IMAGES,
  MAX_UPLOAD_DURATION_SEC,
  MAX_COMBINED_SOURCE_DURATION_SEC,
} from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import { putWithProgress } from "@/lib/upload-with-progress";

type LibraryAsset = {
  id: string;
  type: string;
  displayName: string | null;
  originalFilename: string | null;
};

type ReadyStory = { id: string; name: string };

type UploadItemStatus = "uploading" | "success" | "failed";

type UploadItem = {
  localId: string;
  file: File;
  status: UploadItemStatus;
  percent: number;
  error?: string;
  assetId?: string;
  displayName?: string;
  originalFilename: string;
  previewUrl?: string;
};

function classifyUploadFile(file: File): "video" | "image" {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(file.name)) return "video";
  return "image";
}

function probeLocalVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Cannot read duration: ${file.name}`));
    };
    video.src = url;
  });
}

function makeLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function CampaignMediaInput({
  workspaceId,
  campaignId,
  selectedAssetIds,
  selectedStoryIds,
  onSelectedAssetsChange,
  onSelectedStoriesChange,
  files,
  onFilesChange,
  disabled,
}: {
  workspaceId: string;
  campaignId: string | null;
  selectedAssetIds: string[];
  selectedStoryIds: string[];
  onSelectedAssetsChange: Dispatch<SetStateAction<string[]>>;
  onSelectedStoriesChange: Dispatch<SetStateAction<string[]>>;
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [libraryAssets, setLibraryAssets] = useState<LibraryAsset[]>([]);
  const [readyStories, setReadyStories] = useState<ReadyStory[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [error, setError] = useState("");
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [pendingVideoIds, setPendingVideoIds] = useState<string[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const uploadBusy = uploads.some((u) => u.status === "uploading");

  const refreshLibrary = useCallback(async () => {
    const [assetsRes, storiesRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/library?sort=newest`),
      fetch(`/api/workspaces/${workspaceId}/stories?status=ready`),
    ]);
    const assetsData = await assetsRes.json();
    const storiesData = await storiesRes.json();
    if (assetsRes.ok) setLibraryAssets(assetsData.assets ?? []);
    if (storiesRes.ok) {
      setReadyStories(
        (storiesData.stories ?? []).map((s: { id: string; name: string }) => ({
          id: s.id,
          name: s.name,
        }))
      );
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    return () => {
      for (const item of uploads) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchUpload = useCallback((localId: string, patch: Partial<UploadItem>) => {
    setUploads((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...patch } : item))
    );
  }, []);

  const uploadOne = useCallback(
    async (item: UploadItem): Promise<string | null> => {
      if (!campaignId) return null;
      patchUpload(item.localId, { status: "uploading", percent: 0, error: undefined });
      try {
        const type = classifyUploadFile(item.file);
        const urlRes = await fetch(`/api/campaigns/${campaignId}/assets/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: item.file.name,
            mimeType: item.file.type || (type === "video" ? "video/mp4" : "image/jpeg"),
            type,
            fileSizeBytes: item.file.size,
          }),
        });
        const urlData = await urlRes.json();
        if (!urlRes.ok || !urlData.uploadUrl || !urlData.assetId) {
          throw new Error(urlData.error ?? `Upload prepare failed for ${item.file.name}`);
        }

        await putWithProgress(
          urlData.uploadUrl as string,
          item.file,
          item.file.type || "application/octet-stream",
          (percent) => patchUpload(item.localId, { percent })
        );

        const confirmRes = await fetch(
          `/api/campaigns/${campaignId}/assets/${urlData.assetId}/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }
        );
        const confirmData = await confirmRes.json();
        if (!confirmRes.ok) throw new Error(confirmData.error ?? "Confirm failed");

        const asset = confirmData.asset as LibraryAsset | undefined;
        const displayName = resolveAssetDisplayLabel({
          displayName: asset?.displayName,
          originalFilename: asset?.originalFilename ?? item.file.name,
          id: urlData.assetId as string,
        });

        patchUpload(item.localId, {
          status: "success",
          percent: 100,
          assetId: urlData.assetId as string,
          displayName,
          originalFilename: asset?.originalFilename ?? item.file.name,
        });
        onSelectedAssetsChange((current) =>
          appendUniqueId(current, urlData.assetId as string)
        );
        await refreshLibrary();
        return urlData.assetId as string;
      } catch (err) {
        patchUpload(item.localId, {
          status: "failed",
          error: err instanceof Error ? err.message : t("campaign.upload.retryFailed"),
        });
        return null;
      }
    },
    [campaignId, onSelectedAssetsChange, patchUpload, refreshLibrary, t]
  );

  const uploadFilesToCampaign = useCallback(
    async (incoming: File[]) => {
      if (!campaignId || incoming.length === 0) {
        onFilesChange(incoming);
        return;
      }
      setError("");
      try {
        const videoCount = incoming.filter((f) => classifyUploadFile(f) === "video").length;
        const imageCount = incoming.filter((f) => classifyUploadFile(f) === "image").length;
        if (videoCount > MAX_SOURCE_VIDEOS) {
          throw new Error(t("campaign.uploadTooManyVideos", { max: String(MAX_SOURCE_VIDEOS) }));
        }
        if (imageCount > MAX_CAMPAIGN_IMAGES) {
          throw new Error(t("campaign.uploadTooManyImages", { max: String(MAX_CAMPAIGN_IMAGES) }));
        }

        let combined = 0;
        for (const file of incoming.filter((f) => classifyUploadFile(f) === "video")) {
          const duration = await probeLocalVideoDuration(file);
          if (duration > MAX_UPLOAD_DURATION_SEC) {
            throw new Error(
              t("campaign.uploadVideoTooLong", {
                name: file.name,
                max: String(Math.round(MAX_UPLOAD_DURATION_SEC / 60)),
              })
            );
          }
          combined += duration;
        }
        if (combined > MAX_COMBINED_SOURCE_DURATION_SEC) {
          throw new Error(
            t("campaign.uploadCombinedTooLong", {
              max: String(Math.round(MAX_COMBINED_SOURCE_DURATION_SEC / 60)),
            })
          );
        }

        const items: UploadItem[] = incoming.map((file) => ({
          localId: makeLocalId(),
          file,
          status: "uploading" as const,
          percent: 0,
          originalFilename: file.name,
          previewUrl: URL.createObjectURL(file),
        }));
        setUploads((current) => [...current, ...items]);
        onFilesChange([]);

        const batchVideoIds: string[] = [];
        for (const item of items) {
          const assetId = await uploadOne(item);
          if (assetId && classifyUploadFile(item.file) === "video") {
            batchVideoIds.push(assetId);
          }
        }

        if (batchVideoIds.length > 1) {
          setPendingVideoIds(batchVideoIds);
          setAnalyzeOpen(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    },
    [campaignId, onFilesChange, t, uploadOne]
  );

  const retryUpload = useCallback(
    async (localId: string) => {
      const item = uploads.find((u) => u.localId === localId);
      if (!item || item.status !== "failed") return;
      await uploadOne(item);
    },
    [uploadOne, uploads]
  );

  async function saveRename(assetId: string, nextName: string) {
    const trimmed = nextName.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/library/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: trimmed }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? t("campaign.upload.renameFailed"));
    setUploads((current) =>
      current.map((item) =>
        item.assetId === assetId ? { ...item, displayName: trimmed } : item
      )
    );
    await refreshLibrary();
    setRenamingId(null);
  }

  const applyAnalysisMode = async (mode: "separate" | "story") => {
    if (!campaignId) return;
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaAnalysisMode: mode,
          assetIds:
            mode === "story"
              ? directAssetsForStoryMode(selectedAssetIds, pendingVideoIds)
              : selectedAssetIds,
          storyIds: selectedStoryIds,
          storyAssetIds: mode === "story" ? pendingVideoIds : undefined,
          createStoryName: mode === "story" ? "Campaign Story" : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save choice");
      if (mode === "story" && data.createdStoryId) {
        onSelectedAssetsChange((current) =>
          directAssetsForStoryMode(current, pendingVideoIds)
        );
        onSelectedStoriesChange((current) =>
          appendUniqueId(current, data.createdStoryId as string)
        );
      }
      setAnalyzeOpen(false);
      setPendingVideoIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-semibold text-navy">{t("campaign.chooseLibrary")}</p>
        <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border bg-white p-2">
          {libraryAssets.filter((a) => a.type === "video" || a.type === "image").length === 0 ? (
            <p className="px-2 py-3 text-xs text-ink-secondary">{t("assetLibrary.empty")}</p>
          ) : (
            libraryAssets
              .filter((a) => a.type === "video" || a.type === "image")
              .slice(0, 50)
              .map((asset) => {
                const label = resolveAssetDisplayLabel(asset);
                const checked = selectedAssetIds.includes(asset.id);
                return (
                  <label
                    key={asset.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted"
                  >
                    <input
                      type="checkbox"
                      disabled={disabled || uploadBusy}
                      checked={checked}
                      onChange={() =>
                        onSelectedAssetsChange(
                          checked
                            ? selectedAssetIds.filter((id) => id !== asset.id)
                            : [...selectedAssetIds, asset.id]
                        )
                      }
                    />
                    <span className="truncate">{label}</span>
                  </label>
                );
              })
          )}
        </div>
      </div>

      {readyStories.length > 0 ? (
        <div>
          <p className="mb-2 text-sm font-semibold text-navy">{t("assetLibrary.selectStories")}</p>
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-xl border border-border bg-white p-2">
            {readyStories.map((story) => {
              const checked = selectedStoryIds.includes(story.id);
              return (
                <label
                  key={story.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted"
                >
                  <input
                    type="checkbox"
                    disabled={disabled || uploadBusy}
                    checked={checked}
                    onChange={() =>
                      onSelectedStoriesChange(
                        checked
                          ? selectedStoryIds.filter((id) => id !== story.id)
                          : [...selectedStoryIds, story.id]
                      )
                    }
                  />
                  <span className="truncate">{story.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-sm font-semibold text-navy">{t("campaign.uploadNew")}</p>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="video/*,image/*"
          className="hidden"
          disabled={disabled || uploadBusy || !campaignId}
          onChange={(e) => {
            const list = e.target.files ? Array.from(e.target.files) : [];
            void uploadFilesToCampaign(list);
            e.target.value = "";
          }}
        />
        <div
          role="button"
          tabIndex={0}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            if (e.dataTransfer.files?.length) {
              void uploadFilesToCampaign(Array.from(e.dataTransfer.files));
            }
          }}
          onClick={() => campaignId && fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (campaignId) fileRef.current?.click();
            }
          }}
          className={`rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm transition ${
            dragActive
              ? "border-brand-blue bg-brand-blue/10 text-brand-blue"
              : "border-border bg-surface-muted/40 text-ink-secondary"
          } ${!campaignId || disabled ? "opacity-60" : "cursor-pointer"}`}
        >
          {uploadBusy
            ? t("campaign.upload.uploading")
            : campaignId
              ? t("campaign.uploadDropHint")
              : t("campaign.workspace.saveFirstForUpload")}
        </div>
        {files.length > 0 ? (
          <p className="mt-2 text-xs text-ink-secondary">
            {files.length} file(s) selected
          </p>
        ) : null}
      </div>

      {uploads.length > 0 ? (
        <ul className="space-y-3">
          {uploads.map((item) => (
            <li
              key={item.localId}
              className="rounded-xl border border-border bg-white p-3 text-sm"
            >
              <div className="flex gap-3">
                {item.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.previewUrl}
                    alt=""
                    className="h-14 w-14 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-surface-muted text-xs text-ink-secondary">
                    {classifyUploadFile(item.file) === "video" ? "Video" : "Image"}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-navy">
                    {item.displayName || item.originalFilename}
                  </p>
                  {item.originalFilename && item.displayName !== item.originalFilename ? (
                    <p className="truncate text-xs text-ink-secondary">
                      {t("campaign.upload.originalFile", { name: item.originalFilename })}
                    </p>
                  ) : null}

                  {item.status === "uploading" ? (
                    <div className="mt-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full bg-navy transition-all"
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {t("campaign.upload.progress", { percent: String(item.percent) })}
                      </p>
                    </div>
                  ) : null}

                  {item.status === "success" ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-green-700">
                        {t("campaign.upload.success")}
                      </span>
                      {item.assetId ? (
                        renamingId === item.assetId ? (
                          <form
                            className="flex flex-wrap items-center gap-1"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void saveRename(item.assetId!, renameDraft).catch((err) =>
                                setError(
                                  err instanceof Error
                                    ? err.message
                                    : t("campaign.upload.renameFailed")
                                )
                              );
                            }}
                          >
                            <input
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              className="rounded-lg border border-border px-2 py-1 text-xs"
                              autoFocus
                            />
                            <button
                              type="submit"
                              className="rounded-lg bg-navy px-2 py-1 text-xs font-semibold text-white"
                            >
                              {t("campaign.upload.saveRename")}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-border px-2 py-1 text-xs"
                              onClick={() => setRenamingId(null)}
                            >
                              {t("campaign.upload.cancelRename")}
                            </button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className="text-xs font-semibold text-navy underline"
                            onClick={() => {
                              setRenamingId(item.assetId!);
                              setRenameDraft(item.displayName || item.originalFilename);
                            }}
                          >
                            {t("campaign.upload.rename")}
                          </button>
                        )
                      ) : null}
                    </div>
                  ) : null}

                  {item.status === "failed" ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-red-600">
                        {item.error || t("campaign.upload.failed")}
                      </p>
                      <button
                        type="button"
                        className="text-xs font-semibold text-navy underline"
                        onClick={() => void retryUpload(item.localId)}
                      >
                        {t("campaign.upload.retry")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {analyzeOpen ? (
        <div className="rounded-xl border border-border bg-white p-4">
          <p className="font-semibold text-navy">{t("assetLibrary.analyzeChoiceTitle")}</p>
          <p className="mt-1 text-xs text-ink-secondary">{t("assetLibrary.analyzeChoiceHint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-sm"
              onClick={() => void applyAnalysisMode("separate")}
            >
              {t("assetLibrary.analyzeSeparate")}
            </button>
            <button
              type="button"
              className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white"
              onClick={() => void applyAnalysisMode("story")}
            >
              {t("assetLibrary.analyzeAsStory")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Read-only inferred language display (PD-038). */
export function InferredLanguageReadonly({
  values,
}: {
  values: {
    outputLanguage: CampaignLanguageCode;
    subtitleLanguage: CampaignLanguageCode;
    ctaLanguage: CampaignLanguageCode;
    hashtagLanguage: CampaignLanguageCode;
  };
}) {
  const { t } = useI18n();
  const labels: Record<CampaignLanguageCode, string> = useMemo(
    () => ({ en: "English", zh: "中文", ms: "Bahasa Melayu" }),
    []
  );
  const rows: Array<{ key: keyof typeof values; label: string }> = [
    { key: "outputLanguage", label: t("campaign.workspace.captionLanguage") },
    { key: "subtitleLanguage", label: t("campaign.workspace.subtitleLanguage") },
    { key: "ctaLanguage", label: t("campaign.workspace.ctaLanguage") },
    { key: "hashtagLanguage", label: t("campaign.workspace.hashtagLanguage") },
  ];
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.key} className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
          <dt className="text-xs text-ink-secondary">{row.label}</dt>
          <dd className="font-medium text-navy">{labels[values[row.key]]}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LanguageFields({
  values,
  onChange,
  disabled,
}: {
  values: {
    outputLanguage: CampaignLanguageCode;
    subtitleLanguage: CampaignLanguageCode;
    ctaLanguage: CampaignLanguageCode;
    hashtagLanguage: CampaignLanguageCode;
  };
  onChange: (next: typeof values) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const labels: Record<CampaignLanguageCode, string> = useMemo(
    () => ({ en: "English", zh: "中文", ms: "Bahasa Melayu" }),
    []
  );

  const fields: Array<{ key: keyof typeof values; label: string }> = [
    { key: "outputLanguage", label: t("campaign.workspace.outputLanguage") },
    { key: "subtitleLanguage", label: t("campaign.workspace.subtitleLanguage") },
    { key: "ctaLanguage", label: t("campaign.workspace.ctaLanguage") },
    { key: "hashtagLanguage", label: t("campaign.workspace.hashtagLanguage") },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <label key={field.key} className="block text-sm font-semibold text-navy">
          {field.label}
          <select
            disabled={disabled}
            value={values[field.key]}
            onChange={(e) =>
              onChange({
                ...values,
                [field.key]: e.target.value as CampaignLanguageCode,
              })
            }
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-normal"
          >
            {CAMPAIGN_LANGUAGE_CODES.map((code) => (
              <option key={code} value={code}>
                {labels[code]}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

export { CAMPAIGN_OBJECTIVES, CAMPAIGN_OBJECTIVE_LABELS, defaultCampaignLanguages };
export type { CampaignObjective, CampaignLanguageCode };
