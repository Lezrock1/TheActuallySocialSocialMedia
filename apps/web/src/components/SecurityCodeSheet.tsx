import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { safetyNumberQrPayload } from "@app/shared";
import type { PublicUser } from "@app/shared";
import Sheet from "./Sheet.js";
import Avatar from "./Avatar.js";
import { btnPrimary, btnSecondary } from "../lib/ui.js";
import { setVerifiedSafetyNumber } from "../lib/encryption.js";
import type { PublicEncryptionKey } from "../lib/encryption.js";
import { usePeerSafety } from "../lib/safety.js";
import type { VerificationStatus } from "../lib/safety.js";

type Peer = Pick<PublicUser, "id" | "username" | "avatarKey">;

function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        const scan = () => {
          if (stopped) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
            const scale = Math.min(1, 480 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            const context = canvas.getContext("2d", { willReadFrequently: true });
            context?.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = context?.getImageData(0, 0, canvas.width, canvas.height);
            const code = image && jsQR(image.data, image.width, image.height);
            if (code?.data) {
              onResult(code.data);
              return;
            }
          }
          frame = requestAnimationFrame(scan);
        };
        scan();
      } catch {
        setError("Camera access is needed to scan a code.");
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onResult]);

  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-black">
      <video ref={videoRef} playsInline muted className="aspect-square w-full object-cover" />
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs text-white/80">
        <span>{error ?? "Point the camera at their QR code"}</span>
        <button type="button" onClick={onClose} className="font-semibold text-white">Cancel</button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  const config = {
    verified: { label: "Verified", className: "bg-green-100 text-green-800" },
    changed: { label: "Code changed", className: "bg-amber-100 text-amber-900" },
    unverified: { label: "Not verified yet", className: "bg-gray-100 text-gray-700" },
    unavailable: { label: "Waiting for keys", className: "bg-gray-100 text-gray-500" },
  }[status];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${config.className}`}>{config.label}</span>;
}

export default function SecurityCodeSheet({
  open,
  onClose,
  meId,
  peers,
  keys,
  initialPeerId,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  meId: string;
  peers: Peer[];
  keys: PublicEncryptionKey[];
  initialPeerId?: string;
  onChanged?: () => void;
}) {
  const [peerId, setPeerId] = useState<string>(initialPeerId ?? peers[0]?.id ?? "");
  const [version, setVersion] = useState(0);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const safety = usePeerSafety(meId, peers.map((peer) => peer.id), keys, version);
  const peer = peers.find((candidate) => candidate.id === peerId) ?? peers[0];
  const current = peer ? safety[peer.id] : undefined;

  useEffect(() => {
    if (open) setPeerId(initialPeerId ?? peers[0]?.id ?? "");
    setNotice(null);
    setScanning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPeerId]);

  const qrPayload = peer && current?.safetyNumber
    ? safetyNumberQrPayload(
        { userId: meId, fingerprints: [] },
        { userId: peer.id, fingerprints: [] },
        current.safetyNumber
      )
    : null;

  useEffect(() => {
    if (!qrPayload) {
      setQrUrl(null);
      return;
    }
    let active = true;
    void QRCode.toDataURL(qrPayload, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((url) => { if (active) setQrUrl(url); })
      .catch(() => { if (active) setQrUrl(null); });
    return () => {
      active = false;
    };
  }, [qrPayload]);

  async function setVerified(verified: boolean) {
    if (!peer || !current?.safetyNumber) return;
    await setVerifiedSafetyNumber(meId, peer.id, verified ? current.safetyNumber : null);
    setVersion((value) => value + 1);
    setNotice(verified ? { tone: "ok", text: `You verified @${peer.username}.` } : null);
    onChanged?.();
  }

  function handleScan(text: string) {
    setScanning(false);
    if (qrPayload && text === qrPayload) {
      void setVerified(true);
      setNotice({ tone: "ok", text: "Codes match. Verified!" });
    } else {
      setNotice({ tone: "warn", text: "This code does not match. Do not trust this conversation until you have checked again." });
    }
  }

  const digits = current?.safetyNumber?.split(" ") ?? [];

  return (
    <Sheet open={open} onClose={onClose} title="Security code" tall>
      {peers.length > 1 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {peers.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => {
                setPeerId(candidate.id);
                setNotice(null);
                setScanning(false);
              }}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-medium ${candidate.id === peer?.id ? "border-black bg-black text-white" : "border-gray-200 bg-white text-gray-700"}`}
            >
              <Avatar avatarKey={candidate.avatarKey} username={candidate.username} size={20} />
              @{candidate.username}
              {safety[candidate.id]?.status === "verified" && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}

      {peer && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-gray-700">
              You and <span className="font-semibold">@{peer.username}</span>
            </p>
            <StatusBadge status={current?.status ?? "unavailable"} />
          </div>

          {current?.status === "changed" && (
            <p role="alert" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              The security code changed since you verified it. This happens when someone adds a new device — or if the server swapped a key. Compare the new code again before sharing anything sensitive.
            </p>
          )}

          {current?.safetyNumber ? (
            <>
              <div className="mt-3 flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                {qrUrl && <img src={qrUrl} alt="Security code QR" width={168} height={168} className="rounded-xl bg-white p-2" />}
                <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 font-mono text-[15px] font-semibold tracking-wider text-gray-900">
                  {digits.map((group, index) => <span key={index}>{group}</span>)}
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-gray-500">
                Meet in person or use another trusted channel: both of you should see exactly the same 60 digits, or scan each other's QR code. If they match, nobody is intercepting your messages.
              </p>
            </>
          ) : (
            <p className="mt-3 rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-600">
              @{peer.username} needs to open InTouch once on a device to create an encryption key.
            </p>
          )}

          {notice && (
            <p role="status" className={`mt-3 rounded-xl p-3 text-xs ${notice.tone === "ok" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
              {notice.text}
            </p>
          )}

          {scanning && <QrScanner onResult={handleScan} onClose={() => setScanning(false)} />}

          {current?.safetyNumber && !scanning && (
            <div className="mt-4 grid gap-2">
              {current.status === "verified" ? (
                <button type="button" onClick={() => void setVerified(false)} className={btnSecondary}>
                  Remove verification
                </button>
              ) : (
                <button type="button" onClick={() => void setVerified(true)} className={btnPrimary}>
                  The codes match
                </button>
              )}
              <button type="button" onClick={() => setScanning(true)} className={btnSecondary}>
                Scan their QR code
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
