"use client";
import { useEffect, useState } from "react";
import { postQcAllowsHumanApproval, type AiStoryPostGenerationQcEvaluation, type AiStoryPostQcRequirement } from "@ceo-agent/shared";

type Model = { generationResultId:string; playbackUrl:string|null; requirements:AiStoryPostQcRequirement[]; evaluation:AiStoryPostGenerationQcEvaluation|null; decision:{decision:string}|null; continuityFrame:unknown|null };
/** Explicit operator observations, followed by a separate Human approval. Upload never supplies these. */
export function LocalGenerationReview({ endpoint }: { endpoint:string }) {
  const [model,setModel]=useState<Model|null>(null);
  const [signals,setSignals]=useState<Record<string,"SATISFIED"|"VIOLATED"|"UNCERTAIN">>({});
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  async function load() { const response=await fetch(endpoint,{cache:"no-store"});const body=await response.json();if(!response.ok) throw new Error(body.error??"Review unavailable");setModel(body); }
  useEffect(()=>{void load().catch(cause=>setError(String(cause)));},[endpoint]);
  useEffect(()=>{
    if(model?.decision?.decision!=="APPROVED"||model.continuityFrame)return;
    const timer=setInterval(()=>{void load().catch(()=>{});},3000);
    return()=>clearInterval(timer);
  },[endpoint,model?.decision?.decision,model?.continuityFrame]);
  async function submit(approve:boolean) {
    if(!model)return;
    setBusy(true);setError(null);
    try {
      const observations=model.requirements.filter(item=>item.visuallyObservable).map(item=>({
        observationId:crypto.randomUUID(),evidenceVersion:"ai-story-visual-evidence.v1",requirementId:item.requirementId,
        source:"HUMAN_SUPPLIED_EVIDENCE",summary:`Operator inspection: ${item.summary}`,
        observableSignal:signals[item.requirementId]??"UNCERTAIN",confidence:{level:"HIGH",score:1,evidenceQuality:"ADEQUATE"},
        timeRangeMs:null,subjects:[],artifactSeverity:null,subjectiveTasteOnly:false,
      }));
      const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(approve?{action:"APPROVE",rationale:"I inspected this exact generated output and approve it after Post-QC."}:{action:"EVALUATE",observations})});
      const body=await response.json();if(!response.ok)throw new Error(body.error??"Review could not be saved");await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"Review failed");}finally{setBusy(false);}
  }
  if(!model)return error?<p role="alert">{error}</p>:<p>Loading generated-output review…</p>;
  if(model.decision)return <div className="mt-3 text-sm"><p className="font-semibold">Human review: {model.decision.decision}</p>
    {model.continuityFrame?<p>Authorized end frame ready for the next Unit.</p>:<button disabled={busy} type="button" className="rounded border px-3 py-2" onClick={()=>{
      setBusy(true);void fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"DERIVE_CONTINUITY"})}).then(async response=>{if(!response.ok)throw new Error("Continuity extraction unavailable; approved result remains preserved.");await load();}).catch(cause=>setError(String(cause))).finally(()=>setBusy(false));
    }}>Prepare continuity frame</button>}{error?<p role="alert">{error}</p>:null}</div>;
  return <div className="mt-4 space-y-3 rounded-lg border border-border p-3">
    <h4 className="font-semibold">Review local output</h4>
    {model.playbackUrl?<video controls preload="metadata" className="max-h-96 w-full" src={model.playbackUrl} />:<p>The exact uploaded media is temporarily unavailable for playback.</p>}
    <p className="text-sm">Inspect your exact uploaded video. Technical validation alone does not verify Character, Product or visual continuity.</p>
    {model.requirements.filter(item=>item.visuallyObservable).map(item=><label key={item.requirementId} className="block text-sm">{item.summary}
      <select className="ml-2 rounded border p-1" value={signals[item.requirementId]??"UNCERTAIN"} onChange={event=>{const value=event.target.value;if(value==="SATISFIED"||value==="VIOLATED"||value==="UNCERTAIN")setSignals(current=>({...current,[item.requirementId]:value}));}}>
        <option value="UNCERTAIN">Not verified</option><option value="SATISFIED">Verified</option><option value="VIOLATED">Requirement violated</option>
      </select></label>)}
    <button type="button" disabled={busy} onClick={()=>void submit(false)} className="rounded border px-3 py-2">Save QC evidence</button>
    {model.evaluation?<><p>Post-QC: {model.evaluation.aggregateStatus}</p>{model.evaluation.findings.filter(item=>item.result!=="PASS").map(item=><p key={item.findingId} className="text-sm">{item.reason}</p>)}
      {model.evaluation.aggregateStatus==="POST_QC_REJECT"?<p>Local regeneration required. Refresh the packages to download the retry instructions. No cloud fallback is used.</p>:null}
      <button type="button" disabled={busy||!model.evaluation.eligibleForHumanReview||!postQcAllowsHumanApproval(model.evaluation)} onClick={()=>void submit(true)} className="brand-btn-primary">Approve inspected output</button>
    </>:null}
    {error?<p role="alert" className="text-red-700">{error}</p>:null}
  </div>;
}
