"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { CreativeContext } from "@ceo-agent/shared";

type DialogueLine = CreativeContext["narrativeContext"]["dialogue"][number];

export function PlanningDialogueEditor({ dialogue, disabled, onSave }: {
  dialogue: readonly DialogueLine[];
  disabled?: boolean;
  onSave: (dialogue: DialogueLine[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DialogueLine[]>(dialogue.map((line) => ({ ...line })));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(dialogue.map((line) => ({ ...line }))), [dialogue]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || disabled) return;
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  }

  return (
    <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={(event) => void submit(event)} data-testid="planning-dialogue-editor">
      <div><h3 className="text-sm font-semibold text-navy">Dialogue</h3><p className="text-xs text-ink-secondary">User-authored lines are authoritative. Save before Director Planning; this action makes no AI call.</p></div>
      {draft.map((line, index) => (
        <div key={index} className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[12rem_1fr_auto]">
          <input aria-label={`Dialogue ${index + 1} speaker`} className="rounded-lg border border-border px-3 py-2 text-sm" value={line.speaker} disabled={disabled || saving} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, speaker: event.target.value } : item))} />
          <textarea aria-label={`Dialogue ${index + 1} line`} className="min-h-20 rounded-lg border border-border px-3 py-2 text-sm" value={line.line} disabled={disabled || saving} onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, line: event.target.value } : item))} />
          <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm" disabled={disabled || saving} onClick={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm" disabled={disabled || saving} onClick={() => setDraft((current) => [...current, { speaker: "", line: "", beatHint: "" }])}>Add line</button>
        <button type="submit" className="brand-btn-primary" disabled={disabled || saving || draft.some((line) => !line.speaker.trim() || !line.line.trim())}>{saving ? "Saving…" : "Save dialogue"}</button>
      </div>
    </form>
  );
}
