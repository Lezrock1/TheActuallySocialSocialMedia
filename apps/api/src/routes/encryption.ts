import { createHash, createPublicKey } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { registerEncryptionKeySchema } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";

const MAX_DEVICE_KEYS = 10;

export async function encryptionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/users/me/encryption-keys", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = registerEncryptionKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const publicKeyBytes = Buffer.from(parsed.data.publicKey, "base64");
    let fingerprint: string;
    try {
      const key = createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" });
      if (
        key.asymmetricKeyType !== "rsa" ||
        key.asymmetricKeyDetails?.modulusLength !== 2048 ||
        publicKeyBytes.toString("base64") !== parsed.data.publicKey
      ) {
        return reply.code(400).send({ error: "Invalid encryption key" });
      }
      fingerprint = createHash("sha256").update(publicKeyBytes).digest("hex");
    } catch {
      return reply.code(400).send({ error: "Invalid encryption key" });
    }

    const existing = await prisma.encryptionKey.findUnique({
      where: {
        userId_fingerprint: { userId: request.userId!, fingerprint },
      },
      select: { fingerprint: true },
    });
    if (existing) return reply.send({ fingerprint: existing.fingerprint });

    const keyCount = await prisma.encryptionKey.count({ where: { userId: request.userId! } });
    if (keyCount >= MAX_DEVICE_KEYS) {
      return reply.code(409).send({ error: "Maximum number of device keys reached" });
    }

    await prisma.encryptionKey.create({
      data: {
        userId: request.userId!,
        fingerprint,
        publicKey: parsed.data.publicKey,
      },
    });
    return reply.code(201).send({ fingerprint });
  });
}