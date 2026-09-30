import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAuthToken } from "./token.js";

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
    request.userId = payload.userId;
  } catch {
    reply.code(401).send({ error: "Invalid or expired session" });
  }
}
