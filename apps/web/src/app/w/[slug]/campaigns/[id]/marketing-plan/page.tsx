"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CAMPAIGN_CREATIVE_MODULES, type CampaignMarketingPlanContent } from "@ceo-agent/shared";
import { AppShell } from "@/components/AppShell";

type Plan = { id: string; revision: number; status: string; selectedModule: string | null; content: CampaignMarketingPlanContent };
type Iteration = { iteration: { id: string; sequenceNumber: number; state: string; version: number }; plans: Plan[] };
type Handoff = { id: string; approvedPlanId: string; selectedModule: string; destinationPath: string; assetMode: string; assetIds: string[] };
type Review = { id: string; revision: number; version: number; status: "PENDING_REVIEW"|"APPROVED"|"CHANGES_REQUESTED"; artifactType: string; artifactId: string; findings: Record<string,{status:string;detail:string}> };

const emptyPlan: CampaignMarketingPlanContent = {
  objective: "", targetAudience: "", keyMessage: "", marketingApproach: "", creativeDirection: "",
  assetMode: "ZERO_ASSET", assetIds: [], missingAssets: [], recommendedModule: "VIDEO_STUDIO",
  rationale: "", expectedOutcome: "", businessFactRefs: ["companyName", "industryDisplayName"],
};

const MISSING_MATERIAL_LABELS: Record<string, string> = {
  business_profile: "Business Profile (fill in your business description)",
  target_audience: "Target Audience (set it on this Campaign, or in your Business Profile)",
};

type AssetOption = { id: string; label: string };

export default function MarketingPlanPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [content, setContent] = useState(emptyPlan);
  const [selectedModule, setSelectedModule] = useState("VIDEO_STUDIO");
  const [message, setMessage] = useState("");
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [artifactId, setArtifactId] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [availableAssets, setAvailableAssets] = useState<AssetOption[]>([]);
  const [candidateArtifacts, setCandidateArtifacts] = useState<AssetOption[]>([]);
  const [assistMissing, setAssistMissing] = useState<string[] | null>(null);
  const active = iterations.at(-1);
  const latest = active?.plans.at(-1);

  async function load() {
    const response = await fetch(`/api/campaigns/${id}/marketing-plans`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to load Marketing Plans");
    setIterations(body.iterations ?? []);
    const current = body.iterations?.at(-1);
    const plan = current?.plans?.at(-1);
    if (plan?.content) setContent(plan.content);
    // A DRAFT plan has no selectedModule yet — default the approval choice to
    // whatever was just recommended, not a hardcoded module, so approving
    // without touching this field can't silently override the recommendation.
    setSelectedModule(plan?.selectedModule ?? plan?.content?.recommendedModule ?? "VIDEO_STUDIO");
    if (current?.iteration?.id) {
      const handoffResponse = await fetch(`/api/campaigns/${id}/creative-handoffs?iterationId=${current.iteration.id}`);
      const handoffBody = await handoffResponse.json();
      if (handoffResponse.ok) setHandoff(handoffBody.handoffs?.[0] ?? null);
      const reviewResponse = await fetch(`/api/campaigns/${id}/marketing-reviews?iterationId=${current.iteration.id}`);
      const reviewBody = await reviewResponse.json();
      if (reviewResponse.ok) setReviews(reviewBody.reviews ?? []);
    }
    const campaignResponse = await fetch(`/api/campaigns/${id}`);
    const campaignBody = await campaignResponse.json();
    if (campaignResponse.ok) {
      const assets = (campaignBody.assets ?? []) as { id: string; displayName?: string | null; originalFilename?: string | null }[];
      setAvailableAssets(assets.map((asset) => ({ id: asset.id, label: asset.displayName ?? asset.originalFilename ?? asset.id.slice(0, 8) })));
    }
  }

  async function generateWithAi() {
    setBusy(true); setMessage(""); setAssistMissing(null);
    try {
      const response = await fetch(`/api/campaigns/${id}/marketing-plans/assist`, { method: "POST" });
      const body = await response.json();
      if (!response.ok || body.ready === false) {
        if (body.missing) { setAssistMissing(body.missing); return; }
        throw new Error(body.error ?? "Marketing Plan assistance failed");
      }
      setContent({ ...content, ...body.proposal });
      setMessage("AI draft applied below. Review and edit before saving.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Marketing Plan assistance failed"); }
    finally { setBusy(false); }
  }
  async function reviewCommand(body:Record<string,unknown>){setBusy(true);setMessage("");try{const response=await fetch(`/api/campaigns/${id}/marketing-reviews`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error??"Marketing Review command failed");await load();setMessage("Marketing Review saved.");}catch(error){setMessage(error instanceof Error?error.message:"Marketing Review command failed");}finally{setBusy(false);}}

  async function continueToModule() {
    if (!active || !latest || latest.status !== "APPROVED") return;
    setBusy(true); setMessage("");
    try {
      let destination = handoff;
      if (!destination) {
        const response = await fetch(`/api/campaigns/${id}/creative-handoffs`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ iterationId: active.iteration.id, approvedPlanId: latest.id, idempotencyKey: `plan-handoff:${latest.id}` }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Creative Module handoff failed");
        destination = body.handoff;
        setHandoff(destination);
      }
      if (destination?.destinationPath) window.location.assign(destination.destinationPath);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Creative Module handoff failed"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, [id]);

  useEffect(() => {
    if (!handoff) { setCandidateArtifacts([]); return; }
    void (async () => {
      if (handoff.selectedModule === "VIDEO_STUDIO") {
        const response = await fetch(`/api/campaigns/${id}`);
        const body = await response.json();
        if (response.ok) {
          const creatives = (body.creatives ?? []) as { id: string; status?: string; platform?: string }[];
          setCandidateArtifacts(creatives.map((creative) => ({ id: creative.id, label: `${creative.platform ?? "Creative"} · ${creative.status ?? creative.id.slice(0, 8)}` })));
          return;
        }
      } else if (handoff.selectedModule === "AI_STORY") {
        const response = await fetch(`/api/campaigns/${id}/ai-stories`);
        const body = await response.json();
        if (response.ok) {
          const stories = (body.stories ?? []) as { id: string; title?: string; status?: string }[];
          setCandidateArtifacts(stories.map((story) => ({ id: story.id, label: `${story.title ?? story.id.slice(0, 8)} · ${story.status ?? ""}` })));
          return;
        }
      }
      setCandidateArtifacts([]);
    })();
  }, [handoff, id]);

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
      {active.iteration.state === "PLANNING" ? <section className="rounded-2xl border border-border bg-white p-5">
        <button type="button" disabled={busy} onClick={() => void generateWithAi()} className="rounded-lg bg-brand-blue px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Generating…" : "Generate with AI"}</button>
        <p className="mt-2 text-xs text-ink-secondary">Drafts this Plan from your Business Profile, Target Audience, Platform Strategy and attached Product material. You can edit everything below before saving.</p>
        {assistMissing ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-medium">Add this material first:</p><ul className="mt-1 list-disc pl-5">{assistMissing.map((key) => <li key={key}>{MISSING_MATERIAL_LABELS[key] ?? key}</li>)}</ul></div> : null}
      </section> : null}
      <fieldset disabled={busy || active.iteration.state !== "PLANNING"} className="space-y-4 rounded-2xl border border-border bg-white p-5">
        {[['objective','Objective'],['targetAudience','Target audience'],['keyMessage','Key message'],['marketingApproach','Marketing approach'],['creativeDirection','Creative direction'],['rationale','Rationale'],['expectedOutcome','Expected outcome']] .map(([key,label]) => <label key={key} className="block text-sm font-semibold text-navy">{label}<textarea value={String(content[key as keyof CampaignMarketingPlanContent] ?? "")} onChange={(event) => setContent({ ...content, [key]: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border border-border p-3 font-normal" /></label>)}
        <label className="block text-sm font-semibold text-navy">Planning path<select value={content.assetMode} onChange={(event) => setContent({ ...content, assetMode: event.target.value as "ZERO_ASSET" | "ASSET_BASED", assetIds: event.target.value === "ZERO_ASSET" ? [] : content.assetIds })} className="mt-1 w-full rounded-lg border border-border p-3"><option value="ZERO_ASSET">Zero asset</option><option value="ASSET_BASED">Use authorized Campaign assets</option></select></label>
        {content.assetMode === "ASSET_BASED" ? <fieldset className="space-y-1"><legend className="text-sm font-semibold text-navy">Campaign assets</legend>{availableAssets.length === 0 ? <p className="text-sm text-ink-secondary">No assets attached to this Campaign yet.</p> : availableAssets.map((asset) => <label key={asset.id} className="flex items-center gap-2 text-sm font-normal"><input type="checkbox" checked={content.assetIds.includes(asset.id)} onChange={(event) => setContent({ ...content, assetIds: event.target.checked ? [...content.assetIds, asset.id] : content.assetIds.filter((value) => value !== asset.id) })} />{asset.label}</label>)}</fieldset> : null}
        <label className="block text-sm font-semibold text-navy">Recommended module<select value={content.recommendedModule} onChange={(event) => setContent({ ...content, recommendedModule: event.target.value as typeof content.recommendedModule })} className="mt-1 w-full rounded-lg border border-border p-3">{CAMPAIGN_CREATIVE_MODULES.map((module) => <option key={module}>{module}</option>)}</select></label>
        <button type="button" onClick={() => command({ action: "saveRevision", iterationId: active.iteration.id, expectedIterationVersion: active.iteration.version, expectedLatestRevision: latest?.revision ?? 0, idempotencyKey: crypto.randomUUID(), content })} className="rounded-lg bg-navy px-4 py-3 text-sm font-semibold text-white">Save new revision</button>
      </fieldset>
      {latest?.status === "DRAFT" ? <section className="rounded-2xl border border-border bg-white p-5"><h2 className="font-bold text-navy">Approve exact revision {latest.revision}</h2><p className="mt-1 text-sm text-ink-secondary">Your module choice is authoritative and may differ from the recommendation.</p><select value={selectedModule} onChange={(event) => setSelectedModule(event.target.value)} className="mt-3 rounded-lg border border-border p-3">{CAMPAIGN_CREATIVE_MODULES.map((module) => <option key={module}>{module}</option>)}</select><button disabled={busy} onClick={() => command({ action: "approve", iterationId: active.iteration.id, planId: latest.id, expectedRevision: latest.revision, expectedIterationVersion: active.iteration.version, selectedModule, idempotencyKey: crypto.randomUUID() })} className="ml-3 rounded-lg bg-brand-blue px-4 py-3 text-sm font-semibold text-white">Approve Plan</button></section> : null}
      {latest?.status === "APPROVED" ? <section data-testid="approved-plan-handoff" className="rounded-2xl border border-brand-blue/30 bg-white p-5"><h2 className="font-bold text-navy">Approved Plan revision {latest.revision}</h2><p className="mt-1 text-sm text-ink-secondary">Selected module: <strong>{latest.selectedModule}</strong> · {latest.content.assetMode === "ASSET_BASED" ? `${latest.content.assetIds.length} authorized asset(s)` : "Zero-asset workflow"}</p><button disabled={busy} onClick={() => void continueToModule()} className="mt-4 rounded-lg bg-brand-blue px-4 py-3 text-sm font-semibold text-white">{handoff ? "Resume Creative Module" : "Continue to Creative Module"}</button></section> : null}
      {handoff && ["CREATIVE_IN_PROGRESS","REVISION_REQUIRED"].includes(active.iteration.state) ? <section className="rounded-2xl border border-border bg-white p-5"><h2 className="font-bold text-navy">Submit actual creative artifact</h2><p className="mt-1 text-sm text-ink-secondary">Only a completed output from {handoff.selectedModule} is accepted. This does not start generation.</p>{candidateArtifacts.length > 0 ? <select aria-label="Artifact" value={artifactId} onChange={e=>setArtifactId(e.target.value)} className="mt-3 w-full rounded-lg border border-border p-3"><option value="">Select a completed artifact…</option>{candidateArtifacts.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifact.label}</option>)}</select> : <input aria-label="Artifact ID" value={artifactId} onChange={e=>setArtifactId(e.target.value)} placeholder="Completed artifact UUID" className="mt-3 w-full rounded-lg border border-border p-3"/>}<button disabled={busy||!artifactId} onClick={()=>void reviewCommand({action:"create",handoffId:handoff.id,artifactId,idempotencyKey:`review:${handoff.id}:${artifactId}`})} className="mt-3 rounded-lg bg-brand-blue px-4 py-3 text-sm font-semibold text-white">Start Marketing Review</button></section>:null}
      {reviews.at(-1) ? (()=>{const review=reviews.at(-1)!;return <section className="rounded-2xl border border-border bg-white p-5"><h2 className="font-bold text-navy">Marketing Review revision {review.revision}: {review.status}</h2><p className="mt-1 text-sm text-ink-secondary">{review.artifactType} · immutable artifact {review.artifactId}</p><ul className="mt-3 space-y-2 text-sm">{Object.entries(review.findings).map(([name,finding])=><li key={name}><strong>{name}</strong>: {finding.status} — {finding.detail}</li>)}</ul>{review.status==="PENDING_REVIEW"?<><textarea aria-label="Review note" value={decisionNote} onChange={e=>setDecisionNote(e.target.value)} placeholder="Optional human review note" className="mt-3 w-full rounded-lg border border-border p-3"/><div className="mt-3 flex gap-3"><button disabled={busy} onClick={()=>void reviewCommand({action:"decide",reviewId:review.id,expectedVersion:review.version,decision:"APPROVED",note:decisionNote,idempotencyKey:crypto.randomUUID()})} className="rounded-lg bg-brand-blue px-4 py-3 text-sm font-semibold text-white">Approve actual artifact</button><button disabled={busy} onClick={()=>void reviewCommand({action:"decide",reviewId:review.id,expectedVersion:review.version,decision:"CHANGES_REQUESTED",note:decisionNote,idempotencyKey:crypto.randomUUID()})} className="rounded-lg border border-border px-4 py-3 text-sm font-semibold">Request changes</button></div></>:null}{active.iteration.state==="SOCIAL_CONTENT_READY"?<Link href={`/w/${slug}/campaigns/${id}/social-content`} className="mt-3 inline-block rounded-lg bg-brand-blue px-4 py-3 font-semibold text-white">Prepare Social Content</Link>:null}</section>})():null}
    </>}
    {message ? <p role="status" className="rounded-lg bg-surface-muted p-3 text-sm">{message}</p> : null}
  </main></AppShell>;
}
