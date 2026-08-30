"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AssetLibraryWorkbench } from "@/components/asset-library/AssetLibraryWorkbench";

export default function AssetLibraryPage() {
  const { slug } = useParams<{ slug: string }>();
  const [workspace, setWorkspace] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/me").then(async (response) => ({ ok: response.ok, body: await response.json() })).then(({ ok, body }) => {
    if (!ok) throw new Error(body.error ?? "Unable to load account");
    const match = body.workspaces?.find((item: { slug: string }) => item.slug === slug);
    if (!match) throw new Error("Workspace not found"); setWorkspace(match);
  }).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load Workspace")); }, [slug]);
  return <AppShell workspaceName={workspace?.name}>{error ? <p className="text-sm text-red-700">{error}</p> : workspace ? <AssetLibraryWorkbench workspaceId={workspace.id} /> : <p className="text-sm text-ink-secondary">Loading…</p>}</AppShell>;
}
