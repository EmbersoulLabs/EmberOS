import { describe, expect, it } from "vitest";
import { contentPackToCsv, type TaskContentPack } from "@ceo-agent/shared";

function packWithHook(hook: string): TaskContentPack {
  return {
    taskId: "task-1",
    campaignId: "campaign-1",
    clipCount: 1,
    hooks: {} as TaskContentPack["hooks"],
    ctas: {} as TaskContentPack["ctas"],
    captions: {} as TaskContentPack["captions"],
    voiceScripts: {} as TaskContentPack["voiceScripts"],
    subtitleTimeline: {} as TaskContentPack["subtitleTimeline"],
    clips: [
      {
        clip: 1,
        platforms: {
          tiktok: { hook, caption: "caption", cta: "cta", hashtags: [] },
        },
      },
    ],
  };
}

function hookCell(csv: string): string {
  const row = csv.split("\n")[1]!;
  // clip,platform,hook,caption,cta,hashtags — hook is the 3rd column and the
  // only one under test here, none of the fixtures contain embedded commas.
  return row.split(",")[2]!;
}

describe("contentPackToCsv formula-injection guard", () => {
  it.each(["=SUM(A1:A9)", "+1+1", "-1+1", "@SUM(1+2)", "\t=evil()"])(
    "guards a leading-%s cell with a leading apostrophe",
    (dangerous) => {
      const cell = hookCell(contentPackToCsv(packWithHook(dangerous)));
      expect(cell.startsWith("'")).toBe(true);
      expect(cell).toContain(dangerous.trimStart() || dangerous);
    }
  );

  it("does not alter ordinary text starting with a dash (e.g. a list item)", () => {
    // Still guarded — "-" is a formula trigger in Excel/Sheets regardless of
    // intent, so legitimate "- bullet" copy gets the same leading apostrophe.
    const cell = hookCell(contentPackToCsv(packWithHook("- limited time offer")));
    expect(cell).toBe("'- limited time offer");
  });

  it("leaves normal text untouched", () => {
    const cell = hookCell(contentPackToCsv(packWithHook("Shop the drop today")));
    expect(cell).toBe("Shop the drop today");
  });

  it("still quotes a guarded value that also contains a comma", () => {
    const row = contentPackToCsv(packWithHook("=A1, B1")).split("\n")[1]!;
    expect(row).toBe('1,tiktok,"\'=A1, B1",caption,cta,');
  });
});
