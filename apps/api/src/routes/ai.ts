import type { FastifyInstance } from "fastify";
import {
  createAiProviderConfigSchema,
  sendAiMessageSchema,
  startAiConversationSchema,
  updateAiProviderConfigSchema,
} from "@app/shared";
import type { AiConversationMessage, AiMode, AiProviderConfigPublic } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { env } from "../env.js";
import { encryptSecret, decryptSecret } from "../ai/crypto.js";
import { createAdapter } from "../ai/adapters.js";
import type { ChatMessage } from "../ai/adapters.js";
import {
  buildInitialUserMessage,
  systemPromptForMode,
  FACTCHECK_SUMMARY_SYSTEM_PROMPT,
} from "../ai/prompts.js";

function toPublicMessage(message: {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}): AiConversationMessage {
  return {
    id: message.id,
    role: message.role as AiConversationMessage["role"],
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

function isSharedFreeModelConfig(config: {
  type: string;
  baseUrl: string;
  model: string;
}): boolean {
  return (
    config.type === "openai_compatible" &&
    config.baseUrl.replace(/\/$/, "") === "https://openrouter.ai/api/v1" &&
    config.model === "openrouter/free"
  );
}

function toPublicConfig(config: {
  id: string;
  label: string;
  type: string;
  baseUrl: string;
  model: string;
  isDefault: boolean;
  encryptedApiKey: string | null;
}): AiProviderConfigPublic {
  return {
    id: config.id,
    label: config.label,
    type: config.type as AiProviderConfigPublic["type"],
    baseUrl: config.baseUrl,
    model: config.model,
    isDefault: config.isDefault,
    apiKeySource: config.encryptedApiKey
      ? "personal"
      : isSharedFreeModelConfig(config) && env.openRouterApiKey
        ? "platform"
        : "missing",
  };
}

function apiKeyForConfig(config: {
  type: string;
  baseUrl: string;
  model: string;
  encryptedApiKey: string | null;
}): string | undefined {
  if (config.encryptedApiKey) return decryptSecret(config.encryptedApiKey);
  if (isSharedFreeModelConfig(config)) {
    return env.openRouterApiKey;
  }
  return undefined;
}

// Recomputes the post's public, opt-in FactCheck transparency summary from
// every shared factcheck conversation's initial result (not follow-ups, to
// keep the summary focused on the actual check rather than side dialogue).
async function regenerateFactCheckSummary(
  postId: string,
  adapter: { chat: (messages: ChatMessage[]) => Promise<string> }
): Promise<void> {
  const sharedConversations = await prisma.aiConversation.findMany({
    where: { postId, mode: "factcheck", shared: true },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 2 } },
  });
  const results = sharedConversations
    .map((c) => c.messages[1]?.content)
    .filter((c): c is string => !!c);
  if (results.length === 0) return;

  const summary = await adapter.chat([
    { role: "system", content: FACTCHECK_SUMMARY_SYSTEM_PROMPT },
    {
      role: "user",
      content: results
        .map((r, i) => `Ergebnis ${i + 1}:\n${r}`)
        .join("\n\n---\n\n"),
    },
  ]);

  await prisma.post.update({
    where: { id: postId },
    data: { factCheckSummary: summary, factCheckCount: results.length },
  });
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/ai/providers",
    { preHandler: requireAuth },
    async (request, reply) => {
      const configs = await prisma.aiProviderConfig.findMany({
        where: { userId: request.userId! },
        orderBy: { createdAt: "asc" },
      });
      let openRouterConfig = configs.find(
        (config) => config.label === "OpenRouter Free"
      );
      if (!openRouterConfig) {
        openRouterConfig = await prisma.aiProviderConfig.create({
          data: {
            userId: request.userId!,
            label: "OpenRouter Free",
            type: "openai_compatible",
            baseUrl: "https://openrouter.ai/api/v1",
            model: "openrouter/free",
            isDefault: !configs.some((config) => config.isDefault),
          },
        });
        configs.push(openRouterConfig);
      } else if (!configs.some((config) => config.isDefault)) {
        const configIndex = configs.findIndex(
          (config) => config.id === openRouterConfig!.id
        );
        openRouterConfig = await prisma.aiProviderConfig.update({
          where: { id: openRouterConfig.id },
          data: { isDefault: true },
        });
        configs[configIndex] = openRouterConfig;
      }
      return reply.send({ providers: configs.map(toPublicConfig) });
    }
  );

  app.post(
    "/ai/providers",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = createAiProviderConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const { apiKey, isDefault, ...rest } = parsed.data;

      if (isDefault) {
        await prisma.aiProviderConfig.updateMany({
          where: { userId: request.userId! },
          data: { isDefault: false },
        });
      }

      const config = await prisma.aiProviderConfig.create({
        data: {
          ...rest,
          userId: request.userId!,
          isDefault: Boolean(isDefault),
          encryptedApiKey: apiKey ? encryptSecret(apiKey) : null,
        },
      });
      return reply.code(201).send({ provider: toPublicConfig(config) });
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/ai/providers/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const config = await prisma.aiProviderConfig.findUnique({
        where: { id: request.params.id },
      });
      if (!config || config.userId !== request.userId) {
        return reply.code(404).send({ error: "Provider not found" });
      }
      await prisma.aiProviderConfig.delete({ where: { id: config.id } });
      return reply.code(204).send();
    }
  );

  app.patch<{ Params: { id: string } }>(
    "/ai/providers/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const existing = await prisma.aiProviderConfig.findUnique({
        where: { id: request.params.id },
      });
      if (!existing || existing.userId !== request.userId) {
        return reply.code(404).send({ error: "Provider not found" });
      }
      const parsed = updateAiProviderConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const { apiKey, isDefault, ...rest } = parsed.data;

      if (isDefault) {
        await prisma.aiProviderConfig.updateMany({
          where: { userId: request.userId!, NOT: { id: existing.id } },
          data: { isDefault: false },
        });
      }

      const config = await prisma.aiProviderConfig.update({
        where: { id: existing.id },
        data: {
          ...rest,
          ...(isDefault !== undefined ? { isDefault } : {}),
          ...(apiKey !== undefined
            ? { encryptedApiKey: apiKey ? encryptSecret(apiKey) : null }
            : {}),
        },
      });
      return reply.send({ provider: toPublicConfig(config) });
    }
  );

  app.post(
    "/ai/conversations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = startAiConversationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const { postId, providerConfigId, mode, customPrompt, shared } = parsed.data;
      if (mode === "custom" && !customPrompt) {
        return reply
          .code(400)
          .send({ error: "customPrompt is required for mode 'custom'" });
      }

      const [post, config] = await Promise.all([
        prisma.post.findUnique({ where: { id: postId }, include: { author: true } }),
        prisma.aiProviderConfig.findUnique({ where: { id: providerConfigId } }),
      ]);
      if (!post) {
        return reply.code(404).send({ error: "Post not found" });
      }
      if (!config || config.userId !== request.userId) {
        return reply.code(404).send({ error: "Provider not found" });
      }

      const systemPrompt = systemPromptForMode(mode);
      const initialUserMessage = buildInitialUserMessage(
        mode,
        {
          authorUsername: post.author.username,
          authorDisplayName: post.author.displayName,
          createdAt: post.createdAt,
          text: post.text,
          hasImage: !!post.imageKey,
        },
        customPrompt
      );

      try {
        const adapter = createAdapter(config.type, {
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: apiKeyForConfig(config),
        });
        const reply1 = await adapter.chat([
          { role: "system", content: systemPrompt },
          { role: "user", content: initialUserMessage },
        ]);

        const conversation = await prisma.aiConversation.create({
          data: {
            userId: request.userId!,
            postId,
            mode,
            providerLabel: config.label,
            shared: mode === "factcheck" ? !!shared : false,
            messages: {
              create: [
                { role: "user", content: initialUserMessage },
                { role: "assistant", content: reply1 },
              ],
            },
          },
          include: { messages: { orderBy: { createdAt: "asc" } } },
        });

        if (mode === "factcheck" && shared) {
          regenerateFactCheckSummary(postId, adapter).catch((err) =>
            request.log.error(err, "FactCheck summary regeneration failed")
          );
        }

        return reply.code(201).send({
          conversation: {
            id: conversation.id,
            postId: conversation.postId,
            mode: conversation.mode,
            providerLabel: conversation.providerLabel,
            messages: conversation.messages.map(toPublicMessage),
          },
        });
      } catch (err) {
        request.log.error(err, "AI provider request failed");
        const message = err instanceof Error ? err.message : "Unknown error";
        return reply
          .code(502)
          .send({ error: `AI provider request failed: ${message}` });
      }
    }
  );

  app.get<{ Querystring: { postId: string } }>(
    "/ai/conversations",
    { preHandler: requireAuth },
    async (request, reply) => {
      const conversations = await prisma.aiConversation.findMany({
        where: { userId: request.userId!, postId: request.query.postId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "asc" },
      });
      return reply.send({
        conversations: conversations.map((c) => ({
          id: c.id,
          postId: c.postId,
          mode: c.mode,
          providerLabel: c.providerLabel,
          messages: c.messages.map(toPublicMessage),
        })),
      });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/ai/conversations/:id/messages",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = sendAiMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const conversation = await prisma.aiConversation.findUnique({
        where: { id: request.params.id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!conversation || conversation.userId !== request.userId) {
        return reply.code(404).send({ error: "Conversation not found" });
      }
      const config = await prisma.aiProviderConfig.findFirst({
        where: { userId: request.userId!, label: conversation.providerLabel },
      });
      if (!config) {
        return reply
          .code(404)
          .send({ error: "The provider used for this conversation no longer exists" });
      }

      const history: ChatMessage[] = [
        { role: "system", content: systemPromptForMode(conversation.mode as AiMode) },
        ...conversation.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: parsed.data.text },
      ];

      try {
        const adapter = createAdapter(config.type, {
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: apiKeyForConfig(config),
        });
        const replyText = await adapter.chat(history);

        const [, assistantMessage] = await prisma.$transaction([
          prisma.aiConversationMessage.create({
            data: {
              conversationId: conversation.id,
              role: "user",
              content: parsed.data.text,
            },
          }),
          prisma.aiConversationMessage.create({
            data: {
              conversationId: conversation.id,
              role: "assistant",
              content: replyText,
            },
          }),
        ]);

        return reply.code(201).send({ message: toPublicMessage(assistantMessage) });
      } catch (err) {
        request.log.error(err, "AI provider request failed");
        const message = err instanceof Error ? err.message : "Unknown error";
        return reply
          .code(502)
          .send({ error: `AI provider request failed: ${message}` });
      }
    }
  );
}
