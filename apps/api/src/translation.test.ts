import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(), externalPost: vi.fn(), user: vi.fn(), provider: vi.fn(), chat: vi.fn(), canView: vi.fn(),
  visibleRepost: vi.fn(),
}));
vi.mock("./db.js", () => ({ prisma: {
  post: { findUnique: mocks.post }, externalPost: { findFirst: mocks.externalPost },
  user: { findUnique: mocks.user }, aiProviderConfig: { findFirst: mocks.provider },
} }));
vi.mock("./env.js", () => ({ env: {} }));
vi.mock("./external.js", () => ({ visibleExternalRepost: mocks.visibleRepost }));
vi.mock("./auth/middleware.js", () => ({ requireAuth: async (request: { userId: string }) => { request.userId = "viewer"; } }));
vi.mock("./ai/adapters.js", () => ({ createAdapter: () => ({ chat: mocks.chat }) }));
vi.mock("./ai/crypto.js", () => ({ encryptSecret: vi.fn(), decryptSecret: vi.fn() }));
vi.mock("./visibility.js", () => ({ canViewContent: mocks.canView }));
import { aiRoutes } from "./routes/ai.js";

async function translate(payload: unknown) {
  const app = Fastify();
  await app.register(aiRoutes);
  try {
    return await app.inject({ method: "POST", url: "/ai/translate", payload: payload as Record<string, unknown> });
  } finally {
    await app.close();
  }
}

describe("post translation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.user.mockResolvedValue({ translationLanguage: "fr" });
    mocks.externalPost.mockResolvedValue({ text: "A cached external post" });
    mocks.post.mockResolvedValue({ text: "Internal post", authorId: "viewer" });
    mocks.provider.mockResolvedValue({ type: "openai_compatible", baseUrl: "https://example.com", model: "test", encryptedApiKey: null });
    mocks.chat.mockResolvedValue("Une publication traduite");
    mocks.canView.mockResolvedValue(true);
    mocks.visibleRepost.mockResolvedValue(null);
  });

  it.each(["bluesky", "mastodon", "youtube"])("translates %s from the viewer's cached follows", async (platform) => {
    const response = await translate({ externalPost: { platform, externalId: "external-123" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ translation: "Une publication traduite" });
    expect(mocks.externalPost).toHaveBeenCalledWith({ where: { platform, externalId: "external-123", follow: { userId: "viewer" } } });
    expect(mocks.chat.mock.calls[0][0][0].content).toContain("Français");
    expect(mocks.chat.mock.calls[0][0][1].content).toBe("A cached external post");
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("keeps internal post translation working", async () => {
    expect((await translate({ postId: "internal" })).statusCode).toBe(200);
    expect(mocks.chat.mock.calls[0][0][1].content).toBe("Internal post");
  });

  it("translates a visible friend's repost without an external follow", async () => {
    mocks.externalPost.mockResolvedValue(null);
    mocks.visibleRepost.mockResolvedValue({ text: "A friend's repost" });
    expect((await translate({ externalPost: { platform: "bluesky", externalId: "reposted" } })).statusCode).toBe(200);
    expect(mocks.chat.mock.calls[0][0][1].content).toBe("A friend's repost");
  });

  it("rejects inaccessible external posts without calling the provider", async () => {
    mocks.externalPost.mockResolvedValue(null);
    expect((await translate({ externalPost: { platform: "bluesky", externalId: "missing" } })).statusCode).toBe(404);
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it("retains visibility checks for internal posts", async () => {
    mocks.post.mockResolvedValue({ text: "Private", authorId: "other" });
    mocks.canView.mockResolvedValue(false);
    expect((await translate({ postId: "private" })).statusCode).toBe(404);
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it.each([{}, { postId: "internal", externalPost: { platform: "youtube", externalId: "video" } }])("requires exactly one content source: %j", async (payload) => {
    expect((await translate(payload)).statusCode).toBe(400);
  });

  it("reports a missing provider", async () => {
    mocks.provider.mockResolvedValue(null);
    expect((await translate({ postId: "internal" })).statusCode).toBe(409);
  });

  it("reports provider failures", async () => {
    mocks.chat.mockRejectedValue(new Error("Offline"));
    expect((await translate({ postId: "internal" })).statusCode).toBe(502);
  });
});