"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AssetLibraryWorkbench } from "@/components/asset-library/AssetLibraryWorkbench";
import { useI18n } from "@/lib/i18n/provider";

export default function AssetLibraryPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useI18n();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      if (!meRes.ok) throw new Error(me.error ?? t("error.loadAccount"));
      const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug) as
        | { id: string; name: string }
        | undefined;
      if (!ws) throw new Error(t("error.workspaceNotFound"));
      setWorkspaceId(ws.id);
      setWorkspaceName(ws.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [slug, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell workspaceName={workspaceName || undefined}>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!workspaceId && !error ? (
        <p className="text-sm text-ink-secondary">Loading…</p>
      ) : null}
      {workspaceId ? <AssetLibraryWorkbench workspaceId={workspaceId} /> : null}
    </AppShell>
  );
}
