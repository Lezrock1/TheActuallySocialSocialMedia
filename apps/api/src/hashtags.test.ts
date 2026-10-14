import { describe, expect, it } from "vitest";
import { extractHashtags, normalizeHashtag } from "@app/shared";

describe("hashtags", () => {
  it("normalizes tags and supports German names and underscores", () => {
    expect(extractHashtags("#Berlin #BERLIN #Grüße #house_music! #2026")).toEqual(["berlin", "grüße", "house_music", "2026"]);
    expect(normalizeHashtag("#BERLIN")).toBe("berlin");
  });
  it("ignores fragments in URLs and embedded word characters", () => {
    expect(extractHashtags("https://example.com/#secret www.example.com/#hidden email#notatag (#real)." )).toEqual(["real"]);
  });
  it("rejects overlong tags and handles empty input", () => {
    expect(extractHashtags(`#${"a".repeat(65)}`)).toEqual([]);
    expect(extractHashtags("")).toEqual([]);
  });
});