"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BusinessProfileEditor } from "@/components/business-profile/BusinessProfileEditor";
import { BusinessProfileSkeleton } from "@/components/business-profile/BusinessProfileSkeleton";
import { BusinessProfileModuleShell } from "@/components/business-profile/WorkspaceSettingsShell";
import {
  normalizeBusinessProfileRecord,
  type BusinessProfileRecord,
} from "@ceo-agent/shared";
import { useI18n } from "@/lib/i18n/provider";
import {
  classifyBusinessProfileHttpStatus,
  createEmptyBusinessProfileDraft,
  extractApiWarnings,
  type BusinessProfileApiWarning,
  type BusinessProfileLoadStatus,
} from "@/lib/business-profile-form";

export default function BusinessProfilePage() {
  const params = useParams();
  const slug = params.slug as string;
  const { t } = useI18n();

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [profile, setProfile] = useState<BusinessProfileRecord | null>(null);
  const [warnings, setWarnings] = useState<BusinessProfileApiWarning[]>([]);
  const [status, setStatus] = useState<BusinessProfileLoadStatus>("loading");
  const [error, setError] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [emptyStarted, setEmptyStarted] = useState(false);

  const loadProfile = useCallback(async () => {
    setStatus("loading");
    setError("");
    setEmptyStarted(false);
    try {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      if (!meRes.ok) throw new Error(me.error ?? t("error.loadAccount"));

      const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug) as
        | { id: string; name: string; orgId: string }
        | undefined;
      if (!ws) throw new Error(t("error.workspaceNotFound"));

      setWorkspaceId(ws.id);
      setOrgId(ws.orgId);
      setWorkspaceName(ws.name);

      const profileRes = await fetch(`/api/workspaces/${ws.id}/business-profile`);
      const profileData = await profileRes.json();
      const classified = classifyBusinessProfileHttpStatus(profileRes.status);

      if (classified === "forbidden") {
        setProfile(null);
        setWarnings([]);
        setStatus("forbidden");
        setError(t("businessProfile.error.forbidden"));
        return;
      }

      if (classified === "not_found") {
        setProfile(null);
        setWarnings([]);
        setStatus("empty");
        return;
      }

      if (classified !== "ok") {
        throw new Error(profileData.error ?? t("error.generic"));
      }

      setProfile(normalizeBusinessProfileRecord(profileData.profile));
      setWarnings(extractApiWarnings(profileData));
      setStatus("ready");
      setEditorKey((n) => n + 1);
    } catch (err) {
      setProfile(null);
      setWarnings([]);
      setStatus("error");
      setError(err instanceof Error ? err.message : t("error.generic"));
    }
  }, [slug, t]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const showEditor =
    workspaceId &&
    ((status === "ready" && profile) ||
      (status === "empty" && emptyStarted && orgId));

  const editorProfile =
    status === "empty" && emptyStarted && orgId && workspaceId
      ? createEmptyBusinessProfileDraft(orgId, workspaceId)
      : profile;

  return (
    <AppShell workspaceName={workspaceName}>
      <BusinessProfileModuleShell>
        {status === "loading" && <BusinessProfileSkeleton />}

        {(status === "forbidden" || status === "error") && (
          <p
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {error || t("error.generic")}
          </p>
        )}

        {status === "empty" && !emptyStarted && (
          <div className="rounded-xl border border-border/80 bg-surface p-6 shadow-card">
            <h1 className="text-xl font-semibold text-navy">{t("businessProfile.empty.title")}</h1>
            <p className="mt-2 text-sm text-ink-secondary">{t("businessProfile.empty.body")}</p>
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {t("businessProfile.qualityNotice")}
            </p>
            <button
              type="button"
              className="brand-btn-primary mt-5"
              onClick={() => setEmptyStarted(true)}
            >
              {t("businessProfile.empty.start")}
            </button>
          </div>
        )}

        {showEditor && editorProfile && workspaceId && (
          <BusinessProfileEditor
            key={editorKey}
            workspaceId={workspaceId}
            slug={slug}
            initialProfile={editorProfile}
            initialWarnings={warnings}
            onSynced={(next, nextWarnings) => {
              setProfile(next);
              setWarnings(nextWarnings);
              setStatus("ready");
            }}
            onRequestRefresh={() => {
              void loadProfile();
            }}
          />
        )}
      </BusinessProfileModuleShell>
    </AppShell>
  );
}
