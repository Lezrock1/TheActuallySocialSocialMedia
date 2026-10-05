import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  registerSchema,
  updateAccountSchema,
} from "@app/shared";

describe("account setting validation", () => {
  it("normalizes usernames for registration and updates", () => {
    const registration = registerSchema.parse({
      email: "PERSON@EXAMPLE.COM",
      username: "Alice_7",
      password: "secure-pass-123",
      inviteCode: "x".repeat(32),
    });
    const accountUpdate = updateAccountSchema.parse({
      email: "PERSON@EXAMPLE.COM",
      username: "Alice_7",
      currentPassword: "secure-pass-123",
    });

    expect(registration.email).toBe("person@example.com");
    expect(registration.username).toBe("alice_7");
    expect(accountUpdate.email).toBe("person@example.com");
    expect(accountUpdate.username).toBe("alice_7");
  });

  it("requires a new password with at least eight characters", () => {
    expect(changePasswordSchema.safeParse({
      currentPassword: "current-pass",
      newPassword: "short",
    }).success).toBe(false);
    expect(changePasswordSchema.safeParse({
      currentPassword: "current-pass",
      newPassword: "new-password-123",
    }).success).toBe(true);
  });
});