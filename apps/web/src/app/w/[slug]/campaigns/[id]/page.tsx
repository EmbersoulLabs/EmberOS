"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CampaignWorkspace } from "@/components/campaign/CampaignWorkspace";
import { AppShell } from "@/components/AppShell";
import { useI18n } from "@/lib/i18n/provider";

export default function CampaignWorkspacePage() {
  const params = useParams();
  const slug = params.slug as string;
  const campaignId = params.id as string;
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
        | { id: string; name?: string }
        | undefined;
      if (!ws) throw new Error(t("error.workspaceNotFound"));
      setWorkspaceId(ws.id);
      setWorkspaceName(ws.name ?? slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [slug, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <AppShell>
        <p className="text-sm text-red-600">{error}</p>
      </AppShell>
    );
  }

  if (!workspaceId) {
    return (
      <AppShell>
        <p className="text-sm text-ink-secondary">{t("campaign.workspace.loading")}</p>
      </AppShell>
    );
  }

  return (
    <CampaignWorkspace
      slug={slug}
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      campaignId={campaignId}
    />
  );
}
