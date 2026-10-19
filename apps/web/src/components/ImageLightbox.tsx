import { useEffect } from "react";
import { createPortal } from "react-dom";
import { mediaUrl } from "../lib/upload.js";
import DecodedImage from "./DecodedImage.js";

// Full-screen view of an image; tap anywhere, the close button or Esc to dismiss.
export default function ImageLightbox({ mediaKey, onClose }: { mediaKey: string; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-2xl leading-none text-white backdrop-blur-md hover:bg-white/25"
      >
        ×
      </button>
      <div className="h-full w-full" onClick={(event) => event.stopPropagation()}>
        <DecodedImage key={mediaKey} src={mediaUrl(mediaKey)} alt="Photo" className="h-full w-full" />
      </div>
    </div>,
    document.body
  );
}
