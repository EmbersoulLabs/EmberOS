import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareVisionFromStorage } from "../src/media/vision-prep";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });
config({ path: resolve(__dirname, "../../../.env.local") });

const path =
  process.argv[2] ??
  "a12f7a1e-5825-41f2-a710-26807184fb98/campaigns/90911eca-f7da-41db-9364-74c548ebc70a/source/5dd55a4a-d9f7-423b-b326-80cbb37f43a9.jpg";

const prepared = await prepareVisionFromStorage({
  storagePath: path,
  mediaType: "image",
});
console.log(
  JSON.stringify(
    {
      frameCount: prepared.frames.length,
      dataUrlChars: prepared.frames.map((f) => f.dataUrl.length),
      dataUrlPrefix: prepared.frames.map((f) => f.dataUrl.slice(0, 40)),
    },
    null,
    2
  )
);
process.exit(0);
