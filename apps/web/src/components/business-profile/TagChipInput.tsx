"use client";

import { useState, type KeyboardEvent } from "react";

interface TagChipInputProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  required?: boolean;
  suggestions?: string[];
  hint?: string;
}

export function TagChipInput({
  label,
  values,
  onChange,
  placeholder,
  required,
  suggestions = [],
  hint,
}: TagChipInputProps) {
  const [draft, setDraft] = useState("");

  function addValue(raw: string) {
    const next = raw.trim();
    if (!next || values.includes(next)) return;
    onChange([...values, next]);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addValue(draft);
    } else if (e.key === "Backspace" && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  const unusedSuggestions = suggestions.filter((s) => !values.includes(s));

  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-navy">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {hint && <p className="mb-2 text-xs text-ink-secondary">{hint}</p>}
      <div className="flex min-h-[42px] flex-wrap gap-1.5 rounded-xl border border-border bg-surface px-2 py-2 focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/20">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-md bg-navy/10 px-2 py-0.5 text-xs font-medium text-navy"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-ink-secondary hover:text-red-600"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && addValue(draft)}
          placeholder={values.length === 0 ? placeholder : ""}
          className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
        />
      </div>
      {unusedSuggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unusedSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addValue(s)}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-ink-secondary hover:border-brand-blue/40 hover:text-navy"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
