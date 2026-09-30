import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";

export async function closeFriendRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/users/me/close-friends",
    { preHandler: requireAuth },
    async (request, reply) => {
      const rows = await prisma.closeFriend.findMany({
        where: { ownerId: request.userId! },
        include: { friend: true },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ users: rows.map((r) => toPublicUser(r.friend)) });
    }
  );

  app.post<{ Params: { username: string } }>(
    "/users/:username/close-friend",
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = await prisma.user.findUnique({
        where: { username: request.params.username },
      });
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      if (target.id === request.userId) {
        return reply.code(400).send({ error: "Cannot add yourself" });
      }
      await prisma.closeFriend.upsert({
        where: {
          ownerId_friendId: {
            ownerId: request.userId!,
            friendId: target.id,
          },
        },
        create: { ownerId: request.userId!, friendId: target.id },
        update: {},
      });
      return reply.code(204).send();
    }
  );

  app.delete<{ Params: { username: string } }>(
    "/users/:username/close-friend",
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = await prisma.user.findUnique({
        where: { username: request.params.username },
      });
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      await prisma.closeFriend.deleteMany({
        where: { ownerId: request.userId!, friendId: target.id },
      });
      return reply.code(204).send();
    }
  );
}
