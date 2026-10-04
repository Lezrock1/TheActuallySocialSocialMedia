import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db.js";
import { env } from "./env.js";

export const INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_INVITATIONS = 100;

export function hashInvitationCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function createInvitationCode(): string {
  return randomBytes(32).toString("base64url");
}

export async function ensureBootstrapInvitation(): Promise<void> {
  if (!env.bootstrapInviteCode) return;
  if ((await prisma.user.count()) > 0) return;

  const tokenHash = hashInvitationCode(env.bootstrapInviteCode);
  const existing = await prisma.invitation.findUnique({ where: { tokenHash } });
  if (!existing) {
    await prisma.invitation.create({
      data: {
        tokenHash,
        expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS),
      },
    });
  } else if (!existing.redeemedAt) {
    await prisma.invitation.update({
      where: { id: existing.id },
      data: { expiresAt: new Date(Date.now() + INVITATION_LIFETIME_MS) },
    });
  }
}
