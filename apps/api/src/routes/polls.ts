import type { FastifyInstance } from "fastify";
import { votePollSchema } from "@app/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { isBlocked } from "../visibility.js";

async function getVisiblePoll(pollId: string, userId: string) {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      post: { select: { authorId: true, visibility: true } },
      options: {
        orderBy: { position: "asc" },
        include: { _count: { select: { votes: true } } },
      },
      votes: { where: { userId }, select: { optionId: true } },
    },
  });
  if (!poll || await isBlocked(userId, poll.post.authorId)) return null;

  if (poll.post.visibility === "close_friends" && poll.post.authorId !== userId) {
    const closeFriend = await prisma.closeFriend.findUnique({
      where: {
        ownerId_friendId: {
          ownerId: poll.post.authorId,
          friendId: userId,
        },
      },
    });
    if (!closeFriend) return null;
  }

  const totalVotes = poll.options.reduce((total, option) => total + option._count.votes, 0);
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options.map((option) => ({
      id: option.id,
      text: option.text,
      voteCount: option._count.votes,
    })),
    totalVotes,
    myVoteOptionId: poll.votes[0]?.optionId ?? null,
    isAuthor: poll.post.authorId === userId,
  };
}

export async function pollRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/polls/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const poll = await getVisiblePoll(request.params.id, request.userId!);
      if (!poll) return reply.code(404).send({ error: "Poll not found" });
      return reply.send({ poll });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/polls/:id/vote",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = votePollSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const poll = await getVisiblePoll(request.params.id, request.userId!);
      if (!poll) return reply.code(404).send({ error: "Poll not found" });
      if (poll.myVoteOptionId) return reply.code(409).send({ error: "You already voted" });

      const option = await prisma.pollOption.findFirst({
        where: { id: parsed.data.optionId, pollId: request.params.id },
        select: { id: true },
      });
      if (!option) return reply.code(400).send({ error: "Poll option not found" });

      await prisma.pollVote.upsert({
        where: {
          pollId_userId: {
            pollId: request.params.id,
            userId: request.userId!,
          },
        },
        create: {
          pollId: request.params.id,
          optionId: option.id,
          userId: request.userId!,
        },
        update: { optionId: option.id },
      });

      const updatedPoll = await getVisiblePoll(request.params.id, request.userId!);
      if (!updatedPoll) return reply.code(404).send({ error: "Poll not found" });
      return reply.send({ poll: updatedPoll });
    }
  );
}