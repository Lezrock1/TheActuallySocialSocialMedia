import { describe, expect, it } from "vitest";
import { matchesDeploymentToken } from "./deploymentToken.js";

describe("matchesDeploymentToken", () => {
  it("accepts only the exact configured token", () => {
    expect(matchesDeploymentToken("secret-value", "secret-value")).toBe(true);
    expect(matchesDeploymentToken("wrong-value", "secret-value")).toBe(false);
    expect(matchesDeploymentToken(undefined, "secret-value")).toBe(false);
    expect(matchesDeploymentToken("", "secret-value")).toBe(false);
  });
});