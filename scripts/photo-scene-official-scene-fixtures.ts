import { createHash } from "node:crypto";
import { encodeRgbaPng } from "../packages/agents/src/photo-scene/png";
import {
  DEFAULT_OFFICIAL_SCENE_BUCKET,
  freezeOfficialSceneObjectIdentity,
  officialSceneBackgroundObjectKey,
  officialScenePreviewObjectKey,
} from "../packages/shared/src/photo-scene-official-scene";
import { PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST } from "../packages/shared/src/photo-scene-production-ops";

export function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function fixtureScenePng(kind: string): Buffer {
  const width = 32;
  const height = kind === "story" ? 56 : kind === "portrait" ? 40 : 32;
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = kind === "floral" ? 180 : kind === "studio" ? 245 : kind === "marble" ? 210 : 40;
      rgba[i + 1] = kind === "floral" ? 60 : kind === "studio" ? 245 : kind === "marble" ? 210 : 40;
      rgba[i + 2] = kind === "floral" ? 90 : kind === "studio" ? 250 : kind === "marble" ? 220 : 80;
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

export function officialSceneFixtureObjects(scene: (typeof PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST)[number]) {
  const bytes = fixtureScenePng(scene.kind);
  const hash = hashBytes(bytes);
  const backgroundKey = officialSceneBackgroundObjectKey(scene.id, scene.version);
  const previewKey = officialScenePreviewObjectKey(scene.id, scene.version);
  return {
    bytes,
    hash,
    backgroundKey,
    previewKey,
    backgroundIdentity: freezeOfficialSceneObjectIdentity(DEFAULT_OFFICIAL_SCENE_BUCKET, backgroundKey),
    previewIdentity: freezeOfficialSceneObjectIdentity(DEFAULT_OFFICIAL_SCENE_BUCKET, previewKey),
  };
}
