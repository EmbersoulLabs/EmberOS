export type OperatorPhase = "idle" | "busy" | "success" | "error";

const UUID_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function copyActionLabel(base: "Copy Prompt" | "Copy Full Instructions", phase: OperatorPhase): string {
  if (phase === "busy") return "Copying…";
  if (phase === "success") return "Copied ✓";
  if (phase === "error") return "Copy failed";
  return base;
}

export function downloadActionLabel(base: string, phase: OperatorPhase): string {
  if (phase === "busy") return "Downloading…";
  if (phase === "success") return "Downloaded ✓";
  if (phase === "error") return "Download failed";
  return base;
}

export function uploadActionLabel(phase: "idle" | "preparing" | "uploading" | "validating" | "uploaded" | "failed"): string {
  if (phase === "preparing") return "Preparing upload…";
  if (phase === "uploading") return "Uploading…";
  if (phase === "validating") return "Validating media…";
  if (phase === "uploaded") return "Uploaded ✓";
  if (phase === "failed") return "Upload failed";
  return "Upload Generated Video";
}

export function qcActionLabel(phase: "idle" | "saving" | "evaluating" | "done" | "error"): string {
  if (phase === "saving") return "Saving QC evidence…";
  if (phase === "evaluating") return "Evaluating Post-QC…";
  if (phase === "done") return "Post-QC complete ✓";
  return "Save QC evidence";
}

export function postQcTerminalLabel(status: string | null | undefined): string {
  if (status === "POST_QC_PASS" || status === "POST_QC_WARN") return "Post-QC passed";
  if (status === "POST_QC_REJECT") return "Post-QC requires regeneration";
  if (status === "POST_QC_REQUIRES_HUMAN_CONFIRMATION") return "Post-QC complete ✓";
  return "Post-QC blocked";
}

export function approveActionLabel(phase: "idle" | "approving" | "approved" | "error"): string {
  if (phase === "approving") return "Saving your approval...";
  if (phase === "approved") return "Approved ✓";
  return "Approve inspected output";
}

export function continuityStatusLabel(input: {
  frameReady: boolean;
  jobState: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | null;
  phase: "idle" | "preparing" | "extracting" | "ready" | "error";
}): string {
  if (input.frameReady || input.phase === "ready" || input.jobState === "SUCCEEDED") return "Authorized end frame ready ✓";
  if (input.jobState === "FAILED" || input.phase === "error") return "Continuity extraction failed";
  if (input.jobState === "RUNNING") return "Extracting…";
  if (input.jobState === "PENDING" || input.phase === "preparing") return "Preparing continuity frame…";
  if (input.phase === "extracting") return "Extracting…";
  return "Not prepared";
}

export function operatorSpeakerLabel(label: string): string {
  return UUID_EXACT.test(label.trim()) ? "Authorized speaker" : label;
}

export function operatorRequirementLabel(item: { requirementId: string; summary: string }): string {
  if (item.requirementId === "character-identity") return "Preserve the authorized Character and pinned DNA.";
  if (item.requirementId === "product-identity") return "Preserve the authorized Product.";
  if (item.requirementId.startsWith("continuity:")) return `Continuity: ${item.summary}`;
  return item.summary.replace(new RegExp(UUID_TEXT.source, "gi"), "authorized record");
}

export function visibleOperatorRequirements<T extends { requirementId: string; visuallyObservable: boolean }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.visuallyObservable || seen.has(item.requirementId)) return false;
    seen.add(item.requirementId);
    return true;
  });
}

export async function writeOperatorClipboard(
  value: string,
  clipboard: { writeText(value: string): Promise<void> },
  fallback: (value: string) => boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await clipboard.writeText(value);
    return { ok: true };
  } catch (error) {
    let fallbackOk = false;
    try {
      fallbackOk = fallback(value);
    } catch {
      fallbackOk = false;
    }
    if (fallbackOk) return { ok: true };
    return { ok: false, message: error instanceof Error ? error.message : "Copy failed" };
  }
}

export function attachmentFilename(disposition: string | null, fallback: string): string {
  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(disposition ?? "");
  const raw = decodeURIComponent((match?.[1] ?? match?.[2] ?? match?.[3] ?? fallback).trim());
  const safe = raw.replace(/[/\\"]/g, "");
  return safe || fallback;
}

export async function fetchAuthorizedDownload(url: string, fetchImpl: typeof fetch): Promise<{ filename: string; blob: Blob }> {
  const response = await fetchImpl(url, { method: "GET", credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Download failed");
  return {
    filename: attachmentFilename(response.headers.get("content-disposition"), "download.bin"),
    blob: await response.blob(),
  };
}
