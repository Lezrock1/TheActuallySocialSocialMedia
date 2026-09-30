import type { User } from "@prisma/client";
import type { PublicUser } from "@app/shared";

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarKey: user.avatarKey,
    createdAt: user.createdAt.toISOString(),
  };
}
