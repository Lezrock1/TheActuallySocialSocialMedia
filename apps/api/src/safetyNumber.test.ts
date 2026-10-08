import { describe, expect, it } from "vitest";
import { computeSafetyNumber, safetyNumberQrPayload } from "@app/shared";

const alice = { userId: "user-a", fingerprints: ["bbb", "aaa"] };
const bob = { userId: "user-b", fingerprints: ["ccc"] };

describe("safety number", () => {
  it("is 60 digits and identical for both parties", async () => {
    const forAlice = await computeSafetyNumber(alice, bob);
    const forBob = await computeSafetyNumber(bob, alice);
    expect(forAlice).toMatch(/^(\d{5} ){11}\d{5}$/);
    expect(forAlice).toBe(forBob);
  });

  it("does not depend on fingerprint order", async () => {
    const reordered = { ...alice, fingerprints: ["aaa", "bbb"] };
    expect(await computeSafetyNumber(reordered, bob)).toBe(await computeSafetyNumber(alice, bob));
  });

  it("changes when a device key changes", async () => {
    const original = await computeSafetyNumber(alice, bob);
    const changed = await computeSafetyNumber(alice, { ...bob, fingerprints: ["ccc", "ddd"] });
    expect(changed).not.toBe(original);
  });

  it("builds a stable QR payload", async () => {
    const number = await computeSafetyNumber(alice, bob);
    expect(safetyNumberQrPayload(bob, alice, number)).toBe(safetyNumberQrPayload(alice, bob, number));
    expect(safetyNumberQrPayload(alice, bob, number)).toContain("intouch-verify:v1:user-a:user-b:");
  });
});
