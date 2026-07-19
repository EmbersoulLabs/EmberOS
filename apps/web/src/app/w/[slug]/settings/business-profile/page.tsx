"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BusinessProfileEditor } from "@/components/business-profile/BusinessProfileEditor";
import { BusinessProfileSkeleton } from "@/components/business-profile/BusinessProfileSkeleton";
import { WorkspaceSettingsShell } from "@/components/business-profile/WorkspaceSettingsShell";
import { normalizeBusinessProfileRecord, type BusinessProfileRecord } from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";

export default function BusinessProfileSettingsPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useI18n();

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [profile, setProfile] = useState<BusinessProfileRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const meRes = await fetch("/api/me");
        const me = await meRes.json();
        if (!meRes.ok) throw new Error(me.error ?? t("error.loadAccount"));

        const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug);
        if (!ws) throw new Error(t("error.workspaceNotFound"));

        setWorkspaceId(ws.id);
        setWorkspaceName(ws.name);

        const profileRes = await fetch(`/api/workspaces/${ws.id}/business-profile`);
        const profileData = await profileRes.json();
        if (!profileRes.ok) throw new Error(profileData.error ?? t("error.generic"));

        setProfile(normalizeBusinessProfileRecord(profileData.profile));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("error.generic"));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug, t]);

  return (
    <AppShell workspaceName={workspaceName}>
      <WorkspaceSettingsShell slug={slug}>
        {loading && <BusinessProfileSkeleton />}
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}
        {!loading && profile && workspaceId && (
          <BusinessProfileEditor workspaceId={workspaceId} slug={slug} initialProfile={profile} />
        )}
      </WorkspaceSettingsShell>
    </AppShell>
  );
}
