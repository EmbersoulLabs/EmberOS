import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { LocalMediaJob } from "@ceo-agent/db";
import { runAiStoryLocalMediaWorkerCycle } from "../apps/worker/src/ai-story-local-media-worker-cycle";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const job:LocalMediaJob={jobId:id(1),workspaceId:id(2),executionPlanId:id(3),packageId:id(4),actorUserId:id(5),
  kind:"VALIDATE_OUTPUT",assetId:id(6),generationResultId:null,state:"RUNNING",claimToken:id(7),errorCode:null};
describe("Local CPU media Worker boundary",()=>{
  it("does not process or dispatch anything without a durable claim",async()=>{
    const process=vi.fn(),finish=vi.fn();
    expect(await runAiStoryLocalMediaWorkerCycle({repository:{claim:async()=>null,finish},process})).toEqual({status:"IDLE"});
    expect(process).not.toHaveBeenCalled();expect(finish).not.toHaveBeenCalled();
  });
  it("processes only the exact claimed identity and finishes with its claim fence",async()=>{
    const process=vi.fn(async()=>{}),finish=vi.fn(async()=>{});
    expect((await runAiStoryLocalMediaWorkerCycle({repository:{claim:async()=>job,finish},process})).status).toBe("SUCCEEDED");
    expect(process).toHaveBeenCalledTimes(1);expect(process).toHaveBeenCalledWith(job);expect(finish).toHaveBeenCalledTimes(1);expect(finish).toHaveBeenCalledWith(job,null);
  });
  it("validation failure records a typed local failure without a Provider retry",async()=>{
    const finish=vi.fn(async()=>{});
    const result=await runAiStoryLocalMediaWorkerCycle({repository:{claim:async()=>job,finish},process:async()=>{throw new Error("LOCAL_GENERATION_NATIVE_AUDIO_REQUIRED");}});
    expect(result.status).toBe("FAILED");expect(finish).toHaveBeenCalledTimes(1);expect(finish).toHaveBeenCalledWith(job,"LOCAL_GENERATION_NATIVE_AUDIO_REQUIRED");
  });
  it("does not expose storage error payloads or credentials",async()=>{
    const finish=vi.fn(async()=>{});
    await runAiStoryLocalMediaWorkerCycle({repository:{claim:async()=>job,finish},process:async()=>{throw new Error("unsafe https://private.example/?token=secret");}});
    expect(finish).toHaveBeenCalledTimes(1);expect(finish).toHaveBeenCalledWith(job,"LOCAL_MEDIA_PROCESSING_FAILED");
  });
  it("Web requests CPU jobs, not FFmpeg or paid Provider submission",()=>{
    for(const path of [
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/output/route.ts",
      "apps/web/src/lib/ai-story-generation-result-continuity.ts",
    ]) {
      const source=readFileSync(path,"utf8");
      expect(source).toContain("AiStoryLocalMediaJobRepository");
      expect(source).not.toMatch(/validateLocalGenerationMedia|extractLocalGenerationEndFrame|SeedanceCanonicalAdapter|ProviderRouter/);
    }
  });
  it("uses the real Worker cycle and existing FFmpeg image rather than Vercel",()=>{
    expect(readFileSync("apps/worker/src/processors/index.ts","utf8")).toContain("runAiStoryLocalMediaWorkerCycle");
    expect(readFileSync("infra/docker/Dockerfile.worker","utf8")).toContain("ffmpeg");
    const source=readFileSync("apps/worker/src/ai-story-local-media-worker-cycle.ts","utf8");
    expect(source).toContain('decision!=="APPROVED"');
    expect(source).toContain("assertDistinctSceneMediaContent");
    expect(readFileSync("packages/agents/src/ai-story/local-generation-media.ts","utf8")).toContain("LOCAL_GENERATION_DUPLICATE_SCENE_CONTENT");
    expect(source).not.toMatch(/ProviderRouter|Seedance|Runway|authorizeExecutionPlanExecute|provider_outbox_jobs/);
  });
});
