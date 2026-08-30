import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("AI Story Supporting Cast UI boundaries",()=>{
  it("keeps Campaign Character Panel and adds bounded Story-local controls",()=>{const page=read("apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx");const panel=read("apps/web/src/components/ai-story/SupportingCastPanel.tsx");expect(page).toContain("<CharacterPanel");expect(page).toContain("<SupportingCastPanel");expect(panel).toContain("Add supporting Character");expect(panel).toContain("Keep as recurring Character");expect(panel).toContain(">Edit<");expect(panel).toContain(">Delete<");expect(panel).toContain("Scene-only actors are not listed globally");expect(panel).toContain("keeps its original Supporting Character history");});
  it("is mobile-safe and hides internal Cast/version/provider facts",()=>{const panel=read("apps/web/src/components/ai-story/SupportingCastPanel.tsx").toLowerCase();expect(panel).toContain("rounded-t-2xl");expect(panel).toContain("sm:items-center");for(const forbidden of ["seedance","fingerprint","provider mapping","ephemeral actor panel"])expect(panel).not.toContain(forbidden);});
  it("uses current Story authorization and exposes no global Ephemeral table route",()=>{const access=read("apps/web/src/lib/ai-story-cast-access.ts");const collection=read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/supporting-cast/route.ts");expect(access).toContain('minRole: mutation ? "operator" : "client_viewer"');expect(collection).toContain("AiStorySupportingCastAuthorityService");expect(()=>read("apps/web/src/app/api/ephemeral-actors/route.ts")).toThrow();});
});
