import { describe, expect, it } from "vitest";
import { isBlockedAddress } from "./ipPolicy.js";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.5",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fe80::1%eth0",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1",
    "not-an-ip",
    "",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "100.63.255.255",
    "104.18.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
  ])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});
