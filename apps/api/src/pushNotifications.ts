import webpush from "web-push";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { createPushPayload, type PushPayloadInput } from "./pushPayload.js";

type PushInput = Omit<PushPayloadInput, "actorUsername"> & {
  recipientId: string;
  actorId: string;
};

const DIGEST_TTL_SECONDS = 12 * 60 * 60;

function configureWebPush(): boolean {
  if (!env.webPushPublicKey || !env.webPushPrivateKey) return false;
  webpush.setVapidDetails(env.webPushSubject, env.webPushPublicKey, env.webPushPrivateKey);
  return true;
}

async function deliver(
  subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[],
  payload: string,
  ttl: number
): Promise<void> {
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, { TTL: ttl });
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

export async function sendWebPushNotification(input: PushInput): Promise<void> {
  if (!configureWebPush()) return;

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

  const payload = JSON.stringify(createPushPayload({
    ...input,
    actorUsername: actor.username,
  }));
  await deliver(subscriptions, payload, 60);
}

// One summary push for everything held back during quiet hours; carries no content.
export async function sendQuietHoursDigest(userId: string, count: number): Promise<void> {
  if (count <= 0 || !configureWebPush()) return;
  const subscriptions = await prisma.webPushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title: "InTouch",
    body: count === 1
      ? "1 new notification while you were away"
      : `${count} new notifications while you were away`,
    url: "/notifications",
    tag: "quiet-hours-digest",
  });
  await deliver(subscriptions, payload, DIGEST_TTL_SECONDS);
}
