import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { loginSchema, registerSchema } from "@app/shared";
import { prisma } from "../db.js";
import { signAuthToken } from "../auth/token.js";
import { AUTH_COOKIE_NAME, requireAuth } from "../auth/middleware.js";
import { env } from "../env.js";
import { toPublicUser } from "../serializers.js";
import { hashInvitationCode } from "../invitations.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.nodeEnv === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

class InvalidInvitationError extends Error {}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, username, password, inviteCode } = parsed.data;

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      return reply.code(409).send({ error: "Email or username already taken" });
    }

    const passwordHash = await argon2.hash(password);
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        const claim = await tx.invitation.updateMany({
          where: {
            tokenHash: hashInvitationCode(inviteCode),
            redeemedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { redeemedAt: new Date() },
        });
        if (claim.count !== 1) {
          throw new InvalidInvitationError();
        }
        return tx.user.create({ data: { email, username, passwordHash } });
      });
    } catch (error) {
      if (error instanceof InvalidInvitationError) {
        return reply.code(400).send({ error: "Invitation code is invalid, expired, or already used" });
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return reply.code(409).send({ error: "Email or username already taken" });
      }
      throw error;
    }

    const token = signAuthToken({ userId: user.id });
    reply.setCookie(AUTH_COOKIE_NAME, token, COOKIE_OPTIONS);
    return reply.code(201).send({ user: toPublicUser(user) });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const token = signAuthToken({ userId: user.id });
    reply.setCookie(AUTH_COOKIE_NAME, token, COOKIE_OPTIONS);
    return reply.send({ user: toPublicUser(user) });
  });

  app.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get(
    "/auth/me",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.userId },
      });
      if (!user) {
        return reply.code(404).send({ error: "User not found" });
      }
      return reply.send({ user: toPublicUser(user) });
    }
  );
}
