import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../env.js";

export interface AuthTokenPayload {
  userId: string;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "30d" });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
}

// Separate signing key so a download token can never double as a session token.
const exportSecret = `${env.jwtSecret}:account-export`;

export function signExportToken(userId: string): string {
  return jwt.sign({ userId, purpose: "export", jti: randomUUID() }, exportSecret, { expiresIn: "60s" });
}

export function verifyExportToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, exportSecret) as { userId?: string; purpose?: string };
    return payload.purpose === "export" && payload.userId ? payload.userId : null;
  } catch {
    return null;
  }
}
