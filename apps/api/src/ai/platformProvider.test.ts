import { describe, expect, it } from "vitest";
import { isPlatformOpenAiConfig, mayBorrowPlatformKey, platformOpenAiEnabled } from "./platformProvider.js";

const platform = { apiKey: "sk-test", model: "server-model" };
const shared = { type: "openai_compatible", baseUrl: "https://api.openai.com/v1/", model: "server-model" };

describe("platform OpenAI provider", () => {
  it("is only active when both the key and the model are configured", () => {
    expect(platformOpenAiEnabled(platform)).toBe(true);
    expect(platformOpenAiEnabled({ apiKey: "sk-test" })).toBe(false);
    expect(platformOpenAiEnabled({ model: "server-model" })).toBe(false);
  });

  it("recognises the shared provider regardless of a trailing slash", () => {
    expect(isPlatformOpenAiConfig(shared, platform)).toBe(true);
    expect(isPlatformOpenAiConfig({ ...shared, model: "other" }, platform)).toBe(false);
    expect(isPlatformOpenAiConfig({ ...shared, baseUrl: "https://example.com/v1" }, platform)).toBe(false);
    expect(isPlatformOpenAiConfig(shared, {})).toBe(false);
  });

  it("stops users from borrowing the shared key through a new or edited provider", () => {
    expect(mayBorrowPlatformKey(shared, false, null, platform)).toBe(false);
    expect(mayBorrowPlatformKey(shared, true, null, platform)).toBe(true);
    const other = { type: "openai_compatible", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/free", hasOwnKey: false };
    expect(mayBorrowPlatformKey(shared, false, other, platform)).toBe(false);
    expect(mayBorrowPlatformKey({ ...shared, model: "other" }, false, null, platform)).toBe(true);
  });

  it("lets the server-created provider keep working when only its default flag changes", () => {
    const existing = { ...shared, hasOwnKey: false };
    expect(mayBorrowPlatformKey(shared, false, existing, platform)).toBe(true);
  });
});
