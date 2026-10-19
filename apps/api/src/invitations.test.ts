import { describe, expect, it } from "vitest";
import { INVITATION_LIFETIME_MS, invitationProblem } from "./invitations.js";

describe("invitation lifetime and errors", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const valid = { expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_MS), redeemedAt: null, useCount: 0, maxUses: 5 };
  it("uses thirty days", () => expect(INVITATION_LIFETIME_MS).toBe(30 * 24 * 60 * 60 * 1000));
  it("allows partially redeemed invitations", () => expect(invitationProblem({ ...valid, useCount: 2 }, now)).toBeNull());
  it("does not report a fully used invitation as expired", () => expect(invitationProblem({ ...valid, useCount: 5, redeemedAt: now }, now)).toContain("already been used 5 times"));
  it("distinguishes time expiry", () => expect(invitationProblem({ ...valid, expiresAt: now }, now)).toContain("has expired"));
  it("distinguishes invalid codes", () => expect(invitationProblem(null, now)).toContain("code is invalid"));
});