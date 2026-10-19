import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db.js";
import { env } from "./env.js";

export const INVITATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_INVITATIONS = 100;
export const INVITATION_MAX_USES = 5;

export function invitationProblem(invitation: { expiresAt: Date; redeemedAt: Date | null; useCount: number; maxUses: number } | null, now = new Date()): string | null {
  if (!invitation) return "Invitation code is invalid. Check the link or ask for a new invitation.";
  if (invitation.redeemedAt || invitation.useCount >= invitation.maxUses) return `This invitation has already been used ${invitation.maxUses} time${invitation.maxUses === 1 ? "" : "s"}. Ask for a new invitation link.`;
  if (invitation.expiresAt <= now) return "This invitation has expired. Invitation links are valid for 30 days; ask for a new link.";
  return null;
}

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
