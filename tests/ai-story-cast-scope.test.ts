import { describe, expect, it } from "vitest";
import {
  AI_STORY_CAST_SCOPE_POLICY,
  AiStoryCastPromotionSchema,
  AiStoryCastReferenceSchema,
  castReferenceKey,
  projectLegacyCastCompatibility,
  selectCastScopeFromContinuityHorizon,
  validateCastReferences,
} from "@ceo-agent/shared";
import { buildAiStorySupportingCharacterVersion, computeAiStorySupportingCharacterFingerprint } from "@ceo-agent/shared/server";
import { proposeWriterCastScope } from "@ceo-agent/agents";

const id = (n: number) => `73000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = { org:id(1),workspace:id(2),campaign:id(3),story:id(4),otherStory:id(5),actor:id(6),supporting:id(7),supportingVersion:id(8),sceneA:id(9),sceneB:id(10),ephemeral:id(11),campaignCharacter:id(12),campaignVersion:id(13),relationship:id(14),promotion:id(15) };

function supporting(version = 1) {
  return buildAiStorySupportingCharacterVersion({ supportingCharacterId:I.supporting,orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,version,status:"ACTIVE",facts:{displayName:"River",identity:"A recurring Story-local witness",storyRole:"driver",appearance:"Silver coat and square glasses",relationships:[],continuityFacts:["Returns after an absent Scene"],visualAssetIds:[]},visualAssetReferences:[],supersedesSupportingCharacterVersionId:null,createdBy:I.actor,createdAt:"2026-08-29T12:00:00.000Z" });
}

describe("AI Story Supporting Cast and Ephemeral Actor scope", () => {
  it("selects scope only from continuity horizon, never role or genre", () => {
    expect(selectCastScopeFromContinuityHorizon({continuityHorizon:"STORY",roleLabel:"driver",genre:"mystery"})).toBe("STORY_SUPPORTING_CHARACTER");
    expect(selectCastScopeFromContinuityHorizon({continuityHorizon:"SCENE",roleLabel:"romantic lead",genre:"romance"})).toBe("EPHEMERAL_ACTOR");
    expect(selectCastScopeFromContinuityHorizon({continuityHorizon:"CAMPAIGN",roleLabel:"suspect",genre:"unknown"})).toBe("CAMPAIGN_CHARACTER");
    expect(selectCastScopeFromContinuityHorizon({continuityHorizon:"STORY",roleLabel:"quantum-liaison-7",genre:"unseen-genre"})).toBe("STORY_SUPPORTING_CHARACTER");
    expect(AI_STORY_CAST_SCOPE_POLICY).toMatchObject({roleNameDeterminesScope:false,genreDeterminesScope:false,automaticPromotion:false,automaticDemotion:false,castScopeForcesGenerationMode:false});
    expect(proposeWriterCastScope({continuityHorizon:"STORY",roleLabel:"driver",genre:"mystery"})).toEqual({proposalOnly:true,scope:"STORY_SUPPORTING_CHARACTER"});
  });

  it("builds stable Story-local identity and immutable fingerprint semantics", () => {
    const first=supporting(); const again=supporting(); expect(first.supportingCharacterId).toBe(again.supportingCharacterId); expect(first.supportingCharacterVersionId).toBe(again.supportingCharacterVersionId); expect(first.fingerprint).toBe(computeAiStorySupportingCharacterFingerprint(first)); expect(first.storyId).toBe(I.story);
  });

  it("supports all typed Cast references and explicit visual identity requirements", () => {
    const persistent=supporting();
    const refs=[
      {scope:"CAMPAIGN_CHARACTER",id:I.campaignCharacter,campaignId:I.campaign,authorityVersionId:I.campaignVersion,authorityFingerprint:`sha256:${"a".repeat(64)}`,visualIdentityRequirement:"PREFERRED"},
      {scope:"STORY_SUPPORTING_CHARACTER",id:I.supporting,storyId:I.story,authorityVersionId:persistent.supportingCharacterVersionId,authorityFingerprint:persistent.fingerprint,visualIdentityRequirement:"REQUIRED"},
      {scope:"EPHEMERAL_ACTOR",id:I.ephemeral,storyId:I.story,scriptSceneId:I.sceneA,displayName:"One-scene lead",semanticRole:"romantic lead",appearance:"Red scarf",visualIdentityRequirement:"NONE"},
    ] as const;
    for(const ref of refs) expect(AiStoryCastReferenceSchema.parse(ref)).toEqual(ref);
    expect(refs.map(castReferenceKey)).toEqual([`CAMPAIGN_CHARACTER:${I.campaignCharacter}`,`STORY_SUPPORTING_CHARACTER:${I.supporting}`,`EPHEMERAL_ACTOR:${I.ephemeral}`]);
  });

  it("preserves same-Story returns and blocks cross-Story/Scene scope", () => {
    const persistent=supporting(); const supportingRef={scope:"STORY_SUPPORTING_CHARACTER" as const,id:I.supporting,storyId:I.story,authorityVersionId:persistent.supportingCharacterVersionId,authorityFingerprint:persistent.fingerprint,visualIdentityRequirement:"NONE" as const};
    const ephemeral={scope:"EPHEMERAL_ACTOR" as const,id:I.ephemeral,storyId:I.story,scriptSceneId:I.sceneA,displayName:"Passerby",semanticRole:"one-scene witness",appearance:"Blue cap",visualIdentityRequirement:"NONE" as const};
    expect(validateCastReferences({campaignId:I.campaign,storyId:I.story,sceneIds:new Set([I.sceneA,I.sceneB]),references:[supportingRef,ephemeral],campaignCharacters:[],supportingCharacters:[persistent]})).toEqual([]);
    const crossStory={...supportingRef,storyId:I.otherStory}; const crossScene={...ephemeral,scriptSceneId:id(99)};
    const gates=validateCastReferences({campaignId:I.campaign,storyId:I.story,sceneIds:new Set([I.sceneA,I.sceneB]),references:[crossStory,crossScene],campaignCharacters:[],supportingCharacters:[persistent]}).map((issue)=>issue.gate);
    expect(gates).toContain("SUPPORTING_CHARACTER_STORY_SCOPE_GATE"); expect(gates).toContain("EPHEMERAL_ACTOR_SCENE_SCOPE_GATE");
  });

  it("allows only explicit upward promotion while preserving source lineage", () => {
    const source=supporting(); const sourceRef={scope:"STORY_SUPPORTING_CHARACTER" as const,id:source.supportingCharacterId,storyId:I.story,authorityVersionId:source.supportingCharacterVersionId,authorityFingerprint:source.fingerprint,visualIdentityRequirement:"NONE" as const};
    const target={scope:"CAMPAIGN_CHARACTER" as const,id:I.campaignCharacter,campaignId:I.campaign,authorityVersionId:I.campaignVersion,authorityFingerprint:`sha256:${"b".repeat(64)}`,visualIdentityRequirement:"NONE" as const};
    expect(AiStoryCastPromotionSchema.parse({promotionId:I.promotion,orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,source:sourceRef,target,promotedBy:I.actor,promotedAt:"2026-08-29T12:05:00.000Z"}).source).toEqual(sourceRef);
    expect(()=>AiStoryCastPromotionSchema.parse({promotionId:I.promotion,orgId:I.org,workspaceId:I.workspace,campaignId:I.campaign,storyId:I.story,source:target,target:sourceRef,promotedBy:I.actor,promotedAt:"2026-08-29T12:05:00.000Z"})).toThrow();
  });

  it("keeps legacy payloads readable without fabricating canonical Cast scope", () => { expect(projectLegacyCastCompatibility({characters:[{role:"friend"}]})).toMatchObject({kind:"LEGACY_CAST_COMPATIBILITY",canonicalCastReferences:null}); });
});
