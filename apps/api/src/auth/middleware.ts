import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAuthToken } from "./token.js";
import { prisma } from "../db.js";

const COOKIE_NAME = "auth_token";
export const AUTH_COOKIE_NAME = COOKIE_NAME;

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = request.cookies[COOKIE_NAME];
  if (!token) {
    reply.code(401).send({ error: "Not authenticated" });
    return;
  }
  try {
    const payload = verifyAuthToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true },
    });
    if (!user) {
      reply.clearCookie(COOKIE_NAME, { path: "/" });
      reply.code(401).send({ error: "Account no longer exists" });
      return;
    }
    request.userId = payload.userId;
  } catch {
    reply.code(401).send({ error: "Invalid or expired session" });
  }
}
