import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Hash actual local bytes without buffering large source videos in memory. */
export async function hashSourceAssetFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return `sha256:${hash.digest("hex")}`;
}
