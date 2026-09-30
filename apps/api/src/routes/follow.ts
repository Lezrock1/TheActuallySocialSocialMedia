import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { isBlocked } from "../visibility.js";

export async function followRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { username: string } }>(
    "/users/:username/follow",
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = await prisma.user.findUnique({
        where: { username: request.params.username },
      });
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      if (target.id === request.userId) {
        return reply.code(400).send({ error: "Cannot follow yourself" });
      }
      if (await isBlocked(request.userId!, target.id)) {
        return reply.code(403).send({ error: "Not available" });
      }

      await prisma.follow.upsert({
        where: {
          followerId_followeeId: {
            followerId: request.userId!,
            followeeId: target.id,
          },
        },
        create: { followerId: request.userId!, followeeId: target.id },
        update: {},
      });
      return reply.code(204).send();
    }
  );

  app.delete<{ Params: { username: string } }>(
    "/users/:username/follow",
    { preHandler: requireAuth },
    async (request, reply) => {
      const target = await prisma.user.findUnique({
        where: { username: request.params.username },
      });
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      await prisma.follow.deleteMany({
        where: { followerId: request.userId!, followeeId: target.id },
      });
      return reply.code(204).send();
    }
  );

  app.get<{ Params: { username: string } }>(
    "/users/:username/followers",
    async (request, reply) => {
      const target = await prisma.user.findUnique({
        where: { username: request.params.username },
      });
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      const follows = await prisma.follow.findMany({
        where: { followeeId: target.id },
        include: { follower: true },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({
        users: follows.map((f) => toPublicUser(f.follower)),
      });
    }
  );

  app.get<{ Params: { username: string } }>(
    "/users/:username/following",
    async (request, reply) => {
      const target = await prisma.user.findUnique({
        where: { username: request.params.username },
      });
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      const follows = await prisma.follow.findMany({
        where: { followerId: target.id },
        include: { followee: true },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({
        users: follows.map((f) => toPublicUser(f.followee)),
      });
    }
  );
}
