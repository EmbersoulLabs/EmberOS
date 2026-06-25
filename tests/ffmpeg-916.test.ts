import { describe, it, expect } from "vitest";
import {
  build916FitChain,
  isNarrowerThan916,
  FFMPEG_CROP_916_CENTER,
} from "../apps/worker/src/ffmpeg/filters-916";

describe("filters-916", () => {
  it("detects narrow portrait sources", () => {
    expect(isNarrowerThan916(464, 848)).toBe(true);
    expect(isNarrowerThan916(1080, 1920)).toBe(false);
    expect(isNarrowerThan916(1920, 1080)).toBe(false);
  });

  it("uses conditional crop without w/h shorthand in position", () => {
    // Commas inside if(...) are escaped (\,) for FFmpeg filtergraph syntax.
    expect(FFMPEG_CROP_916_CENTER).toContain("x=if(gt(iw/ih\\,9/16)\\,(iw-ih*9/16)/2\\,0)");
    expect(FFMPEG_CROP_916_CENTER).not.toContain("(iw-w)");
  });

  it("build916FitChain does not use fixed ih*9/16-only crop", () => {
    const chain = build916FitChain("720:1280");
    expect(chain).not.toMatch(/^scale=iw\*1\.1/);
    expect(chain).toContain("scale=720:1280");
  });
});
