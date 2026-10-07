import { BlockList, isIP } from "node:net";

const blocked = new BlockList();

const blockedIpv4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const blockedIpv6: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

for (const [network, prefix] of blockedIpv4) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of blockedIpv6) blocked.addSubnet(network, prefix, "ipv6");

function expandIpv6(address: string): number[] | null {
  let text = address;
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const parts = tail.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const high = ((parts[0] << 8) | parts[1]).toString(16);
    const low = ((parts[2] << 8) | parts[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const values = groups.map((group) => parseInt(group, 16));
  return values.length === 8 && values.every((value) => Number.isInteger(value)) ? values : null;
}

function embeddedIpv4(groups: number[]): string | null {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const mapped = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff;
  const nat64 = g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (!mapped && !nat64) return null;
  return `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
}

// Anything that is not a plain, public unicast address is rejected.
export function isBlockedAddress(address: string): boolean {
  const unscoped = address.split("%")[0];
  const family = isIP(unscoped);
  if (family === 0) return true;
  if (family === 4) return blocked.check(unscoped, "ipv4");
  const groups = expandIpv6(unscoped);
  if (!groups) return true;
  const embedded = embeddedIpv4(groups);
  if (embedded) return isBlockedAddress(embedded);
  return blocked.check(unscoped, "ipv6");
}
