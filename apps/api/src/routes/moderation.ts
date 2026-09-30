import type { FastifyInstance } from "fastify";
import { createReportSchema } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";

export async function moderationRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { username: string } }>(
    "/users/:username/block",
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = await prisma.user.findUnique({
        where: { username: request.params.username },
      });
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      if (target.id === request.userId) {
        return reply.code(400).send({ error: "Cannot block yourself" });
      }
      await prisma.$transaction([
        prisma.blockedUser.upsert({
          where: {
            blockerId_blockedId: {
              blockerId: request.userId!,
              blockedId: target.id,
            },
          },
          create: { blockerId: request.userId!, blockedId: target.id },
          update: {},
        }),
        // blocking severs any existing follow relationship in both directions
        prisma.follow.deleteMany({
          where: {
            OR: [
              { followerId: request.userId!, followeeId: target.id },
              { followerId: target.id, followeeId: request.userId! },
            ],
          },
        }),
      ]);
      return reply.code(204).send();
    }
  );

  app.delete<{ Params: { username: string } }>(
    "/users/:username/block",
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = await prisma.user.findUnique({
        where: { username: request.params.username },
      });
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      await prisma.blockedUser.deleteMany({
        where: { blockerId: request.userId!, blockedId: target.id },
      });
      return reply.code(204).send();
    }
  );

  app.get("/users/me/blocked", { preHandler: requireAuth }, async (request, reply) => {
    const rows = await prisma.blockedUser.findMany({
      where: { blockerId: request.userId! },
      include: { blocked: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({ users: rows.map((r) => toPublicUser(r.blocked)) });
  });

  app.post("/reports", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    await prisma.report.create({
      data: {
        reporterId: request.userId!,
        targetType: parsed.data.targetType,
        targetId: parsed.data.targetId,
        reason: parsed.data.reason,
      },
    });
    return reply.code(201).send({ ok: true });
  });
}
