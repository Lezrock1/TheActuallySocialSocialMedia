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

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.post("/media", { preHandler: requireAuth }, async (request, reply) => {
    const file = await request.file({
      limits: { fileSize: MAX_UPLOAD_BYTES },
    });
    if (!file) {
      return reply.code(400).send({ error: "No file uploaded" });
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return reply.code(400).send({ error: "Unsupported file type" });
    }

    const buffer = await file.toBuffer();
    const key = generateMediaKey(file.filename);
    await putMedia(key, buffer, file.mimetype);
    try {
      await prisma.mediaAsset.create({
        data: { key, ownerId: request.userId! },
      });
    } catch (error) {
      await deleteMedia(key);
      throw error;
    }

    return reply.code(201).send({ key });
  });

  app.get<{ Params: { key: string } }>(
    "/media/:key",
    { preHandler: requireAuth },
    async (request, reply) => {
      const key = request.params.key;
      if (!(await canReadMedia(request.userId!, key))) {
        return reply.code(404).send({ error: "Not found" });
      }
      const media = await getMedia(key);
      if (!media) {
        return reply.code(404).send({ error: "Not found" });
      }
      reply.header("Content-Type", media.contentType);
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      return reply.send(media.body);
    }
  );
}
