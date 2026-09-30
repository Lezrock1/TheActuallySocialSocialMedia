import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/middleware.js";
import { generateMediaKey, getMedia, putMedia } from "../storage.js";

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

    return reply.code(201).send({ key });
  });

  // Public read (keys are random UUIDs, not enumerable) - fine for an MVP;
  // private media (DMs/Snaps) will need auth-gated access in a later pass.
  app.get<{ Params: { key: string } }>("/media/:key", async (request, reply) => {
    const media = await getMedia(request.params.key);
    if (!media) {
      return reply.code(404).send({ error: "Not found" });
    }
    reply.header("Content-Type", media.contentType);
    return reply.send(media.body);
  });
}
