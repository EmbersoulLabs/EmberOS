"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CAMPAIGN_CREATIVE_MODULES, type CampaignMarketingPlanContent } from "@ceo-agent/shared";
import { AppShell } from "@/components/AppShell";

type Plan = { id: string; revision: number; status: string; selectedModule: string | null; content: CampaignMarketingPlanContent };
type Iteration = { iteration: { id: string; sequenceNumber: number; state: string; version: number }; plans: Plan[] };

const emptyPlan: CampaignMarketingPlanContent = {
  objective: "", targetAudience: "", marketingApproach: "", creativeDirection: "",
  assetMode: "ZERO_ASSET", assetIds: [], missingAssets: [], recommendedModule: "VIDEO_STUDIO",
  rationale: "", expectedOutcome: "", businessFactRefs: ["companyName", "industryDisplayName"],
};

export default function MarketingPlanPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [content, setContent] = useState(emptyPlan);
  const [selectedModule, setSelectedModule] = useState("VIDEO_STUDIO");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const active = iterations.at(-1);
  const latest = active?.plans.at(-1);

  async function load() {
    const response = await fetch(`/api/campaigns/${id}/marketing-plans`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load Marketing Plans");
    setIterations(body.iterations ?? []);
    const plan = body.iterations?.at(-1)?.plans?.at(-1);
    if (plan?.content) setContent(plan.content);
  }
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [id]);

  async function command(body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/campaigns/${id}/marketing-plans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Marketing Plan command failed");
      await load();
      setMessage("Saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Command failed"); }
    finally { setBusy(false); }
  }

  return <AppShell><main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <div><Link className="text-sm font-semibold text-brand-blue" href={`/w/${slug}/campaigns/${id}`}>← Campaign</Link><h1 className="mt-2 text-2xl font-bold text-navy">Marketing Plan</h1><p className="mt-1 text-sm text-ink-secondary">Pre-production strategy only. Scripts, subtitles, timelines and final captions belong to later creative stages.</p></div>
    {!active ? <button disabled={busy} onClick={() => command({ action: "createIteration", idempotencyKey: crypto.randomUUID() })} className="rounded-lg bg-navy px-4 py-3 text-sm font-semibold text-white">Start content iteration</button> : <>
      <div className="rounded-xl border border-border bg-white p-4 text-sm">Iteration {active.iteration.sequenceNumber} · {active.iteration.state} · version {active.iteration.version}{latest ? ` · Plan revision ${latest.revision} (${latest.status})` : ""}</div>
      <fieldset disabled={busy || active.iteration.state !== "PLANNING"} className="space-y-4 rounded-2xl border border-border bg-white p-5">
        {[['objective','Objective'],['targetAudience','Target audience'],['marketingApproach','Marketing approach'],['creativeDirection','Creative direction'],['rationale','Rationale'],['expectedOutcome','Expected outcome']] .map(([key,label]) => <label key={key} className="block text-sm font-semibold text-navy">{label}<textarea value={String(content[key as keyof CampaignMarketingPlanContent] ?? "")} onChange={(event) => setContent({ ...content, [key]: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border border-border p-3 font-normal" /></label>)}
        <label className="block text-sm font-semibold text-navy">Planning path<select value={content.assetMode} onChange={(event) => setContent({ ...content, assetMode: event.target.value as "ZERO_ASSET" | "ASSET_BASED", assetIds: event.target.value === "ZERO_ASSET" ? [] : content.assetIds })} className="mt-1 w-full rounded-lg border border-border p-3"><option value="ZERO_ASSET">Zero asset</option><option value="ASSET_BASED">Use authorized Campaign assets</option></select></label>
        {content.assetMode === "ASSET_BASED" ? <label className="block text-sm font-semibold text-navy">Campaign Asset UUIDs<input value={content.assetIds.join(",")} onChange={(event) => setContent({ ...content, assetIds: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} className="mt-1 w-full rounded-lg border border-border p-3 font-normal" /></label> : null}
        <label className="block text-sm font-semibold text-navy">Recommended module<select value={content.recommendedModule} onChange={(event) => setContent({ ...content, recommendedModule: event.target.value as typeof content.recommendedModule })} className="mt-1 w-full rounded-lg border border-border p-3">{CAMPAIGN_CREATIVE_MODULES.map((module) => <option key={module}>{module}</option>)}</select></label>
        <button type="button" onClick={() => command({ action: "saveRevision", iterationId: active.iteration.id, expectedIterationVersion: active.iteration.version, expectedLatestRevision: latest?.revision ?? 0, idempotencyKey: crypto.randomUUID(), content })} className="rounded-lg bg-navy px-4 py-3 text-sm font-semibold text-white">Save new revision</button>
      </fieldset>
      {latest?.status === "DRAFT" ? <section className="rounded-2xl border border-border bg-white p-5"><h2 className="font-bold text-navy">Approve exact revision {latest.revision}</h2><p className="mt-1 text-sm text-ink-secondary">Your module choice is authoritative and may differ from the recommendation.</p><select value={selectedModule} onChange={(event) => setSelectedModule(event.target.value)} className="mt-3 rounded-lg border border-border p-3">{CAMPAIGN_CREATIVE_MODULES.map((module) => <option key={module}>{module}</option>)}</select><button disabled={busy} onClick={() => command({ action: "approve", iterationId: active.iteration.id, planId: latest.id, expectedRevision: latest.revision, expectedIterationVersion: active.iteration.version, selectedModule, idempotencyKey: crypto.randomUUID() })} className="ml-3 rounded-lg bg-brand-blue px-4 py-3 text-sm font-semibold text-white">Approve Plan</button></section> : null}
    </>}
    {message ? <p role="status" className="rounded-lg bg-surface-muted p-3 text-sm">{message}</p> : null}
  </main></AppShell>;
}
