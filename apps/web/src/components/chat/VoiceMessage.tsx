import { useEffect, useState } from "react";
import AudioPlayer from "../AudioPlayer.js";
import { decryptAudioBlob } from "../../lib/voice.js";
import { downloadMediaBlob } from "../../lib/upload.js";
import type { VoiceContent } from "../../lib/messageContent.js";

// Fetches and decrypts a voice message on first play, then keeps the object URL.
export default function VoiceMessage({
  voice,
  tone,
}: {
  voice: VoiceContent;
  tone: "light" | "dark";
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requested || src || loading) return;
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const ciphertext = await downloadMediaBlob(voice.mediaKey);
        const audio = await decryptAudioBlob(ciphertext, voice.key, voice.iv, ciphertext.type || "audio/webm");
        if (active) setSrc(URL.createObjectURL(audio));
      } catch {
        if (active) {
          setError("Could not play");
          setRequested(false);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loading, requested, src, voice.iv, voice.key, voice.mediaKey]);

  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src);
  }, [src]);

  return (
    <AudioPlayer
      src={src}
      durationMs={voice.durationMs}
      peaks={voice.peaks}
      tone={tone}
      autoPlay={requested}
      loading={loading}
      error={error}
      onRequestLoad={() => setRequested(true)}
    />
  );
}
