import { describe, expect, it } from "vitest";
import { suggestionEntries } from "./externalSuggestions.js";

describe("suggestionEntries", () => {
  it("filters by platform and topic", () => {
    const entries = suggestionEntries("bluesky", "news", "en");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.topics.includes("news"))).toBe(true);
  });

  it("shows localized entries only to matching languages, sorted first", () => {
    const german = suggestionEntries("youtube", "gaming", "de");
    expect(german.some((entry) => entry.handle === "handofblood")).toBe(true);
    expect(german[0]?.langs).toBeDefined();

    const english = suggestionEntries("youtube", "gaming", "en");
    expect(english.some((entry) => entry.handle === "handofblood")).toBe(false);
  });

  it("falls back to universal entries for other languages", () => {
    const french = suggestionEntries("bluesky", "comedy", "fr");
    expect(french.length).toBeGreaterThan(0);
    expect(french.every((entry) => !entry.langs)).toBe(true);
  });
});
