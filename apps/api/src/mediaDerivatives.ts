import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { getMedia } from "./storage.js";
import { run } from "./videoCompression.js";

export type MediaDerivativeKind = "preview" | "poster";

const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CONCURRENT_JOBS = 3;
const cache = new Map<string, Buffer>();
const inflight = new Map<string, Promise<Buffer | null>>();
let cacheBytes = 0;
let activeJobs = 0;

function remember(cacheKey: string, buffer: Buffer): void {
  cache.set(cacheKey, buffer);
  cacheBytes += buffer.byteLength;
  for (const [oldKey, value] of cache) {
    if (cacheBytes <= MAX_CACHE_BYTES) break;
    cache.delete(oldKey);
    cacheBytes -= value.byteLength;
  }
}

async function render(key: string, kind: MediaDerivativeKind): Promise<Buffer | null> {
  const media = await getMedia(key);
  if (!media) return null;
  const expectedPrefix = kind === "preview" ? "image/" : "video/";
  if (!media.contentType.startsWith(expectedPrefix)) {
    media.body.resume();
    return null;
  }
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    media.body.resume();
    return null;
  }
  activeJobs += 1;
  const directory = await mkdtemp(join(tmpdir(), "intouch-derivative-"));
  try {
    const inputPath = join(directory, "input");
    const outputPath = join(directory, "output.jpg");
    await pipeline(media.body, createWriteStream(inputPath));
    // A tiny image for blur-up placeholders, or the first frame of a video.
    const scale = kind === "preview" ? "scale=32:-2" : "scale='min(960,iw)':-2";
    await run("ffmpeg", [
      "-nostdin", "-y",
      "-i", inputPath,
      "-frames:v", "1",
      "-vf", scale,
      "-q:v", kind === "preview" ? "10" : "5",
      outputPath,
    ], 20_000);
    return await readFile(outputPath);
  } catch {
    return null;
  } finally {
    activeJobs -= 1;
    await rm(directory, { recursive: true, force: true });
  }
}

export async function getMediaDerivative(key: string, kind: MediaDerivativeKind): Promise<Buffer | null> {
  const cacheKey = `${kind}:${key}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const pending = inflight.get(cacheKey);
  if (pending) return pending;
  const job = render(key, kind)
    .then((buffer) => {
      if (buffer) remember(cacheKey, buffer);
      return buffer;
    })
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, job);
  return job;
}
