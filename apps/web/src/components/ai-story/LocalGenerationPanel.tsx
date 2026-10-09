"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LocalGenerationReview } from "./LocalGenerationReview";
import {
  copyActionLabel,
  downloadActionLabel,
  fetchAuthorizedDownload,
  operatorSpeakerLabel,
  uploadActionLabel,
  writeOperatorClipboard,
  type OperatorPhase,
} from "./local-generation-operator-feedback";
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

type UploadPhase = "idle" | "preparing" | "uploading" | "validating" | "uploaded" | "failed";

function spokenLanguageLabel(dialogue: ReadonlyArray<{ locale?: string }>): string {
  const locales = dialogue.flatMap((line) => line.locale ? [line.locale] : []).filter((locale, index, all) => all.indexOf(locale) === index);
  if (locales.length > 0) return locales.join(", ");
  return dialogue.length > 0 ? "Not recorded on this package" : "No spoken dialogue";
}

function localReferenceRole(
  reference: AiStoryLocalGenerationPackage["references"][number],
): string {
  return "role" in reference ? reference.role : reference.authorityType;
}

function fallbackCopy(value: string): boolean {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "true");
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  return copied;
}

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
  const [copyPhase, setCopyPhase] = useState<Record<string, OperatorPhase>>({});
  const [downloadPhase, setDownloadPhase] = useState<Record<string, OperatorPhase>>({});
  const [uploadPhase, setUploadPhase] = useState<Record<string, UploadPhase>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const uploadLock = useRef<Set<string>>(new Set());
  const base = `/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/${executionPlanId}`;

  const load = useCallback(async () => {
    const response = await fetch(`${base}/local-generation`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Local Generation packages could not be loaded");
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
    if (!model) return;
    for (const job of model.mediaJobs) {
      if (job.kind !== "VALIDATE_OUTPUT" || job.state !== "FAILED") continue;
      uploadLock.current.delete(job.packageId);
      setUploadPhase((current) => current[job.packageId] === "failed" ? current : { ...current, [job.packageId]: "failed" });
    }
    if (!model.mediaJobs.some(job => job.state === "PENDING" || job.state === "RUNNING")) return;
    const timer = setInterval(() => { void load().catch(() => setError("Media validation is temporarily unavailable.")); }, 3000);
    return () => clearInterval(timer);
  }, [model, load]);

  async function copyText(key: string, value: string) {
    if (copyPhase[key] === "busy") return;
    setCopyPhase((current) => ({ ...current, [key]: "busy" }));
    setError(null);
    const result = await writeOperatorClipboard(value, navigator.clipboard, fallbackCopy);
    if (!result.ok) {
      setCopyPhase((current) => ({ ...current, [key]: "error" }));
      setError(result.message || "Copy failed");
      return;
    }
    setCopyPhase((current) => ({ ...current, [key]: "success" }));
    window.setTimeout(() => setCopyPhase((current) => ({ ...current, [key]: "idle" })), 1600);
  }

  async function downloadFile(key: string, url: string) {
    if (downloadPhase[key] === "busy") return;
    setDownloadPhase((current) => ({ ...current, [key]: "busy" }));
    setError(null);
    try {
      const file = await fetchAuthorizedDownload(url, fetch);
      const objectUrl = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setDownloadPhase((current) => ({ ...current, [key]: "success" }));
      window.setTimeout(() => setDownloadPhase((current) => ({ ...current, [key]: "idle" })), 1600);
    } catch (cause) {
      setDownloadPhase((current) => ({ ...current, [key]: "error" }));
      setError(cause instanceof Error ? cause.message : "Download failed");
    }
  }

  async function upload(item: ReadModel["packages"][number], file: File) {
    if (uploadLock.current.has(item.packageId)) return;
    uploadLock.current.add(item.packageId);
    setError(null);
    const setPhase = (phase: UploadPhase) => setUploadPhase((current) => ({ ...current, [item.packageId]: phase }));
    try {
      setPhase("preparing");
      const create = await fetch(`${base}/local-generation/${item.packageId}/output`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, mimeType: file.type || "video/mp4", fileSizeBytes: file.size }),
      });
      const authority = await create.json();
      if (!create.ok) throw new Error(authority.error ?? "Upload could not be authorized");
      setPhase("uploading");
      const transfer = await fetch(authority.uploadUrl, {
        method: "PUT",
        headers: { "content-type": "video/mp4" },
        body: file,
      });
      if (!transfer.ok) throw new Error("Local video upload failed");
      setPhase("validating");
      const confirm = await fetch(`${base}/local-generation/${item.packageId}/output`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: authority.assetId }),
      });
      const finalized = await confirm.json();
      if (!confirm.ok) throw new Error(finalized.error ?? "Uploaded video validation failed");
      await load();
      setPhase("uploaded");
    } catch (cause) {
      setPhase("failed");
      uploadLock.current.delete(item.packageId);
      setError(cause instanceof Error ? cause.message : "Local video upload failed");
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
          const phase = validating ? "validating" : (uploadPhase[item.packageId] ?? "idle");
          const uploadBusy = phase === "preparing" || phase === "uploading" || phase === "validating";
          const promptKey = `${item.packageId}:prompt`;
          const instructionsKey = `${item.packageId}:instructions`;
          const packageKey = `${item.packageId}:package`;
          return (
            <li key={item.packageId} className="rounded-xl border border-border p-4" data-testid={`local-generation-unit-${item.order}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-navy">Unit {item.order} of {model.packages.length}</h3>
                  <p className="text-sm text-ink-secondary">Recommended workflow: {item.recommendedWorkflow.replaceAll("_", " ")}</p>
                  <p className="text-xs text-ink-secondary">{item.durationSec}s · {item.aspectRatio} · {item.generationMode}</p>
                  <p className="text-xs text-ink-secondary">Language: {spokenLanguageLabel(item.dialogue)}</p>
                  <p className="text-xs text-ink-secondary">Audio mode: {item.generateAudio ? "Native synchronized audiovisual" : "Video only"}</p>
                </div>
                <span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-navy">
                  {output ? (output.qcState === "PENDING" ? "Uploaded · awaiting QC" : output.qcState) : phase === "validating" ? "Validating media…" : "Awaiting Local Generation"}
                </span>
              </div>
              <div className="mt-3 rounded-lg bg-surface-muted p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Prompt</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-navy">{item.prompt}</p>
              </div>
              {item.dialogue.length > 0 ? (
                <div className="mt-3 text-sm">
                  <p className="font-semibold text-navy">Dialogue</p>
                  {item.dialogue.map((line, index) => <p key={index}>{line.offscreen ? "Off-screen" : "On-screen"} {operatorSpeakerLabel(line.speakerLabel)}: “{line.text}”</p>)}
                </div>
              ) : null}
              {item.references.length > 0 ? (
                <ul className="mt-3 text-sm text-navy">
                  {item.references.map((reference) => (
                    <li key={reference.assetId}>Reference role: {localReferenceRole(reference).replaceAll("_", " ")} — {reference.displayName}</li>
                  ))}
                </ul>
              ) : null}
              <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-xs text-navy" data-testid={`local-generation-instructions-${item.order}`}>{item.instructions}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="brand-btn-primary" disabled={copyPhase[instructionsKey] === "busy"} onClick={() => void copyText(instructionsKey, item.instructions)}>{copyActionLabel("Copy Full Instructions", copyPhase[instructionsKey] ?? "idle")}</button>
                <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" disabled={copyPhase[promptKey] === "busy"} onClick={() => void copyText(promptKey, item.prompt)}>{copyActionLabel("Copy Prompt", copyPhase[promptKey] ?? "idle")}</button>
                <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" disabled={downloadPhase[packageKey] === "busy"} onClick={() => void downloadFile(packageKey, `${base}/${item.downloadPath}`)}>{downloadActionLabel("Download Unit Package", downloadPhase[packageKey] ?? "idle")}</button>
                {item.references.map((reference) => {
                  const referenceKey = `${item.packageId}:reference:${reference.assetId}`;
                  const label = `Download ${localReferenceRole(reference).toLowerCase()} reference`;
                  return (
                    <button key={reference.assetId} type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" disabled={downloadPhase[referenceKey] === "busy"} onClick={() => void downloadFile(referenceKey, `${base}/${reference.downloadPath}`)}>
                      {downloadActionLabel(label, downloadPhase[referenceKey] ?? "idle")}
                    </button>
                  );
                })}
              </div>
              {!output ? (
                <div className="mt-3">
                  <input
                    ref={(node) => { fileRefs.current[item.packageId] = node; }}
                    type="file"
                    accept="video/mp4"
                    className="hidden"
                    onChange={(event) => {
                      const selected = event.target.files?.[0];
                      event.target.value = "";
                      if (selected) void upload(item, selected);
                    }}
                  />
                  {mediaJob?.state === "FAILED" || phase === "failed" ? <p role="alert">This upload could not be validated ({mediaJob?.errorCode ?? "upload failed"}). Choose a valid replacement MP4.</p> : null}
                  <button type="button" className="brand-btn-primary" disabled={uploadBusy} onClick={() => { if (!uploadBusy) fileRefs.current[item.packageId]?.click(); }}>
                    {uploadActionLabel(phase)}
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
