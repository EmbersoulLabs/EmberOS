"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PHASE1_PLATFORMS } from "@ceo-agent/shared/platform-specs";

export default function CampaignWizardPage() {
  const params = useParams();
  const slug = params.slug as string;
  const router = useRouter();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("种草");
  const [platforms, setPlatforms] = useState<string[]>([...PHASE1_PLATFORMS]);
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function togglePlatform(p: string) {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug);
      if (!ws) throw new Error("Workspace not found");

      const campRes = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, name, goal, platforms }),
      });
      const campData = await campRes.json();
      if (!campData.campaign) throw new Error(campData.error ?? "Failed to create campaign");

      const campaignId = campData.campaign.id;

      if (files) {
        for (const file of Array.from(files)) {
          const type = file.type.startsWith("video") ? "video" : "image";
          const urlRes = await fetch(`/api/campaigns/${campaignId}/assets/upload-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              mimeType: file.type,
              type,
            }),
          });
          const urlData = await urlRes.json();
          if (!urlData.assetId) continue;

          await fetch(urlData.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file,
          });

          await fetch(`/api/campaigns/${campaignId}/assets/${urlData.assetId}/confirm`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        }
      }

      const runRes = await fetch(`/api/campaigns/${campaignId}/run`, { method: "POST" });
      const runData = await runRes.json();

      if (runData.taskId) {
        router.push(`/w/${slug}/campaigns/${campaignId}/task?taskId=${runData.taskId}`);
      } else {
        router.push(`/w/${slug}/campaigns/${campaignId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-bold">New Campaign</h1>

      <form onSubmit={handleSubmit} className="max-w-lg space-y-4 rounded-xl border bg-white p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">Campaign name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Goal</label>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          >
            <option value="种草">种草</option>
            <option value="带货">带货</option>
            <option value="涨粉">涨粉</option>
            <option value="品牌曝光">品牌曝光</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Platforms</label>
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
          <label className="mb-1 block text-sm font-medium">Upload video or images</label>
          <input
            type="file"
            accept="video/*,image/*"
            multiple
            onChange={(e) => setFiles(e.target.files)}
            className="w-full text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create & Run CEO"}
        </button>
      </form>
    </AppShell>
  );
}
