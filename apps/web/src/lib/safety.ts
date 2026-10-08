import { useEffect, useState } from "react";
import { computeSafetyNumber } from "@app/shared";
import { getVerifiedSafetyNumber } from "./encryption.js";
import type { PublicEncryptionKey } from "./encryption.js";

export type VerificationStatus = "unavailable" | "unverified" | "verified" | "changed";

export interface PeerSafety {
  safetyNumber: string | null;
  status: VerificationStatus;
}

function fingerprintsOf(keys: PublicEncryptionKey[], userId: string): string[] {
  return keys.filter((key) => key.userId === userId).map((key) => key.fingerprint);
}

// `version` lets callers re-read the verified state after the user confirms a code.
export function usePeerSafety(
  meId: string | undefined,
  peerIds: string[],
  keys: PublicEncryptionKey[],
  version = 0
): Record<string, PeerSafety> {
  const [result, setResult] = useState<Record<string, PeerSafety>>({});
  const signature = `${peerIds.join(",")}|${keys.map((key) => `${key.userId}:${key.fingerprint}`).sort().join(",")}|${version}`;

  useEffect(() => {
    if (!meId) return;
    let active = true;
    void (async () => {
      const entries = await Promise.all(peerIds.map(async (peerId): Promise<[string, PeerSafety]> => {
        const mine = fingerprintsOf(keys, meId);
        const theirs = fingerprintsOf(keys, peerId);
        if (mine.length === 0 || theirs.length === 0) {
          return [peerId, { safetyNumber: null, status: "unavailable" }];
        }
        const safetyNumber = await computeSafetyNumber(
          { userId: meId, fingerprints: mine },
          { userId: peerId, fingerprints: theirs }
        );
        const verified = await getVerifiedSafetyNumber(meId, peerId).catch(() => null);
        const status: VerificationStatus = !verified ? "unverified" : verified === safetyNumber ? "verified" : "changed";
        return [peerId, { safetyNumber, status }];
      }));
      if (active) setResult(Object.fromEntries(entries));
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, signature]);

  return result;
}

export function overallStatus(peers: PeerSafety[]): VerificationStatus {
  if (peers.length === 0 || peers.some((peer) => peer.status === "unavailable")) return "unavailable";
  if (peers.some((peer) => peer.status === "changed")) return "changed";
  return peers.every((peer) => peer.status === "verified") ? "verified" : "unverified";
}
