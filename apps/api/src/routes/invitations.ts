import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import {
  createInvitationCode,
  hashInvitationCode,
  INVITATION_LIFETIME_MS,
  INVITATION_MAX_USES,
  MAX_ACTIVE_INVITATIONS,
} from "../invitations.js";

export async function invitationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/invitations", { preHandler: requireAuth }, async (request, reply) => {
    const activeCount = await prisma.invitation.count({
      where: {
        inviterId: request.userId!,
        redeemedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    return reply.send({
      activeCount,
      remaining: Math.max(0, MAX_ACTIVE_INVITATIONS - activeCount),
      maxActive: MAX_ACTIVE_INVITATIONS,
      maxUsesPerInvitation: INVITATION_MAX_USES,
    });
  });

  app.post("/invitations", { preHandler: requireAuth }, async (request, reply) => {
    const token = createInvitationCode();
    const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);

    try {
      const invitation = await prisma.$transaction(
        async (tx) => {
          const activeCount = await tx.invitation.count({
            where: {
              inviterId: request.userId!,
              redeemedAt: null,
              expiresAt: { gt: new Date() },
            },
          });
          if (activeCount >= MAX_ACTIVE_INVITATIONS) {
            return null;
          }
          return tx.invitation.create({
            data: {
              tokenHash: hashInvitationCode(token),
              inviterId: request.userId!,
              expiresAt,
              maxUses: INVITATION_MAX_USES,
            },
          });
        },
        { isolationLevel: "Serializable" }
      );
      if (!invitation) {
        return reply.code(429).send({ error: "You already have the maximum number of active invitations" });
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034"
      ) {
        return reply.code(409).send({ error: "Please retry creating the invitation" });
      }
      throw error;
    }

    return reply.code(201).send({
      code: token,
      expiresAt: expiresAt.toISOString(),
      maxUses: INVITATION_MAX_USES,
    });
  });
}
