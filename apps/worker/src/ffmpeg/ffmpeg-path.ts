export function getFfmpegPath() {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}
