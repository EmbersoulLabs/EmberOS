"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";

interface Campaign {
  id: string;
  name: string;
  status: string;
  goal?: string;
  platforms: string[];
}

export default function CampaignListPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");

  useEffect(() => {
    async function load() {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug);
      if (!ws) return;

      setWorkspaceId(ws.id);
      setWorkspaceName(ws.name);

      const res = await fetch(`/api/campaigns?workspaceId=${ws.id}`);
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
    }
    load();
  }, [slug]);

  return (
    <AppShell workspaceName={workspaceName}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <Link
          href={`/w/${slug}/campaigns/new`}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          New Campaign
        </Link>
      </div>

      <div className="space-y-3">
        {campaigns.map((c) => (
          <Link
            key={c.id}
            href={`/w/${slug}/campaigns/${c.id}`}
            className="flex items-center justify-between rounded-lg border bg-white p-4 hover:border-primary"
          >
            <div>
              <h2 className="font-medium">{c.name}</h2>
              <p className="text-sm text-slate-500">{c.goal}</p>
            </div>
            <StatusBadge status={c.status} />
          </Link>
        ))}
        {campaigns.length === 0 && (
          <p className="text-slate-500">No campaigns yet.</p>
        )}
      </div>
    </AppShell>
  );
}
