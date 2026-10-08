export interface SafetyKeySet {
  userId: string;
  fingerprints: string[];
}

const GROUPS = 12;
const BYTES_PER_GROUP = 5;

function describe(keys: SafetyKeySet): string {
  return `${keys.userId}:${[...keys.fingerprints].sort().join(",")}`;
}

// 60 digits derived from both users' device-key fingerprints; identical on both sides.
export async function computeSafetyNumber(a: SafetyKeySet, b: SafetyKeySet): Promise<string> {
  const [first, second] = [a, b].sort((left, right) => left.userId.localeCompare(right.userId));
  const material = new TextEncoder().encode(`intouch-safety-v1|${describe(first)}|${describe(second)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", material));
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group += 1) {
    let value = 0;
    for (let index = 0; index < BYTES_PER_GROUP; index += 1) {
      value = value * 256 + digest[group * BYTES_PER_GROUP + index];
    }
    groups.push(String(value % 100000).padStart(5, "0"));
  }
  return groups.join(" ");
}

export function safetyNumberQrPayload(a: SafetyKeySet, b: SafetyKeySet, safetyNumber: string): string {
  const [first, second] = [a, b].sort((left, right) => left.userId.localeCompare(right.userId));
  return `intouch-verify:v1:${first.userId}:${second.userId}:${safetyNumber.replace(/\s/g, "")}`;
}
