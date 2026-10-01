"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LocalGenerationReview } from "./LocalGenerationReview";
import type {
  AiStoryLocalGenerationOutput,
  AiStoryLocalGenerationPackage,
} from "@ceo-agent/shared";

type Props = {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
  refreshToken?: number;
};

type ReadModel = {
  executionMode: "MANUAL_LOCAL";
  cloudVideoProviderCostUsd: 0;
  localGpuCost: string;
  packages: Array<Omit<AiStoryLocalGenerationPackage, "references"> & {
    downloadPath: string;
    references: Array<AiStoryLocalGenerationPackage["references"][number] & { downloadPath: string }>;
  }>;
  outputs: AiStoryLocalGenerationOutput[];
  mediaJobs: Array<{packageId:string;kind:string;state:string;errorCode:string|null}>;
};

export function LocalGenerationPanel({ campaignId, storyId, executionPlanId, refreshToken }: Props) {
  const [model, setModel] = useState<ReadModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPackageId, setBusyPackageId] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const base = `/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/${executionPlanId}`;

  const load = useCallback(async () => {
    const response = await fetch(`${base}/local-generation`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Local Generation packages could not be loaded");
    // An unavailable/mismatched local read model must not crash historical
    // cloud Scene review or the existing Final Story Result player.
    if (body?.executionMode !== "MANUAL_LOCAL" || !Array.isArray(body.packages)
      || !Array.isArray(body.outputs) || !Array.isArray(body.mediaJobs)) {
      throw new Error("Local Generation packages are temporarily unavailable");
    }
    setModel(body as ReadModel);
  }, [base]);

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Local Generation unavailable"));
  }, [load, refreshToken]);

  useEffect(() => {
    if (!model?.mediaJobs.some(job => job.state === "PENDING" || job.state === "RUNNING")) return;
    const timer = setInterval(() => { void load().catch(() => setError("Media validation is temporarily unavailable.")); }, 3000);
    return () => clearInterval(timer);
  }, [model, load]);

  async function upload(item: ReadModel["packages"][number], file: File) {
    setBusyPackageId(item.packageId);
    setError(null);
    try {
      const create = await fetch(`${base}/local-generation/${item.packageId}/output`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, fileSizeBytes: file.size }),
      });
      const authority = await create.json();
      if (!create.ok) throw new Error(authority.error ?? "Upload could not be authorized");
      const transfer = await fetch(authority.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "video/mp4" },
        body: file,
      });
      if (!transfer.ok) throw new Error("Local video upload failed");
      const confirm = await fetch(`${base}/local-generation/${item.packageId}/output`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: authority.assetId }),
      });
      const finalized = await confirm.json();
      if (!confirm.ok) throw new Error(finalized.error ?? "Uploaded video validation failed");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Local video upload failed");
    } finally {
      setBusyPackageId(null);
    }
  }

  if (!model || model.packages.length === 0) return null;
  const outputs = new Map(model.outputs.map((output) => [output.packageId, output]));

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-white p-5" data-testid="local-generation-panel">
      <div>
        <h2 className="text-lg font-bold text-navy">Local Generation</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Generate each Unit in ComfyUI, then upload its MP4 for QC and assembly.
        </p>
        <p className="mt-2 text-xs text-ink-secondary">
          Generation: Local / manual · Cloud video Provider cost: $0 · Local GPU cost: not metered by EmberOS V1
        </p>
      </div>
      {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
      <ol className="space-y-4">
        {model.packages.map((item) => {
          const output = outputs.get(item.packageId);
          const mediaJob = model.mediaJobs.filter(job => job.packageId === item.packageId && job.kind === "VALIDATE_OUTPUT").at(-1);
          const validating = mediaJob?.state === "PENDING" || mediaJob?.state === "RUNNING";
          return (
            <li key={item.packageId} className="rounded-xl border border-border p-4" data-testid={`local-generation-unit-${item.order}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-navy">Unit {item.order} of {model.packages.length}</h3>
                  <p className="text-sm text-ink-secondary">Recommended: {item.recommendedWorkflow.replaceAll("_", " ")}</p>
                  <p className="text-xs text-ink-secondary">{item.durationSec}s · {item.aspectRatio} · {item.generationMode}</p>
                </div>
                <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-navy">
                  {output ? (output.qcState === "PENDING" ? "Uploaded · awaiting QC" : output.qcState) : validating ? "Validating uploaded media…" : "Awaiting Local Generation"}
                </span>
              </div>
              <div className="mt-3 rounded-lg bg-surface-muted p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Prompt</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-navy">{item.prompt}</p>
              </div>
              {item.dialogue.length > 0 ? (
                <div className="mt-3 text-sm">
                  <p className="font-semibold text-navy">Dialogue</p>
                  {item.dialogue.map((line, index) => <p key={index}>{line.offscreen ? "Off-screen" : line.speakerLabel}: “{line.text}”</p>)}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => void navigator.clipboard.writeText(item.prompt)}>Copy Prompt</button>
                <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => void navigator.clipboard.writeText(item.instructions)}>Copy Full Instructions</button>
                <a className="rounded-lg border border-border px-3 py-1.5 text-sm" href={`${base}/${item.downloadPath}`}>Download Unit Package</a>
                {item.references.map((reference) => (
                  <a key={reference.assetId} className="rounded-lg border border-border px-3 py-1.5 text-sm" href={`${base}/${reference.downloadPath}`}>
                    Download {reference.authorityType.toLowerCase()} reference
                  </a>
                ))}
              </div>
              {!output ? (
                <div className="mt-3">
                  <input
                    ref={(node) => { fileRefs.current[item.packageId] = node; }}
                    type="file"
                    accept="video/mp4"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(item, file);
                    }}
                  />
                  {mediaJob?.state === "FAILED" ? <p role="alert">This upload could not be validated ({mediaJob.errorCode}). Choose a valid replacement MP4.</p> : null}
                  <button type="button" className="brand-btn-primary" disabled={validating || busyPackageId === item.packageId} onClick={() => fileRefs.current[item.packageId]?.click()}>
                    {busyPackageId === item.packageId ? "Uploading…" : "Upload Generated Video"}
                  </button>
                </div>
              ) : null}
              {output ? <LocalGenerationReview endpoint={`${base}/local-generation/${item.packageId}/result`} /> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
