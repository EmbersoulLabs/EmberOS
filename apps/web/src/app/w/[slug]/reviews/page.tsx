"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";

interface ReviewItem {
  review: { id: string; decision: string; comment?: string };
  creative: { id: string; videoUrl?: string; status: string };
  campaign: { name: string };
}

export default function ReviewQueuePage() {
  const params = useParams();
  const slug = params.slug as string;
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const meRes = await fetch("/api/me");
      const me = await meRes.json();
      const ws = me.workspaces?.find((w: { slug: string }) => w.slug === slug);
      if (!ws) return;
      setWorkspaceId(ws.id);

      const res = await fetch(`/api/reviews?workspaceId=${ws.id}&status=pending`);
      const data = await res.json();
      setReviews(data.reviews ?? []);
    }
    load();
  }, [slug]);

  async function decide(reviewId: string, decision: "approved" | "rejected") {
    const comment = decision === "rejected" ? prompt("Rejection reason:") : undefined;
    await fetch(`/api/reviews/${reviewId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, comment }),
    });
    setReviews((prev) => prev.filter((r) => r.review.id !== reviewId));
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-bold">Review Queue</h1>

      {reviews.length === 0 ? (
        <p className="text-slate-500">No pending reviews.</p>
      ) : (
        <div className="space-y-4">
          {reviews.map(({ review, creative, campaign }) => (
            <div key={review.id} className="rounded-lg border bg-white p-4">
              <h2 className="font-medium">{campaign.name}</h2>
              {creative.videoUrl && (
                <video src={creative.videoUrl} controls className="mt-2 max-h-40 rounded" />
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => decide(review.id, "approved")}
                  className="rounded bg-green-600 px-3 py-1 text-sm text-white"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(review.id, "rejected")}
                  className="rounded bg-red-600 px-3 py-1 text-sm text-white"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
