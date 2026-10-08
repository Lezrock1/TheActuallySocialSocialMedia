import type { FastifyInstance } from "fastify";
import {
  MAX_CIRCLES_PER_USER,
  MAX_CIRCLE_MEMBERS,
  circleMemberSchema,
  createCircleSchema,
  updateCircleSchema,
} from "@app/shared";
import type { CircleDetail, CircleSummary } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { toPublicUser } from "../serializers.js";
import { isBlocked } from "../visibility.js";
import { createUserNotification } from "../notifications.js";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function circleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/circles", { preHandler: requireAuth }, async (request, reply) => {
    const circles = await prisma.circle.findMany({
      where: { ownerId: request.userId! },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: "asc" },
    });
    const summaries: CircleSummary[] = circles.map((circle) => ({
      id: circle.id,
      name: circle.name,
      memberCount: circle._count.members,
    }));
    return reply.send({ circles: summaries, maxCircles: MAX_CIRCLES_PER_USER });
  });

  app.post("/circles", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createCircleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const count = await prisma.circle.count({ where: { ownerId: request.userId! } });
    if (count >= MAX_CIRCLES_PER_USER) {
      return reply.code(409).send({ error: `You can have up to ${MAX_CIRCLES_PER_USER} circles` });
    }
    try {
      const circle = await prisma.circle.create({
        data: { ownerId: request.userId!, name: parsed.data.name },
      });
      const summary: CircleSummary = { id: circle.id, name: circle.name, memberCount: 0 };
      return reply.code(201).send({ circle: summary });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send({ error: "You already have a circle with this name" });
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>(
    "/circles/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const circle = await prisma.circle.findFirst({
        where: { id: request.params.id, ownerId: request.userId! },
        include: {
          members: { include: { user: true }, orderBy: { createdAt: "asc" } },
        },
      });
      if (!circle) return reply.code(404).send({ error: "Circle not found" });
      const detail: CircleDetail = {
        id: circle.id,
        name: circle.name,
        memberCount: circle.members.length,
        members: circle.members.map((member) => toPublicUser(member.user)),
      };
      return reply.send({ circle: detail });
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/circles/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = updateCircleSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const circle = await prisma.circle.findFirst({
        where: { id: request.params.id, ownerId: request.userId! },
        select: { id: true },
      });
      if (!circle) return reply.code(404).send({ error: "Circle not found" });
      try {
        await prisma.circle.update({ where: { id: circle.id }, data: { name: parsed.data.name } });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ error: "You already have a circle with this name" });
        }
        throw error;
      }
      return reply.code(204).send();
    }
  );

  // Posts and stories of a deleted circle stay, but only their author can see them.
  app.delete<{ Params: { id: string } }>(
    "/circles/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const result = await prisma.circle.deleteMany({
        where: { id: request.params.id, ownerId: request.userId! },
      });
      if (result.count === 0) return reply.code(404).send({ error: "Circle not found" });
      return reply.code(204).send();
    }
  );

  app.post<{ Params: { id: string } }>(
    "/circles/:id/members",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = circleMemberSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      const circle = await prisma.circle.findFirst({
        where: { id: request.params.id, ownerId: request.userId! },
        include: { _count: { select: { members: true } } },
      });
      if (!circle) return reply.code(404).send({ error: "Circle not found" });
      const target = await prisma.user.findFirst({
        where: { username: { equals: parsed.data.username, mode: "insensitive" } },
      });
      if (!target || target.id === request.userId || await isBlocked(request.userId!, target.id)) {
        return reply.code(404).send({ error: "User not found" });
      }
      if (circle._count.members >= MAX_CIRCLE_MEMBERS) {
        return reply.code(409).send({ error: `A circle can have up to ${MAX_CIRCLE_MEMBERS} members` });
      }
      const existing = await prisma.circleMember.findUnique({
        where: { circleId_userId: { circleId: circle.id, userId: target.id } },
        select: { id: true },
      });
      if (!existing) {
        await prisma.circleMember.create({ data: { circleId: circle.id, userId: target.id } });
        await createUserNotification({
          recipientId: target.id,
          actorId: request.userId!,
          type: "circle_added",
          dedupeKey: `circle-added:${circle.id}:${target.id}`,
        }).catch((error) => request.log.error(error, "Circle notification failed"));
      }
      return reply.code(204).send();
    }
  );

  app.delete<{ Params: { id: string; username: string } }>(
    "/circles/:id/members/:username",
    { preHandler: requireAuth },
    async (request, reply) => {
      const circle = await prisma.circle.findFirst({
        where: { id: request.params.id, ownerId: request.userId! },
        select: { id: true },
      });
      if (!circle) return reply.code(404).send({ error: "Circle not found" });
      await prisma.circleMember.deleteMany({
        where: {
          circleId: circle.id,
          user: { username: { equals: request.params.username, mode: "insensitive" } },
        },
      });
      return reply.code(204).send();
    }
  );

  // Which of my circles include this user (drives the profile page picker).
  app.get<{ Params: { username: string } }>(
    "/circles/containing/:username",
    { preHandler: requireAuth },
    async (request, reply) => {
      const memberships = await prisma.circleMember.findMany({
        where: {
          circle: { ownerId: request.userId! },
          user: { username: { equals: request.params.username, mode: "insensitive" } },
        },
        select: { circleId: true },
      });
      return reply.send({ circleIds: memberships.map((membership) => membership.circleId) });
    }
  );
}
