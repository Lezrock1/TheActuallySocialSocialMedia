import { useEffect, useState } from "react";
import type { ImageContent } from "../../lib/messageContent.js";
import { downloadMediaBlob } from "../../lib/upload.js";
import { decryptMediaBlob } from "../../lib/voice.js";

export default function MessageImage({ image, suppressOpen = false }: { image: ImageContent; suppressOpen?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(false);
    void downloadMediaBlob(image.mediaKey)
      .then((ciphertext) => decryptMediaBlob(ciphertext, image.key, image.iv, image.mimeType))
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (active) setError(true); });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.iv, image.key, image.mediaKey, image.mimeType]);

  if (error) return <p role="alert" className="text-xs opacity-70">Could not load encrypted photo.</p>;
  if (!url) return <span aria-label="Loading encrypted photo" className="skeleton block h-40 w-48 max-w-full rounded-xl" />;

  return (
    <>
      <button type="button" aria-label="Open photo" onClick={() => { if (!suppressOpen) setOpen(true); }} className="mt-1 block max-w-full overflow-hidden rounded-xl">
        <img src={url} alt={image.replyTo ? `Photo reply to @${image.replyTo.senderUsername}` : "Chat photo"} className="max-h-72 max-w-full object-cover" />
      </button>
      {image.replyTo && <p className="mt-1 text-[11px] opacity-70">Selfie reply to @{image.replyTo.senderUsername}</p>}
      {image.caption && <p className="mt-1 whitespace-pre-wrap">{image.caption}</p>}
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Chat photo" onClick={() => setOpen(false)} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-3">
          <button type="button" aria-label="Close photo" onClick={() => setOpen(false)} className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl text-white">×</button>
          <img src={url} alt="Chat photo" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </>
  );
}
