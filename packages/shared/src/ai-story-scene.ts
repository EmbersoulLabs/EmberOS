import { z } from "zod";
import { AiStoryCastReferenceSchema } from "./ai-story-cast";
import { AiStoryScriptEntrySchema, AiStoryScriptStateFactSchema } from "./ai-story-script";

export const AI_STORY_SCENE_CONTRACT_VERSION = "ai-story-scene.v1" as const;
export const AI_STORY_LOCATION_CONTRACT_VERSION = "ai-story-location.v1" as const;
export const AI_STORY_SCENE_STATUSES = ["DRAFT","VALIDATED","APPROVED","FROZEN","SUPERSEDED"] as const;
export const AI_STORY_LOCATION_VISUAL_IDENTITY_REQUIREMENTS = ["NONE","PREFERRED","REQUIRED"] as const;
export const AI_STORY_SCENE_TIME_RELATIONS = ["CONTINUOUS","LATER","EARLIER","FLASHBACK","PARALLEL","UNSPECIFIED"] as const;
const Id=z.string().uuid(); const Hash=z.string().regex(/^sha256:[0-9a-f]{64}$/); const Text=z.string().trim().min(1).max(3000);
const Persistent=z.object({authorityVersionId:Id,authorityFingerprint:Hash,visualIdentityRequirement:z.enum(AI_STORY_LOCATION_VISUAL_IDENTITY_REQUIREMENTS)});

export const AiStoryCampaignLocationReferenceSchema=Persistent.extend({scope:z.literal("CAMPAIGN_LOCATION"),id:Id,campaignId:Id}).strict();
export const AiStoryStoryLocationReferenceSchema=Persistent.extend({scope:z.literal("STORY_LOCATION"),id:Id,storyId:Id}).strict();
export const AiStoryEphemeralEnvironmentReferenceSchema=z.object({scope:z.literal("EPHEMERAL_ENVIRONMENT"),id:Id,storyId:Id,sceneId:Id,displayName:Text,environmentDescription:Text,visualIdentityRequirement:z.enum(AI_STORY_LOCATION_VISUAL_IDENTITY_REQUIREMENTS)}).strict();
export const AiStoryLocationReferenceSchema=z.discriminatedUnion("scope",[AiStoryCampaignLocationReferenceSchema,AiStoryStoryLocationReferenceSchema,AiStoryEphemeralEnvironmentReferenceSchema]);
export const AiStoryLocationPromotionSchema=z.object({promotionId:Id,orgId:Id,workspaceId:Id,campaignId:Id,storyId:Id,source:AiStoryLocationReferenceSchema,target:AiStoryLocationReferenceSchema,promotedBy:Id,promotedAt:z.string().datetime()}).strict().superRefine((value,ctx)=>{const valid=value.source.scope==="EPHEMERAL_ENVIRONMENT"&&value.target.scope==="STORY_LOCATION"||value.source.scope==="STORY_LOCATION"&&value.target.scope==="CAMPAIGN_LOCATION";if(!valid)ctx.addIssue({code:z.ZodIssueCode.custom,message:"Location promotion must explicitly extend continuity horizon"});});

export const AiStoryLocationFactsSchema=z.object({displayName:Text,identity:Text,appearance:Text,spatialCharacter:Text.optional(),fixedElements:z.array(Text),environmentalCharacteristics:z.array(Text),visualAssetIds:z.array(Id)}).strict();
export const AiStoryLocationAuthorityVersionSchema=z.object({locationVersionId:Id,locationId:Id,scope:z.enum(["CAMPAIGN_LOCATION","STORY_LOCATION"]),orgId:Id,workspaceId:Id,campaignId:Id,storyId:Id.nullable(),version:z.number().int().positive(),contractVersion:z.literal(AI_STORY_LOCATION_CONTRACT_VERSION),facts:AiStoryLocationFactsSchema,status:z.enum(["ACTIVE","DELETED"]),fingerprint:Hash,supersedesLocationVersionId:Id.nullable(),createdBy:Id,createdAt:z.string().datetime()}).strict();

export const AiStorySceneLocationStateSchema=z.object({timeOfDay:Text.optional(),weather:Text.optional(),crowdState:Text.optional(),temporaryFacts:z.array(Text)}).strict();
export const AiStorySceneDiscontinuitySchema=z.object({kind:z.string().regex(/^(?:[A-Z][A-Z0-9_]{1,63}|EXT:[a-z0-9.-]+:[A-Z][A-Z0-9_]{1,63})$/),explanation:Text,preservesCharacterIdentity:z.literal(true),preservesProductIdentity:z.literal(true)}).strict();
export const AiStorySceneProductBindingSchema=z.object({productAuthorityId:Id,sourceAssetId:Id,sourceAssetContentHash:Hash}).strict();
export const AiStoryCanonicalSceneSchema=z.object({
  sceneId:Id,sceneVersionId:Id,orgId:Id,workspaceId:Id,campaignId:Id,storyId:Id,storyVersionId:Id,scriptVersionId:Id,
  version:z.number().int().positive(),contractVersion:z.literal(AI_STORY_SCENE_CONTRACT_VERSION),order:z.number().int().nonnegative(),
  sourceScriptSceneIds:z.array(Id).min(1),sourceScriptEntryIds:z.array(Id).min(1),sceneFunction:Text,
  sceneRole:z.string().regex(/^(?:[A-Z][A-Z0-9_]{1,63}|EXT:[a-z0-9.-]+:[A-Z][A-Z0-9_]{1,63})$/),importance:z.enum(["MAJOR","SUPPORTING","MINOR","TRANSITIONAL"]),
  locationBinding:AiStoryLocationReferenceSchema,locationState:AiStorySceneLocationStateSchema,castBindings:z.array(AiStoryCastReferenceSchema),productBindings:z.array(AiStorySceneProductBindingSchema),
  entryState:z.array(AiStoryScriptStateFactSchema),events:z.array(AiStoryScriptEntrySchema).min(1),exitState:z.array(AiStoryScriptStateFactSchema),continuityFacts:z.array(Text),
  timeRelation:z.enum(AI_STORY_SCENE_TIME_RELATIONS),discontinuity:AiStorySceneDiscontinuitySchema.nullable(),mustKeep:z.array(Text),mustAvoid:z.array(Text),
  lineageOperation:z.enum(["CREATE","REVISE","SPLIT","MERGE","REORDER","INSERT"]),parentSceneVersionIds:z.array(Id),sourceHash:Hash,fingerprint:Hash,
  status:z.enum(AI_STORY_SCENE_STATUSES),createdBy:Id,createdAt:z.string().datetime(),approvedBy:Id.nullable(),approvedAt:z.string().datetime().nullable(),frozenAt:z.string().datetime().nullable(),
}).strict();
export const AiStorySceneAuthorityBindingSchema=z.object({sceneId:Id,sceneVersionId:Id,sceneFingerprint:Hash,sourceScriptSceneIds:z.array(Id).min(1)}).strict();
export type AiStoryCanonicalScene=z.infer<typeof AiStoryCanonicalSceneSchema>; export type AiStoryLocationReference=z.infer<typeof AiStoryLocationReferenceSchema>; export type AiStoryLocationFacts=z.infer<typeof AiStoryLocationFactsSchema>; export type AiStoryLocationAuthorityVersion=z.infer<typeof AiStoryLocationAuthorityVersionSchema>;
export type AiStorySceneAuthorityBinding=z.infer<typeof AiStorySceneAuthorityBindingSchema>;
export type AiStoryLocationPromotion=z.infer<typeof AiStoryLocationPromotionSchema>;

export const AI_STORY_SCENE_QC_GATES=["SCENE_EXISTS_GATE","SCENE_VERSION_GATE","SCENE_FINGERPRINT_GATE","SCENE_ORDER_GATE","SCENE_LINEAGE_GATE","SCENE_ROLE_GATE","LOCATION_REFERENCE_GATE","LOCATION_SCOPE_GATE","LOCATION_VERSION_GATE","LOCATION_CONTINUITY_GATE","CAST_BINDING_GATE","PRODUCT_BINDING_GATE","ENTRY_STATE_GATE","EXIT_STATE_GATE","SCENE_CONTINUITY_GATE","TIME_RELATION_GATE","DISCONTINUITY_GATE","SCENE_PURPOSE_GATE","SCENE_DUPLICATION_GATE"] as const;
export type AiStorySceneIssue={gate:(typeof AI_STORY_SCENE_QC_GATES)[number];severity:"BLOCK"|"WARN";repairOwner:"SCRIPT"|"SCENE"|"LOCATION"|"CAST"|"PRODUCT_AUTHORITY"|"DIRECTOR"|"MOTION";message:string};
export const AI_STORY_SCENE_SCOPE_POLICY=Object.freeze({locationNameDeterminesScope:false,genreDeterminesLocationScope:false,sceneImportanceDeterminesLocationScope:false,sceneImportanceDeterminesGenerationMode:false,locationScopeForcesGenerationMode:false,automaticLocationPromotion:false,automaticLocationDemotion:false,environmentTypeAllowlist:false});
export function selectLocationScopeFromContinuityHorizon(horizon:"CAMPAIGN"|"STORY"|"SCENE"){return horizon==="CAMPAIGN"?"CAMPAIGN_LOCATION":horizon==="STORY"?"STORY_LOCATION":"EPHEMERAL_ENVIRONMENT";}
export function locationReferenceKey(ref:AiStoryLocationReference){return `${ref.scope}:${ref.id}`;}
export function projectLegacyScenePlanCompatibility(value:unknown){return{kind:"LEGACY_SCENE_PLAN_COMPATIBILITY" as const,canonicalSceneAuthority:null,legacyScenePlan:value};}
