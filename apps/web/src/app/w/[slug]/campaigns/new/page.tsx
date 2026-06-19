"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PHASE1_PLATFORMS } from "@ceo-agent/shared/platform-specs";
import { CAMPAIGN_GOAL_OPTIONS } from "@ceo-agent/shared/i18n";
import { useI18n } from "@/lib/i18n/provider";
import { maxUploadRisk } from "@/lib/upload-risk";

export default function CampaignWizardPage() {
  const params = useParams();
  const slug = params.slug as string;
  const router = useRouter();
  const { t } = useI18n();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("种草");
  const [platforms, setPlatforms] = useState<string[]>([...PHASE1_PLATFORMS]);
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadRisk, setUploadRisk] = useState<"low" | "medium" | "high">("low");
  const [pendingCampaignId, setPendingCampaignId] = useState<string | null>(null);

  function togglePlatform(p: string) {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  async function runCampaign(campaignId: string) {
    const runRes = await fetch(`/api/campaigns/${campaignId}/run`, { method: "POST" });
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

    try {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug);
      if (!ws) throw new Error(t("error.workspaceNotFound"));

      const campRes = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, name, goal, platforms }),
      });
      const campData = await campRes.json();
      if (!campData.campaign) throw new Error(campData.error ?? t("error.createCampaign"));

      const campaignId = campData.campaign.id;

      if (files) {
        for (const file of Array.from(files)) {
          const type = file.type.startsWith("video") ? "video" : "image";
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

        await new Promise((r) => setTimeout(r, 2500));
        const assetsRes = await fetch(`/api/campaigns/${campaignId}`);
        const assetsData = await assetsRes.json();
        const risk = maxUploadRisk(assetsData.assets ?? []);
        setUploadRisk(risk);
        if (risk === "high" || risk === "medium") {
          setPendingCampaignId(campaignId);
          setLoading(false);
          return;
        }
      }

      await runCampaign(campaignId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error.generic"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-bold">{t("campaign.new.title")}</h1>

      <form onSubmit={handleSubmit} className="max-w-lg space-y-4 rounded-xl border bg-white p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">{t("campaign.name")}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">{t("campaign.goal")}</label>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            {CAMPAIGN_GOAL_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {t(g.key)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">{t("campaign.platforms")}</label>
          <div className="flex flex-wrap gap-2">
            {PHASE1_PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={`rounded-full px-3 py-1 text-sm ${
                  platforms.includes(p)
                    ? "bg-primary text-white"
                    : "border border-slate-300 text-slate-600"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">{t("campaign.upload")}</label>
          <p className="mb-2 text-xs text-slate-500">{t("campaign.uploadHint")}</p>
          <input
            type="file"
            accept="video/*,image/*"
            multiple
            onChange={(e) => setFiles(e.target.files)}
            className="w-full text-sm"
          />
          <p className="mt-2 text-xs text-amber-700">{t("campaign.uploadOwnMaterial")}</p>
          {uploadRisk === "high" && (
            <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {t("campaign.uploadRiskHigh")}
            </p>
          )}
          {uploadRisk === "medium" && (
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              {t("campaign.uploadRiskMedium")}
            </p>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

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
            className="w-full rounded-lg border border-amber-400 bg-amber-50 py-2 text-sm font-medium text-amber-900 disabled:opacity-50"
          >
            {loading ? t("campaign.creating") : t("campaign.continueAnyway")}
          </button>
        ) : (
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? t("campaign.creating") : t("campaign.submit")}
          </button>
        )}
      </form>
    </AppShell>
  );
}
