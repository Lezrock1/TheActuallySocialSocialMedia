import webpush from "web-push";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { createPushPayload, type PushPayloadInput } from "./pushPayload.js";

type PushInput = Omit<PushPayloadInput, "actorUsername"> & {
  recipientId: string;
  actorId: string;
};

export async function sendWebPushNotification(input: PushInput): Promise<void> {
  if (!env.webPushPublicKey || !env.webPushPrivateKey) return;

  const [actor, subscriptions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.actorId },
      select: { username: true },
    }),
    prisma.webPushSubscription.findMany({
      where: { userId: input.recipientId },
    }),
  ]);
  if (!actor || subscriptions.length === 0) return;

  webpush.setVapidDetails(
    env.webPushSubject,
    env.webPushPublicKey,
    env.webPushPrivateKey
  );
  const payload = JSON.stringify(createPushPayload({
    ...input,
    actorUsername: actor.username,
  }));

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, { TTL: 60 });
    } catch (error) {
      const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
          ? error.statusCode
          : undefined;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.webPushSubscription.deleteMany({
          where: { id: subscription.id },
        });
      }
    }
  }));
}