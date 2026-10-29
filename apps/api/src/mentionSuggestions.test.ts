import { describe, expect, it } from "vitest";
import { rankMentionCandidates } from "./mentionSuggestions.js";

const people = [
  { id: "1", username: "emilia", displayName: "Emilia Stone" },
  { id: "2", username: "mia", displayName: "Mia Berg" },
  { id: "3", username: "mike", displayName: "Michael Roe" },
  { id: "4", username: "lena", displayName: "Mia Lena" },
];

describe("rankMentionCandidates", () => {
  it("puts prefix matches before loose matches", () => {
    const ranked = rankMentionCandidates(people, "mi", new Set());
    expect(ranked.map((person) => person.username)).toEqual(["mia", "mike", "lena", "emilia"]);
  });

  it("prefers an exact username and then people you follow", () => {
    expect(rankMentionCandidates(people, "mia", new Set(["1"]))[0].username).toBe("mia");
    expect(rankMentionCandidates(people, "mi", new Set(["3"]))[0].username).toBe("mike");
  });

  it("lists followed people first when nothing is typed yet and caps the result", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ id: `u${index}`, username: `user${index}`, displayName: null }));
    const ranked = rankMentionCandidates(many, "", new Set(["u9"]), 6);
    expect(ranked).toHaveLength(6);
    expect(ranked[0].id).toBe("u9");
  });
});
