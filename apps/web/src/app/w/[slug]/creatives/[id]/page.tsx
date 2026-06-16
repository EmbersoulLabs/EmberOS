"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";

interface CopyVariant {
  id: string;
  hook: string;
  body: string;
  cta: string;
  title: string;
  tags: string[];
  platform: string;
}

export default function CreativePreviewPage() {
  const params = useParams();
  const slug = params.slug as string;
  const id = params.id as string;

  const [creative, setCreative] = useState<Record<string, unknown> | null>(null);
  const [activeVariant, setActiveVariant] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<CopyVariant>>({});

  useEffect(() => {
    fetch(`/api/creatives/${id}`)
      .then((r) => r.json())
      .then((d) => setCreative(d.creative));
  }, [id]);

  const variants = (creative?.copyVariants ?? []) as CopyVariant[];
  const variant = variants[activeVariant];

  async function saveCopy() {
    if (!variant) return;
    const res = await fetch(`/api/creatives/${id}/copy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantId: variant.id, ...editForm }),
    });
    const data = await res.json();
    if (data.creative) setCreative(data.creative);
    setEditMode(false);
  }

  async function submitReview() {
    await fetch(`/api/creatives/${id}/submit-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "internal" }),
    });
    alert("Submitted for internal review");
  }

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Creative Preview</h1>
        {creative && <StatusBadge status={creative.status as string} />}
      </div>

      {creative?.videoUrl ? (
        <video
          src={creative.videoUrl as string}
          controls
          className="mb-6 max-h-96 w-full rounded-lg bg-black"
        />
      ) : (
        <div className="mb-6 flex h-48 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
          Video rendering...
        </div>
      )}

      <div className="mb-4 flex gap-2">
        {variants.map((v, i) => (
          <button
            key={v.id}
            onClick={() => setActiveVariant(i)}
            className={`rounded px-3 py-1 text-sm ${
              i === activeVariant ? "bg-primary text-white" : "border"
            }`}
          >
            {v.platform} — {v.id}
          </button>
        ))}
      </div>

      {variant && !editMode && (
        <div className="rounded-lg border bg-white p-4">
          <p className="text-sm font-medium text-primary">{variant.hook}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{variant.body}</p>
          <p className="mt-2 text-sm font-medium">{variant.cta}</p>
          <p className="mt-2 text-xs text-slate-500">{variant.tags?.join(" ")}</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                setEditForm(variant);
                setEditMode(true);
              }}
              className="rounded border px-3 py-1 text-sm"
            >
              Edit copy
            </button>
            <button onClick={submitReview} className="rounded bg-primary px-3 py-1 text-sm text-white">
              Submit review
            </button>
            <Link
              href={`/w/${slug}/creatives/${id}/export`}
              className="rounded border px-3 py-1 text-sm"
            >
              Export
            </Link>
          </div>
        </div>
      )}

      {editMode && (
        <div className="space-y-3 rounded-lg border bg-white p-4">
          {(["hook", "body", "cta", "title"] as const).map((field) => (
            <div key={field}>
              <label className="text-sm font-medium capitalize">{field}</label>
              <textarea
                value={(editForm[field] as string) ?? ""}
                onChange={(e) => setEditForm({ ...editForm, [field]: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                rows={field === "body" ? 4 : 2}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={saveCopy} className="rounded bg-primary px-3 py-1 text-sm text-white">
              Save
            </button>
            <button onClick={() => setEditMode(false)} className="rounded border px-3 py-1 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
