"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { AppShell, StatusBadge } from "@/components/AppShell";

const STEPS = [
  "parse_intent",
  "ceo_plan",
  "vision_analyze",
  "copy_generate",
  "edit_director_plan",
  "ffmpeg_render",
  "compliance_check",
  "human_review",
];

export default function TaskProgressContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const campaignId = params.id as string;
  const taskIdParam = searchParams.get("taskId");

  const [task, setTask] = useState<Record<string, unknown> | null>(null);
  const [creativeId, setCreativeId] = useState<string | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function poll() {
      const campRes = await fetch(`/api/campaigns/${campaignId}`);
      const campData = await campRes.json();
      const taskId = taskIdParam ?? campData.task?.id;
      if (!taskId) return;

      const res = await fetch(`/api/tasks/${taskId}`);
      const data = await res.json();
      setTask(data.task);
      if (data.creative?.id) setCreativeId(data.creative.id);

      if (data.task?.status === "completed" || data.task?.status === "failed") {
        clearInterval(interval);
      }
    }

    poll();
    interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [campaignId, taskIdParam]);

  const progress = (task?.stepProgress ?? {}) as Record<
    string,
    { status: string; error?: string }
  >;

  return (
    <AppShell>
      <h1 className="mb-2 text-2xl font-bold">CEO Pipeline</h1>
      {task && <StatusBadge status={task.status as string} />}

      <div className="mt-6 space-y-3">
        {STEPS.map((step) => {
          const s = progress[step];
          const status = s?.status ?? "pending";
          return (
            <div
              key={step}
              className="flex items-center justify-between rounded-lg border bg-white px-4 py-3"
            >
              <span className="font-mono text-sm">{step}</span>
              <StatusBadge status={status} />
            </div>
          );
        })}
      </div>

      {creativeId && (
        <div className="mt-6 flex gap-3">
          <Link
            href={`/w/${slug}/creatives/${creativeId}`}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-white"
          >
            View Creative
          </Link>
          <Link
            href={`/w/${slug}/reviews`}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Review Queue
          </Link>
        </div>
      )}
    </AppShell>
  );
}
