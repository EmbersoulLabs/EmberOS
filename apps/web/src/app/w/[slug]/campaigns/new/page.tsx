"use client";

import { useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PHASE1_PLATFORMS } from "@ceo-agent/shared/platform-specs";
import { MAX_SOURCE_VIDEOS, MAX_CAMPAIGN_IMAGES, MAX_COMBINED_SOURCE_DURATION_SEC, MAX_UPLOAD_DURATION_SEC } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import { resolveContentLocaleForRun, getRenderPreferencesPayload } from "@/lib/preferences";
import { maxUploadRisk } from "@/lib/upload-risk";
import {
  CampaignBriefForm,
  EMPTY_BRIEF_FORM,
  type CampaignBriefFormValues,
} from "@/components/campaign/CampaignBriefForm";

function classifyUploadFile(file: File): "video" | "image" {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (/\.(mp4|mov|webm|mkv|avi|m4v|3gp|mpeg|mpg)$/i.test(file.name)) return "video";
  return "image";
}

async function waitForVideoProbes(campaignId: string, maxWaitMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await fetch(`/api/campaigns/${campaignId}`);
    const data = await res.json();
    const assets = (data.assets ?? []) as Array<{
      type: string;
      durationSec?: string | null;
      metadata?: { rejected?: boolean; merged?: boolean };
    }>;
    const rawVideos = assets.filter((a) => a.type === "video");
    if (rawVideos.length === 0) return;

    const allSettled = rawVideos.every(
      (a) =>
        a.metadata?.merged === true ||
        a.metadata?.rejected === true ||
        (a.durationSec != null && a.durationSec !== "")
    );
    if (allSettled) return;

    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("VIDEO_PROBE_TIMEOUT");
}

function orderUploadFiles(files: File[]): File[] {
  const videos = files.filter((f) => classifyUploadFile(f) === "video");
  const images = files.filter((f) => classifyUploadFile(f) === "image");
  return [...videos, ...images];
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
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

/** Merge new picker/drop selection into existing files (accumulate, don't replace). */
function mergeUploadFiles(existing: File[], incoming: File[]): File[] {
  const existingVideos = existing.filter((f) => classifyUploadFile(f) === "video");
  const existingImages = existing.filter((f) => classifyUploadFile(f) === "image");
  const incomingVideos = incoming.filter((f) => classifyUploadFile(f) === "video");
  const incomingImages = incoming.filter((f) => classifyUploadFile(f) === "image");

  const videoMap = new Map<string, File>();
  for (const f of existingVideos) videoMap.set(fileKey(f), f);
  for (const f of incomingVideos) videoMap.set(fileKey(f), f);
  const videoFiles = Array.from(videoMap.values()).slice(0, MAX_SOURCE_VIDEOS);

  const imageMap = new Map<string, File>();
  for (const f of existingImages) imageMap.set(fileKey(f), f);
  for (const f of incomingImages) imageMap.set(fileKey(f), f);
  const images = Array.from(imageMap.values()).slice(0, MAX_CAMPAIGN_IMAGES);

  return orderUploadFiles([...videoFiles, ...images]);
}

export default function CampaignWizardPage() {
  const params = useParams();
  const slug = params.slug as string;
  const router = useRouter();
  const { t, locale } = useI18n();

  const [name, setName] = useState("");
  const [briefForm, setBriefForm] = useState<CampaignBriefFormValues>(EMPTY_BRIEF_FORM);
  const [platforms, setPlatforms] = useState<string[]>([...PHASE1_PLATFORMS]);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadStep, setUploadStep] = useState("");
  const [error, setError] = useState("");
  const [uploadRisk, setUploadRisk] = useState<"low" | "medium" | "high">("low");
  const [pendingCampaignId, setPendingCampaignId] = useState<string | null>(null);

  function addFiles(incoming: FileList | File[] | null) {
    if (!incoming || incoming.length === 0) return;
    const picked = Array.from(incoming);
    setFiles((prev) => mergeUploadFiles(prev, picked));
    setError("");
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (picked?.length) addFiles(picked);
    e.target.value = "";
  }

  function removeFile(file: File) {
    const key = fileKey(file);
    setFiles((prev) => prev.filter((f) => fileKey(f) !== key));
  }

  function togglePlatform(p: string) {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  async function runCampaign(campaignId: string) {
    const contentLocale = resolveContentLocaleForRun(locale);
    const renderPreferences = getRenderPreferencesPayload();
    const runRes = await fetch(`/api/campaigns/${campaignId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: contentLocale, ...renderPreferences }),
    });
    const runData = await runRes.json();
    if (!runRes.ok) {
      throw new Error(runData.error ?? t("error.runCampaign"));
    }
    router.push(`/w/${slug}/campaigns/${campaignId}/task?taskId=${runData.taskId}`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setUploadStep("");

    try {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug);
      if (!ws) throw new Error(t("error.workspaceNotFound"));

      const campRes = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: ws.id,
          name,
          platforms,
          campaignBrief: briefForm.campaignBrief.trim() || undefined,
          voicePreset: briefForm.voicePreset,
          contentStyle: briefForm.contentStyle || undefined,
          campaignGoal: briefForm.campaignGoal || undefined,
          bgmPreference: briefForm.bgmPreference,
          bgmStartPreference: briefForm.bgmStartPreference,
          ...getRenderPreferencesPayload(),
        }),
      });
      const campData = await campRes.json();
      if (!campData.campaign) throw new Error(campData.error ?? t("error.createCampaign"));

      const campaignId = campData.campaign.id;

      if (files.length === 0) {
        throw new Error(t("campaign.uploadRequired"));
      }

      if (files.length > 0) {
        const selected = files;
        const videoCount = selected.filter((f) => classifyUploadFile(f) === "video").length;
        const imageCount = selected.filter((f) => classifyUploadFile(f) === "image").length;

        if (videoCount > MAX_SOURCE_VIDEOS) {
          throw new Error(t("campaign.uploadTooManyVideos", { max: String(MAX_SOURCE_VIDEOS) }));
        }
        if (imageCount > MAX_CAMPAIGN_IMAGES) {
          throw new Error(t("campaign.uploadTooManyImages", { max: String(MAX_CAMPAIGN_IMAGES) }));
        }
        if (videoCount === 0 && imageCount === 0) {
          throw new Error(t("campaign.uploadRequired"));
        }

        const videoFiles = selected.filter((f) => classifyUploadFile(f) === "video");
        let combinedVideoSec = 0;
        for (const file of videoFiles) {
          const durationSec = await probeLocalVideoDuration(file);
          if (durationSec > MAX_UPLOAD_DURATION_SEC) {
            throw new Error(
              t("campaign.uploadVideoTooLong", {
                name: file.name,
                max: String(Math.round(MAX_UPLOAD_DURATION_SEC / 60)),
              })
            );
          }
          combinedVideoSec += durationSec;
        }
        if (combinedVideoSec > MAX_COMBINED_SOURCE_DURATION_SEC) {
          throw new Error(
            t("campaign.uploadCombinedTooLong", {
              max: String(Math.round(MAX_COMBINED_SOURCE_DURATION_SEC / 60)),
            })
          );
        }

        const ordered = orderUploadFiles(selected);
        for (let i = 0; i < ordered.length; i++) {
          const file = ordered[i]!;
          setUploadStep(
            t("campaign.uploadProgress", {
              name: file.name,
              current: String(i + 1),
              total: String(ordered.length),
            })
          );
          const type = classifyUploadFile(file);
          const urlRes = await fetch(`/api/campaigns/${campaignId}/assets/upload-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              mimeType: file.type || (type === "video" ? "video/mp4" : "image/jpeg"),
              type,
              fileSizeBytes: file.size,
            }),
          });
          const urlData = await urlRes.json();
          if (!urlRes.ok || !urlData.assetId || !urlData.uploadUrl) {
            throw new Error(urlData.error ?? `Failed to prepare upload for ${file.name}`);
          }

          const uploadRes = await fetch(urlData.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!uploadRes.ok) {
            const uploadErr = await uploadRes.text().catch(() => "");
            throw new Error(
              `Upload failed for ${file.name} (${uploadRes.status})${uploadErr ? `: ${uploadErr.slice(0, 120)}` : ""}`
            );
          }

          const confirmRes = await fetch(
            `/api/campaigns/${campaignId}/assets/${urlData.assetId}/confirm`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            }
          );
          const confirmData = await confirmRes.json();
          if (!confirmRes.ok) {
            throw new Error(confirmData.error ?? `Failed to confirm upload for ${file.name}`);
          }
        }

        await waitForVideoProbes(campaignId);
        const assetsRes = await fetch(`/api/campaigns/${campaignId}`);
        const assetsData = await assetsRes.json();
        const campaignAssets = assetsData.assets ?? [];
        const hasUsableVideo = campaignAssets.some(
          (a: { type: string; metadata?: { rejected?: boolean } }) =>
            a.type === "video" && a.metadata?.rejected !== true
        );
        const selectedVideos = selected.filter((f) => classifyUploadFile(f) === "video").length;
        if (selectedVideos > 0 && !hasUsableVideo) {
          throw new Error(t("error.videoProcessing"));
        }

        const risk = maxUploadRisk(campaignAssets);
        setUploadRisk(risk);
        if (risk === "high" || risk === "medium") {
          setPendingCampaignId(campaignId);
          setLoading(false);
          setUploadStep("");
          return;
        }
      }

      setUploadStep("");
      await runCampaign(campaignId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "VIDEO_PROBE_TIMEOUT") {
        setError(t("error.videoTimeout"));
      } else {
        setError(msg || t("error.generic"));
      }
    } finally {
      setLoading(false);
      setUploadStep("");
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 border-b border-border pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">{t("marketing.brand")}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy sm:text-3xl">
            {t("campaign.new.title")}
          </h1>
          <p className="mt-2 text-sm text-ink-secondary">{t("campaign.uploadHint")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <section className="brand-card p-6">
            <label className="mb-1.5 block text-sm font-semibold text-navy">{t("campaign.name")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
              placeholder={t("campaign.namePlaceholder")}
              required
            />

            <div className="mt-6">
              <label className="mb-2 block text-sm font-semibold text-navy">{t("campaign.platforms")}</label>
              <div className="flex flex-wrap gap-2">
                {PHASE1_PLATFORMS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-200 ${
                      platforms.includes(p)
                        ? "bg-navy text-white shadow-sm"
                        : "border border-border bg-surface text-ink-secondary hover:border-brand-blue/30"
                    }`}
                  >
                    {t(`platform.${p}` as "platform.tiktok")}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <CampaignBriefForm values={briefForm} onChange={setBriefForm} />

          <section className="brand-card p-6">
            <label className="mb-1.5 block text-sm font-semibold text-navy">{t("campaign.upload")}</label>
            <p className="mb-3 text-xs text-ink-secondary">
              {t("campaign.uploadOwnMaterial", {
                maxVideos: String(MAX_SOURCE_VIDEOS),
                maxMinutes: String(Math.round(MAX_COMBINED_SOURCE_DURATION_SEC / 60)),
              })}
            </p>
            <p className="mb-3 text-xs text-brand-blue/80">{t("campaign.uploadAccumulate")}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,image/*,.mp4,.mov,.webm,.mkv,.avi,.m4v,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={openFilePicker}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openFilePicker();
                }
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragActive(false);
                addFiles(e.dataTransfer.files);
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 transition-colors ${
                dragActive
                  ? "border-brand-blue bg-brand-blue/10"
                  : "border-border bg-surface-muted/50 hover:border-brand-blue/40 hover:bg-brand-blue/5"
              }`}
            >
              <span className="text-sm font-medium text-ink-secondary">{t("campaign.uploadDropHint")}</span>
              <span className="mt-1 text-xs text-ink-secondary/70">{t("campaign.uploadDropSub")}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openFilePicker();
                }}
                className="mt-4 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-navy shadow-sm transition hover:border-brand-blue/30 hover:bg-surface-muted"
              >
                {t("campaign.uploadChoose")}
              </button>
            </div>
            {files.length > 0 && (
              <>
                <p className="mt-3 text-xs text-ink-secondary">
                  {t("campaign.uploadSelected", {
                    videos: String(files.filter((f) => classifyUploadFile(f) === "video").length),
                    images: String(files.filter((f) => classifyUploadFile(f) === "image").length),
                  })}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {files.map((file) => (
                    <li
                      key={fileKey(file)}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-xs"
                    >
                      <span className="min-w-0 truncate text-ink">
                        <span className="font-medium text-navy">
                          {classifyUploadFile(file) === "video"
                            ? t("campaign.fileVideo")
                            : t("campaign.fileImage")}
                        </span>
                        <span className="mx-1.5 text-ink-secondary">·</span>
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(file)}
                        className="shrink-0 text-ink-secondary transition hover:text-red-600"
                        aria-label={t("campaign.uploadRemove")}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {uploadRisk === "high" && (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {t("campaign.uploadRiskHigh")}
              </p>
            )}
            {uploadRisk === "medium" && (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {t("campaign.uploadRiskMedium")}
              </p>
            )}
          </section>

          {uploadStep && (
            <p className="rounded-xl border border-brand-blue/20 bg-brand-blue/5 px-4 py-3 text-sm text-brand-blue">
              {uploadStep}
            </p>
          )}

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          )}

          {pendingCampaignId ? (
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  await runCampaign(pendingCampaignId);
                } catch (err) {
                  setError(err instanceof Error ? err.message : t("error.generic"));
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full rounded-xl border border-amber-300 bg-amber-50 py-3 text-sm font-semibold text-amber-900 disabled:opacity-50"
            >
              {loading ? t("campaign.creating") : t("campaign.continueAnyway")}
            </button>
          ) : (
            <button
              type="submit"
              disabled={loading}
              className="w-full brand-btn-primary py-3 disabled:opacity-50"
            >
              {loading ? (uploadStep || t("campaign.creating")) : t("campaign.submit")}
            </button>
          )}
        </form>
      </div>
    </AppShell>
  );
}
