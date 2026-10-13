import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { matchesDeploymentToken } from "../deploymentToken.js";

const deploymentStatusSchema = z.object({
  status: z.enum(["started", "complete", "failed"]),
});

export async function deploymentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/system/deployment", async (request, reply) => {
    const tokenHeader = request.headers["x-deployment-token"];
    const token = typeof tokenHeader === "string" ? tokenHeader : undefined;
    if (!matchesDeploymentToken(token, env.jwtSecret)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const parsed = deploymentStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid deployment status" });
    }

    app.io.emit("deployment:status", {
      status: parsed.data.status,
      emittedAt: new Date().toISOString(),
    });
    return reply.send({ ok: true });
  });
}