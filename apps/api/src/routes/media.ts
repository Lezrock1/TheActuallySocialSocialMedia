import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import {
  deleteMedia,
  generateMediaKey,
  getMedia,
  putMedia,
} from "../storage.js";
import { prisma } from "../db.js";
import { canReadMedia } from "../mediaAccess.js";
import { compressVideoToFit } from "../videoCompression.js";

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_RAW_UPLOAD_BYTES = 500 * 1024 * 1024 + 16;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
]);

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.post("/media", { preHandler: requireAuth }, async (request, reply) => {
    const file = await request.file({
      limits: { fileSize: MAX_RAW_UPLOAD_BYTES },
    });
    if (!file) {
      return reply.code(400).send({ error: "No file uploaded" });
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      file.file.resume();
      return reply.code(400).send({ error: "Unsupported file type" });
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), "intouch-media-"));
    try {
      const inputPath = join(temporaryDirectory, "upload");
      try {
        await pipeline(file.file, createWriteStream(inputPath));
      } catch (error) {
        if (file.file.truncated) {
          return reply.code(413).send({ error: "Upload exceeds the 500 MB limit" });
        }
        throw error;
      }
      const originalSize = (await stat(inputPath)).size;
      if (file.file.truncated || originalSize > MAX_RAW_UPLOAD_BYTES) {
        return reply.code(413).send({ error: "Upload exceeds the 500 MB limit" });
      }

      const isVideo = file.mimetype.startsWith("video/");
      if (!isVideo && originalSize > MAX_MEDIA_BYTES) {
        return reply.code(413).send({ error: "Images must be 50 MB or smaller" });
      }

      let storedPath = inputPath;
      let contentType = file.mimetype;
      let filename = file.filename;
      let storedSize = originalSize;
      const compressed = isVideo && originalSize > MAX_MEDIA_BYTES;
      if (compressed) {
        storedPath = join(temporaryDirectory, "compressed.mp4");
        try {
          storedSize = await compressVideoToFit(inputPath, storedPath, MAX_MEDIA_BYTES);
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : "Could not compress this video below 50 MB";
          return reply.code(413).send({ error: message });
        }
        contentType = "video/mp4";
        filename = `${file.filename}.mp4`;
      }

      const buffer = await readFile(storedPath);
      if (buffer.byteLength > MAX_MEDIA_BYTES) {
        return reply.code(413).send({ error: "Compressed video still exceeds 50 MB" });
      }
      const key = generateMediaKey(filename);
      await putMedia(key, buffer, contentType);
      try {
        await prisma.mediaAsset.create({
          data: { key, ownerId: request.userId! },
        });
      } catch (error) {
        await deleteMedia(key);
        throw error;
      }

      return reply.code(201).send({ key, compressed, originalSize, storedSize });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  app.get<{ Params: { key: string } }>(
    "/media/:key",
    { preHandler: requireAuth },
    async (request, reply) => {
      const key = request.params.key;
      const access = await canReadMedia(request.userId!, key);
      if (!access.allowed) {
        return reply.code(404).send({ error: "Not found" });
      }
      const media = await getMedia(key);
      if (!media) {
        return reply.code(404).send({ error: "Not found" });
      }
      reply.header("Content-Type", media.contentType);
      reply.header(
        "Cache-Control",
        access.maxAgeSeconds > 0
          ? `private, max-age=${access.maxAgeSeconds}, must-revalidate`
          : "private, no-store"
      );
      reply.header("Vary", "Cookie");
      reply.header("X-Content-Type-Options", "nosniff");
      return reply.send(media.body);
    }
  );
}
