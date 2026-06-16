"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";

export default function ExportPage() {
  const params = useParams();
  const id = params.id as string;
  const [status, setStatus] = useState("none");
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/creatives/${id}/export`)
      .then((r) => r.json())
      .then((d) => {
        setStatus(d.status);
        setExportUrl(d.exportPackUrl);
      });
  }, [id]);

  async function triggerExport() {
    setLoading(true);
    await fetch(`/api/creatives/${id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution: "1080p" }),
    });
    const poll = setInterval(async () => {
      const res = await fetch(`/api/creatives/${id}/export`);
      const data = await res.json();
      setStatus(data.status);
      if (data.exportPackUrl) {
        setExportUrl(data.exportPackUrl);
        clearInterval(poll);
        setLoading(false);
      }
    }, 3000);
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-bold">Export</h1>
      <p className="mb-4 text-sm text-slate-500">Status: {status}</p>

      {exportUrl ? (
        <a
          href={exportUrl}
          download
          className="inline-block rounded-lg bg-primary px-4 py-2 text-sm text-white"
        >
          Download ZIP
        </a>
      ) : (
        <button
          onClick={triggerExport}
          disabled={loading}
          className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? "Exporting..." : "Generate Export Pack"}
        </button>
      )}
    </AppShell>
  );
}
