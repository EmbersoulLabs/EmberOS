"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";

export default function CampaignDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const id = params.id as string;
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch(`/api/campaigns/${id}`)
      .then((r) => r.json())
      .then(setData);
  }, [id]);

  const campaign = data?.campaign as Record<string, unknown> | undefined;
  const task = data?.task as Record<string, unknown> | null;
  const creative = data?.creative as Record<string, unknown> | null;

  return (
    <AppShell>
      <h1 className="mb-2 text-2xl font-bold">{(campaign?.name as string) ?? "Campaign"}</h1>
      {campaign && <StatusBadge status={campaign.status as string} />}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href={`/w/${slug}/campaigns/${id}/task`}
          className="rounded-lg bg-primary px-4 py-2 text-sm text-white"
        >
          Task Progress
        </Link>
        {creative && (
          <Link
            href={`/w/${slug}/creatives/${creative.id}`}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            View Creative
          </Link>
        )}
        {!task && (
          <button
            onClick={async () => {
              await fetch(`/api/campaigns/${id}/run`, { method: "POST" });
              window.location.reload();
            }}
            className="rounded-lg border border-primary px-4 py-2 text-sm text-primary"
          >
            Run CEO
          </button>
        )}
      </div>
    </AppShell>
  );
}
