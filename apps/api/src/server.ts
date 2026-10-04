import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import { ensureBucket } from "./storage.js";
import { ensureBootstrapInvitation } from "./invitations.js";
import { createRealtimeServer } from "./realtime.js";
import { startCleanupJob } from "./cleanup.js";
import { authRoutes } from "./routes/auth.js";
import { followRoutes } from "./routes/follow.js";
import { postRoutes } from "./routes/posts.js";
import { mediaRoutes } from "./routes/media.js";
import { storyRoutes } from "./routes/stories.js";
import { snapRoutes } from "./routes/snaps.js";
import { conversationRoutes } from "./routes/conversations.js";
import { aiRoutes } from "./routes/ai.js";
import { userRoutes } from "./routes/users.js";
import { invitationRoutes } from "./routes/invitations.js";
import { commentRoutes } from "./routes/comments.js";
import { moderationRoutes } from "./routes/moderation.js";
import { closeFriendRoutes } from "./routes/closeFriends.js";
import { notificationRoutes } from "./routes/notifications.js";
import { encryptionRoutes } from "./routes/encryption.js";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: env.corsOrigin, credentials: true });
  await app.register(cookie);
  await app.register(multipart);

  await ensureBucket();
  await ensureBootstrapInvitation();

  const io = createRealtimeServer(app.server);
  app.decorate("io", io);
  startCleanupJob(app.log);

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(followRoutes);
  await app.register(postRoutes);
  await app.register(mediaRoutes);
  await app.register(storyRoutes);
  await app.register(snapRoutes);
  await app.register(conversationRoutes);
  await app.register(aiRoutes);
  await app.register(userRoutes);
  await app.register(invitationRoutes);
  await app.register(commentRoutes);
  await app.register(moderationRoutes);
  await app.register(closeFriendRoutes);
  await app.register(notificationRoutes);
  await app.register(encryptionRoutes);

  await app.listen({ port: env.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
