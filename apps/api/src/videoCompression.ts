import { spawn } from "node:child_process";
import { stat, rm } from "node:fs/promises";

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => {
      if (stdout.length < 100_000) stdout += chunk;
    });
    process.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} failed: ${stderr.trim() || `exit code ${code}`}`));
    });
  });
}

export async function compressVideoToFit(
  inputPath: string,
  outputPath: string,
  maxBytes: number
): Promise<number> {
  const durationText = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);
  const duration = Number.parseFloat(durationText);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine video duration");
  }

  const targetBitrate = Math.floor((maxBytes * 0.8 * 8) / duration);
  const maxDimensions = [1280, 960, 720, 540];
  for (let attempt = 0; attempt < maxDimensions.length; attempt += 1) {
    await rm(outputPath, { force: true });
    const videoBitrate = Math.max(
      32_000,
      Math.floor((targetBitrate - 64_000) * 0.82 ** attempt)
    );
    await run("ffmpeg", [
      "-nostdin", "-y",
      "-i", inputPath,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-vf", `scale=w='min(${maxDimensions[attempt]},iw)':h='min(${maxDimensions[attempt]},ih)':force_original_aspect_ratio=decrease`,
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-pix_fmt", "yuv420p",
      "-b:v", String(videoBitrate),
      "-maxrate", String(videoBitrate),
      "-bufsize", String(videoBitrate * 2),
      "-c:a", "aac",
      "-b:a", "64000",
      "-movflags", "+faststart",
      "-f", "mp4",
      outputPath,
    ]);
    const outputSize = (await stat(outputPath)).size;
    if (outputSize <= maxBytes) return outputSize;
  }

  await rm(outputPath, { force: true });
  throw new Error("This video is too long to compress below 50 MB. Trim it and try again.");
}