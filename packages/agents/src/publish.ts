import type { CopyVariant, Platform } from "@ceo-agent/shared";
import { getPlatformSpec } from "@ceo-agent/shared/platform-specs";

export interface PublishInput {
  creativeId: string;
  platforms: Platform[];
  copyVariants: CopyVariant[];
  selectedCopyId: string;
  videoFile: string;
  coverFile: string;
}

export interface ExportPack {
  creativeId: string;
  platforms: Record<
    string,
    {
      caption: string;
      hashtags: string[];
      title?: string;
      body?: string;
      tags?: string[];
      videoFile: string;
      coverFile: string;
    }
  >;
  exportManifest: string[];
}

export function runPublishAgent(input: PublishInput): ExportPack {
  const selected =
    input.copyVariants.find((v) => v.id === input.selectedCopyId) ?? input.copyVariants[0];

  const platforms: ExportPack["platforms"] = {};

  for (const platform of input.platforms) {
    const variant =
      input.copyVariants.find((v) => v.platform === platform) ?? selected;
    const spec = getPlatformSpec(platform);

    if (platform === "xiaohongshu") {
      platforms[platform] = {
        title: variant?.title ?? "",
        body: variant?.body ?? "",
        tags: variant?.tags ?? [],
        caption: `${variant?.title}\n\n${variant?.body}`,
        hashtags: variant?.tags ?? [],
        videoFile: input.videoFile,
        coverFile: input.coverFile,
      };
    } else {
      platforms[platform] = {
        caption: `${variant?.hook}\n\n${variant?.body}\n\n${variant?.cta}`,
        hashtags: variant?.tags ?? [],
        title: variant?.title,
        body: variant?.body,
        tags: variant?.tags,
        videoFile: input.videoFile,
        coverFile: input.coverFile,
      };
    }

    void spec;
  }

  const manifest = [
    input.videoFile,
    input.coverFile,
    ...input.platforms.map((p) => `copy/${p}_variant.md`),
    "metadata.json",
  ];

  return {
    creativeId: input.creativeId,
    platforms,
    exportManifest: manifest,
  };
}
