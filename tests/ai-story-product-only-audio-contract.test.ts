import { describe, expect, it } from "vitest";
import {
  AI_STORY_CERTIFIED_LOCAL_WORKFLOWS,
  AI_STORY_LOCAL_SPEECH_DETECTION_AVAILABLE,
  LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
  LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW,
  LOCAL_GPU_PRODUCT_ONLY_CERTIFICATION_STORY_ID,
  LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  assessDesktopNativeAudioPreservation,
  assertLocalGpuPackageCompatibility,
  assertProductOnlyCandidateShape,
  buildLocalGpuDesktopSubmit,
  localGpuUploadBindingDigest,
  mapCertifiedWorkflowToLocalGpu,
  mapLocalGpuAudioPolicy,
  mapProductOnlyCandidateToLocalGpu,
  resolveAiStoryAudioGenerationSemantics,
  selectProductOnlyDesktopAudioPolicy,
} from "@ceo-agent/shared";
import {
  compileAiStoryAudioQcExpectation,
  evaluateAiStoryAudioQc,
} from "@ceo-agent/shared/server";
import { localGpuQueuedAction } from "../packages/agents/src/ai-story/local-gpu-production-execution";

const storyId = LOCAL_GPU_PRODUCT_ONLY_CERTIFICATION_STORY_ID;
const id = (n: number) => `92000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = `sha256:${"a".repeat(64)}`;
const uploadUrl = "https://storage.example.test/upload";

function productBody() {
  return buildLocalGpuDesktopSubmit({
    environment: "staging",
    jobId: id(1),
    sceneExecutionId: id(2),
    workspaceId: id(3),
    workflow: "MINIMAX_H3_R2V",
    prompt: "A product remains visible.",
    plannedDurationMs: 6000,
    references: [{
      approval: "APPROVED",
      role: "PRODUCT",
      assetUrl: "https://storage.example.test/product.png",
      contentHash: hash,
    }],
    audioPolicy: "NATIVE",
    upload: { environment: "staging", method: "PUT", url: uploadUrl },
    generationMode: "PRODUCT_GROUNDED_VIDEO",
  });
}

describe("Product-only audio contract", () => {
  it("keeps native audio generation separate from dialogue and silence", () => {
    expect(resolveAiStoryAudioGenerationSemantics({
      visibleDialogueCount: 0,
      explicitSilenceRequired: false,
    })).toEqual({
      nativeAudioGeneration: true,
      scriptedDialogueRequired: false,
      silentOutputRequired: false,
    });
    expect(resolveAiStoryAudioGenerationSemantics({
      visibleDialogueCount: 1,
      explicitSilenceRequired: false,
    })).toMatchObject({ scriptedDialogueRequired: true, silentOutputRequired: false });
    expect(resolveAiStoryAudioGenerationSemantics({
      visibleDialogueCount: 0,
      explicitSilenceRequired: true,
    })).toMatchObject({ nativeAudioGeneration: false, silentOutputRequired: true });
  });

  it("does not map no-dialogue ambient audio to whole-track removal", () => {
    expect(mapLocalGpuAudioPolicy({
      generateAudio: true,
      audioBlocked: false,
      expectationKind: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
    })).toBe("NATIVE");
    expect(() => mapLocalGpuAudioPolicy({
      generateAudio: false,
      audioBlocked: true,
      expectationKind: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
    })).toThrow("LOCAL_GPU_AUDIO_POLICY_INVALID");
    expect(mapLocalGpuAudioPolicy({
      generateAudio: false,
      audioBlocked: true,
      expectationKind: "SILENT_OUTPUT",
    })).toBe("REMOVE_AUDIO");
    expect(mapLocalGpuAudioPolicy({
      generateAudio: true,
      audioBlocked: false,
      expectationKind: "NATIVE_CHARACTER_DIALOGUE",
    })).toBe("NATIVE");
  });

  it("withholds Desktop NATIVE until worker preservation is verified", () => {
    const desktop = productBody();
    expect(desktop.body.audioPolicy).toBe("NATIVE");
    expect(desktop.body.workflow).toBe("MINIMAX_H3_R2V");
    expect(desktop.body).not.toHaveProperty("voiceInstructions");
    expect(desktop.body).not.toHaveProperty("dialogue");
    expect(desktop.body).not.toHaveProperty("voiceDna");
    expect(desktop.uploadBinding).toBe(localGpuUploadBindingDigest(desktop.body.upload));
    const preservation = assessDesktopNativeAudioPreservation({
      audioPolicy: desktop.body.audioPolicy,
      workflow: desktop.body.workflow,
      voiceInstructions: desktop.body.voiceInstructions,
      hasDialogueField: Object.prototype.hasOwnProperty.call(desktop.body, "dialogue"),
      hasVoiceDnaField: Object.prototype.hasOwnProperty.call(desktop.body, "voiceDna"),
    });
    expect(preservation.cloudWireCompatible).toBe(true);
    expect(preservation.wireSelectsRemoval).toBe(false);
    expect(preservation.offlineImplementationVerified).toBe(false);
    expect(preservation.missing).toContain("DESKTOP_NATIVE_AUDIO_EVIDENCE_FILE");
    expect(preservation.compatible).toBe(false);
    const claimedMatch = assessDesktopNativeAudioPreservation({
      audioPolicy: desktop.body.audioPolicy,
      workflow: desktop.body.workflow,
      hasDialogueField: false,
      hasVoiceDnaField: false,
      offlineEvidence: {
        workflow: "MINIMAX_H3_R2V",
        audioPolicy: "NATIVE",
        dialogueRequired: false,
        inputAudioCodec: "aac",
        inputAudioDurationMs: 5167,
        outputAudioCodec: "aac",
        outputAudioDurationMs: 5167,
        unintendedAudioRemoval: false,
        localUploadPreparation: "PASS",
        desktopWireContract: "UNCHANGED",
        h3Submissions: 0,
      },
      deployedWorkflows: ["MINIMAX_H3_R2V"],
      deployedSigningAccepted: true,
    });
    expect(claimedMatch.offlineImplementationVerified).toBe(false);
    expect(claimedMatch.missing).toEqual(expect.arrayContaining([
      "decodedAudioSha256",
      "outputFileSha256",
      "workerIdentity",
    ]));
    const semantics = assertProductOnlyCandidateShape({
      durationSec: 6,
      references: [{ role: "PRODUCT_IDENTITY" }],
      visibleDialogueCount: 0,
      explicitSilenceRequired: false,
      existingJobId: null,
    });
    expect(selectProductOnlyDesktopAudioPolicy({
      semantics,
      preservationCompatible: preservation.compatible,
    })).toBeNull();
  });

  it("keeps the candidate off the production certified registry and denies production access", () => {
    expect(AI_STORY_CERTIFIED_LOCAL_WORKFLOWS).toEqual(["MINIMAX_H3_NATIVE_DIALOGUE"]);
    expect(() => mapCertifiedWorkflowToLocalGpu(LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW, ["MINIMAX_H3_R2V"]))
      .toThrow("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(() => assertLocalGpuPackageCompatibility({
      recommendedWorkflow: LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW,
      plannedDurationMs: 6000,
      generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
      references: [{ role: "PRODUCT_IDENTITY", assetId: id(41), contentHash: hash }],
      audioPolicy: "NATIVE",
    })).not.toThrow();
    expect(mapProductOnlyCandidateToLocalGpu({
      environment: "staging",
      platformAdminStatus: "ACTIVE_GRANT",
      storyId,
      packageWorkflow: LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW,
      workerWorkflows: ["MINIMAX_H3_R2V"],
    })).toBe("MINIMAX_H3_R2V");
    expect(() => mapProductOnlyCandidateToLocalGpu({
      environment: "production",
      platformAdminStatus: "ACTIVE_GRANT",
      storyId,
      packageWorkflow: LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW,
      workerWorkflows: ["MINIMAX_H3_R2V"],
    })).toThrow("LOCAL_GPU_CANDIDATE_PRODUCTION_DENIED");
    expect(() => mapProductOnlyCandidateToLocalGpu({
      environment: "staging",
      platformAdminStatus: "DENIED",
      storyId,
      packageWorkflow: LOCAL_GPU_PRODUCT_ONLY_CANDIDATE_WORKFLOW,
      workerWorkflows: ["MINIMAX_H3_R2V"],
    })).toThrow("LOCAL_GPU_CANDIDATE_ACCESS_DENIED");
    expect(() => assertProductOnlyCandidateShape({
      durationSec: 6,
      references: [{ role: "PRODUCT" }, { role: "CHARACTER" }],
      visibleDialogueCount: 0,
      explicitSilenceRequired: false,
      existingJobId: null,
    })).toThrow("LOCAL_GPU_CANDIDATE_REFERENCE_COUNT_INVALID");
    expect(() => assertProductOnlyCandidateShape({
      durationSec: 6,
      references: [{ role: "PRODUCT" }],
      visibleDialogueCount: 0,
      explicitSilenceRequired: false,
      existingJobId: id(9),
    })).toThrow("LOCAL_GPU_CANDIDATE_RESUBMIT_BLOCKED");
    expect(localGpuQueuedAction("job-1")).not.toBe("submit");
    expect(LOCAL_GPU_AUTOMATIC_GENERATION_RETRY).toBe(0);
    expect(LOCAL_GPU_REMOTE_PROVIDER_FALLBACK).toBe(0);
    expect(AI_STORY_LOCAL_SPEECH_DETECTION_AVAILABLE).toBe(false);
  });

  it("sends unexpected speech and ambient audio to human review instead of an automatic pass", () => {
    const expectation = compileAiStoryAudioQcExpectation({
      applicability: "REQUIRED",
      expectationKind: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
      orgId: id(1),
      workspaceId: id(2),
      storyId,
      storyVersionId: id(4),
      sceneExecutionId: id(5),
      speakerRole: "NONE",
    });
    const result = evaluateAiStoryAudioQc({
      expectation,
      evidence: {
        orgId: id(1),
        workspaceId: id(2),
        storyId,
        storyVersionId: id(4),
        sceneExecutionId: id(5),
        mediaAssetId: id(6),
        generationResultId: id(7),
        providerAttemptId: null,
        mediaFacts: {
          hasVideoStream: true,
          hasAudioStream: true,
          videoDurationMs: 6000,
          audioDurationMs: 6000,
          audioCodec: "aac",
          sampleRate: 48000,
          channelCount: 2,
          decodable: true,
          mediaContentHash: hash,
        },
        nativeDurationToleranceMs: null,
        executedDialogueAuthorityId: null,
        executedDialogueFingerprint: null,
        durableVoiceDna: null,
        semanticInstructionFingerprint: null,
        ttsRequest: null,
        ttsResult: null,
        finalMix: null,
        detachedTtsUsed: false,
        humanReview: null,
      },
      evaluatedAt: "2026-10-09T00:00:00.000Z",
    });
    expect(result.expectationKind).toBe("NO_DIALOGUE_WITH_AMBIENT_AUDIO");
    expect(result.evaluatedDimensions.find((item) => item.dimension === "SPEECH_CONTENT")?.result)
      .toBe("HUMAN_REVIEW_REQUIRED");
    expect(result.evaluatedDimensions.some((item) => item.dimension === "SPEECH_CONTENT" && item.result === "PASS"))
      .toBe(false);
    expect(result.overallResult).toBe("HUMAN_REVIEW_REQUIRED");
    expect(result.blockingFindings).toEqual([]);
  });
});
